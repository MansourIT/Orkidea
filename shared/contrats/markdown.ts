// Sous-ensemble Markdown des contrats → blocs, communs à l'aperçu (HTML) et au PDF.
// Titres #, ##, ### ; paragraphes ; listes « - » et « 1. » ; **gras**, *italique* ; ligne « --- » ;
// un retour à la ligne simple est conservé (adresses, signatures). Pas de HTML.
import { MARK, type VarState } from './modele';

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'br' }
  | { t: 'var'; key: string; state: VarState; v: string };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'hr' }
  | { t: 'pageBreak' };

type Token = { k: 'text'; v: string } | { k: 'delim'; v: '**' | '*' } | { k: 'var'; node: Inline } | { k: 'br' };

const VAR_RE = new RegExp(`${MARK.start}([^${MARK.sep}]*)${MARK.sep}([a-z]+)${MARK.sep}([^${MARK.end}]*)${MARK.end}`, 'y');

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let text = '';
  const flush = () => {
    if (text) tokens.push({ k: 'text', v: text });
    text = '';
  };
  for (let i = 0; i < line.length; ) {
    const ch = line[i];
    if (ch === MARK.start) {
      VAR_RE.lastIndex = i;
      const m = VAR_RE.exec(line);
      if (m) {
        flush();
        tokens.push({ k: 'var', node: { t: 'var', key: m[1], state: m[2] as VarState, v: m[3].replaceAll(MARK.newline, '\n') } });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '\\' && i + 1 < line.length && '\\*#-_'.includes(line[i + 1])) {
      text += line[i + 1];
      i += 2;
    } else if (ch === '*') {
      flush();
      const double = line[i + 1] === '*';
      tokens.push({ k: 'delim', v: double ? '**' : '*' });
      i += double ? 2 : 1;
    } else if (ch === '\n') {
      flush();
      tokens.push({ k: 'br' });
      i++;
    } else {
      text += ch;
      i++;
    }
  }
  flush();
  return tokens;
}

/** Texte en ligne : **gras** et *italique* appariés ; un délimiteur sans partenaire reste du texte. */
export function parseInline(source: string): Inline[] {
  const tokens = tokenize(source);
  // Appariement : pour chaque délimiteur ouvrant, cherche le prochain identique.
  const build = (from: number, to: number): Inline[] => {
    const out: Inline[] = [];
    const push = (node: Inline) => {
      const prev = out[out.length - 1];
      if (node.t === 'text' && prev?.t === 'text') prev.v += node.v;
      else out.push(node);
    };
    for (let i = from; i < to; i++) {
      const tk = tokens[i];
      if (tk.k === 'text') push({ t: 'text', v: tk.v });
      else if (tk.k === 'br') push({ t: 'br' });
      else if (tk.k === 'var') push(tk.node);
      else {
        let close = -1;
        for (let j = i + 1; j < to; j++) {
          const other = tokens[j];
          if (other.k === 'delim' && other.v === tk.v) {
            close = j;
            break;
          }
        }
        if (close === -1 || close === i + 1) push({ t: 'text', v: tk.v });
        else {
          push({ t: tk.v === '**' ? 'strong' : 'em', c: build(i + 1, close) });
          i = close;
        }
      }
    }
    return out;
  };
  return build(0, tokens.length);
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*(-\s*){3,}$/;

/** Découpe un texte Markdown (rempli ou non) en blocs. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ t: list.t, items: list.items.map(parseInline) });
    list = null;
  };
  const flush = () => {
    flushPara();
    flushList();
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.trim() === MARK.pageBreak) {
      flush();
      blocks.push({ t: 'pageBreak' });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ t: 'h', level: h[1].length as 1 | 2 | 3, c: parseInline(h[2]) });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ t: 'hr' });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      flushPara();
      const t = bullet ? 'ul' : 'ol';
      if (list && list.t !== t) flushList();
      list ??= { t, items: [] };
      list.items.push((bullet ?? ordered)![1]);
      continue;
    }
    if (list && /^\s{2,}/.test(raw)) {
      // Suite d'un élément de liste (ligne indentée).
      list.items[list.items.length - 1] += `\n${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line);
  }
  flush();
  return blocks;
}

/** Texte brut d'une suite d'éléments en ligne (comparaisons, titres de PDF). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' || n.t === 'var' ? n.v : n.t === 'br' ? '\n' : inlineText(n.c))).join('');
}
