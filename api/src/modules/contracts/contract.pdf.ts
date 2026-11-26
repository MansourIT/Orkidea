import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Block, Inline } from '../../../../shared/contrats/markdown';

// Mise en page A4 d'un contrat à partir des blocs Markdown (police Times, comme l'aperçu « papier »).
const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { x: 64, top: 70, bottom: 72 };
const WIDTH = A4.width - 2 * MARGIN.x;
const INK = rgb(0.13, 0.13, 0.13);
const GREY = rgb(0.45, 0.47, 0.52);
const RULE = rgb(0.8, 0.82, 0.86);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Times standard = WinAnsi : espaces fines → espace insécable, caractères non encodables → « ? ». */
export function pdfSafe(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[‐‑]/g, '-')
    .replace(/\t/g, ' ')
    .replace(/[^\n\x20-\x7E -ÿŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/g, '?');
}

/** Éléments en ligne → suite de segments stylés (les retours à la ligne deviennent « \n »). */
function runs(nodes: Inline[], bold = false, italic = false): Run[] {
  return nodes.flatMap((n): Run[] => {
    switch (n.t) {
      case 'text':
      case 'var':
        return [{ text: n.v, bold, italic }];
      case 'br':
        return [{ text: '\n', bold, italic }];
      case 'strong':
        return runs(n.c, true, italic);
      case 'em':
        return runs(n.c, bold, true);
    }
  });
}

type Word = { text: string; font: PDFFont; width: number; space: number };
type Line = Word[];

/** Coupe les segments en lignes de largeur maximale (mots entiers ; un mot trop long est coupé). */
function layout(parts: Run[], fonts: Fonts, size: number, width: number): Line[] {
  const font = (r: Run) => (r.bold ? (r.italic ? fonts.boldItalic : fonts.bold) : r.italic ? fonts.italic : fonts.regular);
  const lines: Line[] = [[]];
  let lineWidth = 0;
  let pendingSpace = false;
  const newLine = () => {
    lines.push([]);
    lineWidth = 0;
    pendingSpace = false;
  };
  for (const r of parts) {
    const f = font(r);
    const space = f.widthOfTextAtSize(' ', size);
    // Découpe en mots en gardant l'information « espace avant ».
    for (const token of pdfSafe(r.text).split(/(\n| +)/)) {
      if (token === '') continue;
      if (token === '\n') {
        newLine();
        continue;
      }
      if (/^ +$/.test(token)) {
        pendingSpace = true;
        continue;
      }
      let word = token;
      let w = f.widthOfTextAtSize(word, size);
      const line = lines[lines.length - 1];
      const gap = line.length && pendingSpace ? space : 0;
      if (line.length && lineWidth + gap + w > width) {
        // Ponctuation ou style collé au mot précédent (« Bernard, ») : le groupe entier passe à la ligne.
        let start = line.length - 1;
        while (start > 0 && line[start].space === 0) start--;
        const moved = !gap && start > 0 ? line.splice(start) : [];
        newLine();
        if (moved.length) {
          moved[0] = { ...moved[0], space: 0 };
          lines[lines.length - 1].push(...moved);
          lineWidth = moved.reduce((n, m) => n + m.space + m.width, 0);
        }
      }
      // Mot plus long qu'une ligne (URL, IBAN…) : coupé au caractère.
      while (w > width) {
        let cut = word.length - 1;
        while (cut > 1 && f.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
        const head = word.slice(0, cut);
        lines[lines.length - 1].push({ text: head, font: f, width: f.widthOfTextAtSize(head, size), space: 0 });
        newLine();
        word = word.slice(cut);
        w = f.widthOfTextAtSize(word, size);
      }
      const current = lines[lines.length - 1];
      const before = current.length && pendingSpace ? space : 0;
      current.push({ text: word, font: f, width: w, space: before });
      lineWidth += before + w;
      pendingSpace = false;
    }
  }
  return lines.filter((l, i) => l.length || i < lines.length - 1);
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.addPage();
  }
  addPage(): void {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN.top;
  }
  ensure(height: number): void {
    if (this.y - height < MARGIN.bottom) this.addPage();
  }
  lines(lines: Line[], size: number, opts: { indent?: number; align?: 'left' | 'center'; leading?: number; marker?: { text: string; font: PDFFont } } = {}): void {
    const leading = size * (opts.leading ?? 1.38);
    const indent = opts.indent ?? 0;
    lines.forEach((line, i) => {
      this.ensure(leading);
      this.y -= leading;
      const total = line.reduce((n, w) => n + w.space + w.width, 0);
      let x = MARGIN.x + indent + (opts.align === 'center' ? (WIDTH - indent - total) / 2 : 0);
      if (i === 0 && opts.marker) this.page.drawText(opts.marker.text, { x: MARGIN.x + indent - 14, y: this.y, size, font: opts.marker.font, color: INK });
      // Mots consécutifs de même style regroupés en un seul texte (espaces réels : rendu et copier-coller fiables).
      const segments: Array<{ text: string; font: PDFFont }> = [];
      for (const w of line) {
        const last = segments[segments.length - 1];
        const text = (w.space ? ' ' : '') + w.text;
        if (last && last.font === w.font) last.text += text;
        else segments.push({ text, font: w.font });
      }
      for (const seg of segments) {
        this.page.drawText(seg.text, { x, y: this.y, size, font: seg.font, color: INK });
        x += seg.font.widthOfTextAtSize(seg.text, size);
      }
    });
  }
}

