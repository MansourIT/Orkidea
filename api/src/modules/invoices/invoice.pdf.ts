import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatCents, lineTotal, monthLabel, type InvoiceKind, type InvoiceLine } from '../../../../shared/factures';
import { pdfSafe } from '../contracts/contract.pdf';

const ORCHID = rgb(0.486, 0.361, 0.749);
const INK = rgb(0.106, 0.137, 0.251);
const GREY = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.86, 0.87, 0.9);
const W = 595.28;
const H = 841.89;
const M = 48;

/** Données figées à l'émission, reprises sur la facture. */
export interface InvoicePdfData {
  kind: InvoiceKind;
  number: string;
  issueDate: string;
  dueDate: string;
  month: string;
  seller: { name: string; legalForm: string; capital: string; address: string; siret: string; rcs: string; vatNumber: string; iban: string; bic: string };
  buyer: { name: string; address: string; siren: string; vatNumber: string };
  mission: string;
  consultant: string;
  purchaseOrder: string | null;
  creditedNumber: string | null;
  lines: InvoiceLine[];
  vatRate: number;
  totals: { ht: number; vat: number; ttc: number };
  vatOnDebits: boolean;
  latePenalty: string;
  notes: string | null;
}

const fr = (iso: string) => iso.split('-').reverse().join('/');
const qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const UNIT: Record<InvoiceLine['unit'], string> = { jour: 'j', heure: 'h', forfait: 'forfait' };