export interface ContractPdfInput {
  title: string;
  number: string;
  issuedOn: string;
  blocks: Block[];
}

/** PDF A4 du contrat : titres, paragraphes, listes, filets, sauts de page ; pied de page numéroté. */
export async function renderContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const date = new Date(`${input.issuedOn}T00:00:00Z`);
  doc.setTitle(pdfSafe(`${input.title} – ${input.number}`));
  doc.setAuthor('Orkidea');
  doc.setCreator('Orkidea CRA');
  doc.setProducer('Orkidea CRA');
  // Dates fixes : le même contrat produit toujours le même fichier (empreinte stable).
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    boldItalic: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
  };
  const w = new Writer(doc, fonts);
  const BODY = 10.5;

  input.blocks.forEach((b, index) => {
    switch (b.t) {
      case 'h': {
        const size = b.level === 1 ? 14 : b.level === 2 ? 11.5 : 10.5;
        const parts = runs(b.c, true, b.level === 3).map((r) => (b.level === 1 ? { ...r, text: r.text.toUpperCase() } : r));
        const lines = layout(parts, fonts, size, WIDTH);
        // Un titre n'est jamais seul en bas de page : on réserve aussi deux lignes du bloc suivant.
        w.ensure(lines.length * size * 1.3 + (b.level === 1 ? 0 : 14) + 2 * BODY * 1.38);
        w.y -= b.level === 1 ? 0 : index === 0 ? 0 : 10;
        w.lines(lines, size, { align: b.level === 1 ? 'center' : 'left', leading: 1.3 });
        w.y -= b.level === 1 ? 14 : 4;
        break;
      }
      case 'p':
        w.lines(layout(runs(b.c), fonts, BODY, WIDTH), BODY);
        w.y -= 7;
        break;
      case 'ul':
      case 'ol':
        b.items.forEach((item, i) => {
          const marker = b.t === 'ul' ? '•' : `${i + 1}.`;
          w.lines(layout(runs(item), fonts, BODY, WIDTH - 18), BODY, { indent: 18, marker: { text: marker, font: fonts.regular } });
          w.y -= 2;
        });
        w.y -= 5;
        break;
      case 'hr':
        w.ensure(16);
        w.y -= 8;
        w.page.drawLine({ start: { x: MARGIN.x, y: w.y }, end: { x: A4.width - MARGIN.x, y: w.y }, thickness: 0.6, color: RULE });
        w.y -= 8;
        break;
      case 'pageBreak':
        w.addPage();
        break;
    }
  });

  // Pied de page : numéro du contrat et pagination.
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const text = pdfSafe(`Contrat n° ${input.number} – page ${i + 1} / ${pages.length}`);
    const width = fonts.regular.widthOfTextAtSize(text, 8.5);
    page.drawText(text, { x: (A4.width - width) / 2, y: 36, size: 8.5, font: fonts.regular, color: GREY });
  });
  return doc.save({ useObjectStreams: false });
}