/** Facture (ou avoir) A4 avec les mentions obligatoires, dont celles de la réforme de la facturation électronique. */
export async function renderInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const date = new Date(`${d.issueDate}T00:00:00Z`);
  const title = d.kind === 'AVOIR' ? 'Avoir' : 'Facture';
  doc.setTitle(pdfSafe(`${title} ${d.number}`));
  doc.setAuthor(pdfSafe(d.seller.name));
  doc.setCreator('Orkidea CRA');
  doc.setProducer('Orkidea CRA');
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const text = (t: string, x: number, size = 9.5, f: PDFFont = font, color = INK) => page.drawText(pdfSafe(t), { x, y, size, font: f, color });
  const right = (t: string, xRight: number, size = 9.5, f: PDFFont = font, color = INK) => {
    const s = pdfSafe(t);
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  };
  const fit = (t: string, width: number, f: PDFFont, size: number) => {
    let s = pdfSafe(t);
    while (s.length > 1 && f.widthOfTextAtSize(s, size) > width) s = s.slice(0, -2) + '…';
    return s;
  };
  const block = (lines: string[], x: number, size = 9) => {
    for (const l of lines.filter(Boolean)) {
      text(l, x, size);
      y -= size + 3.5;
    }
  };

  // En-tête : vendeur à gauche, titre et références à droite.
  text(d.seller.name, M, 16, bold, ORCHID);
  right(`${title.toUpperCase()} N° ${d.number}`, W - M, 13, bold);
  y -= 20;
  const top = y;
  block(
    [
      `${d.seller.legalForm}${d.seller.capital ? ` au capital de ${d.seller.capital}` : ''}`,
      d.seller.address,
      `SIRET ${d.seller.siret}${d.seller.rcs ? ` – RCS ${d.seller.rcs}` : ''}`,
      d.seller.vatNumber ? `TVA intracommunautaire ${d.seller.vatNumber}` : '',
    ],
    M,
  );
  const afterSeller = y;
  y = top;
  for (const [label, value] of [
    ['Date d’émission', fr(d.issueDate)],
    ['Échéance', fr(d.dueDate)],
    ['Période', monthLabel(d.month)],
    ...(d.purchaseOrder ? [['Bon de commande', d.purchaseOrder]] : []),
    ...(d.creditedNumber ? [['Facture d’origine', d.creditedNumber]] : []),
  ]) {
    right(`${label} : ${value}`, W - M, 9);
    y -= 12.5;
  }
  y = Math.min(y, afterSeller) - 16;

  // Client
  page.drawRectangle({ x: W / 2, y: y - 66, width: W / 2 - M, height: 74, borderColor: LINE, borderWidth: 1 });
  const boxTop = y;
  y -= 6;
  text('Client', W / 2 + 10, 8, bold, GREY);
  y -= 13;
  text(fit(d.buyer.name, W / 2 - M - 20, bold, 10.5), W / 2 + 10, 10.5, bold);
  y -= 13;
  for (const l of [d.buyer.address, `SIREN ${d.buyer.siren}`, d.buyer.vatNumber ? `TVA ${d.buyer.vatNumber}` : ''].filter(Boolean)) {
    text(fit(l, W / 2 - M - 20, font, 9), W / 2 + 10, 9);
    y -= 12;
  }
  y = Math.min(y, boxTop - 74) - 18;

  text(`Objet : prestation de services – ${d.mission} – ${d.consultant}`, M, 9.5, bold);
  y -= 22;

  // Lignes
  const cols = { desc: M, qty: 335, unit: 348, price: 455, total: W - M };
  page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: rgb(0.96, 0.95, 0.99) });
  text('Désignation', cols.desc + 6, 8.5, bold, GREY);
  right('Qté', cols.qty, 8.5, bold, GREY);
  text('Unité', cols.unit, 8.5, bold, GREY);
  right('PU HT', cols.price, 8.5, bold, GREY);
  right('Total HT', cols.total - 6, 8.5, bold, GREY);
  y -= 20;
  for (const l of d.lines) {
    if (y < 220) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
    text(fit(l.description, 255, font, 9.5), cols.desc + 6, 9.5);
    right(qty(l.quantity), cols.qty, 9.5);
    text(UNIT[l.unit], cols.unit, 9.5);
    right(formatCents(l.unitPrice), cols.price, 9.5);
    right(formatCents(lineTotal(l)), cols.total - 6, 9.5);
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.5, color: LINE });
    y -= 17;
  }

  // Totaux
  y -= 8;
  for (const [label, value, strong] of [
    ['Total HT', d.totals.ht, false],
    [`TVA ${d.vatRate.toLocaleString('fr-FR')} %`, d.totals.vat, false],
    [d.kind === 'AVOIR' ? 'Total TTC à déduire' : 'Total TTC', d.totals.ttc, true],
  ] as Array<[string, number, boolean]>) {
    right(label, 450, strong ? 11 : 9.5, strong ? bold : font);
    right(formatCents(value), W - M - 6, strong ? 11 : 9.5, strong ? bold : font);
    y -= strong ? 18 : 14;
  }
  y -= 14;

  // Conditions et mentions légales
  const mentions = [
    d.kind === 'FACTURE' ? `Paiement à réception, au plus tard le ${fr(d.dueDate)}, par virement.` : 'Avoir à déduire de la facture d’origine.',
    d.seller.iban ? `IBAN ${d.seller.iban}${d.seller.bic ? ` – BIC ${d.seller.bic}` : ''}` : '',
    `Catégorie de l’opération : prestation de services.${d.vatOnDebits ? ' Option pour le paiement de la taxe d’après les débits.' : ''}`,
    d.kind === 'FACTURE'
      ? `En cas de retard de paiement : pénalités au taux de ${d.latePenalty} et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce). Pas d’escompte pour paiement anticipé.`
      : '',
    d.notes ?? '',
  ].filter(Boolean);
  for (const m of mentions) {
    // Retour à la ligne simple sur la largeur utile.
    const words = pdfSafe(m).split(' ');
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, 8.5) > W - 2 * M) {
        text(line, M, 8.5, font, GREY);
        y -= 11.5;
        line = w;
      } else line = next;
    }
    if (line) {
      text(line, M, 8.5, font, GREY);
      y -= 15;
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const s = pdfSafe(`${d.seller.name} – ${title} ${d.number} – page ${i + 1}/${pages.length}`);
    p.drawText(s, { x: (W - font.widthOfTextAtSize(s, 8)) / 2, y: 26, size: 8, font, color: GREY });
  });
  return doc.save({ useObjectStreams: false });
}
