// Moteur des modèles de contrat : variables {{cle}}, blocs {{#si cle}} … {{#sinon}} … {{/si}},
// numérotation des articles {{n}} et saut de page {{saut_de_page}}.
import type { ContractData } from './variables';
import { VARIABLES, VARIABLE_KEYS } from './variables';

/** Variables renseignées seulement à l'émission : jamais « manquantes » dans un brouillon. */
export const DEFERRED_KEYS = new Set(['contrat.numero']);
export const DEFERRED_LABEL = 'attribué à l’émission';

/**
 * Marqueurs (zone Unicode privée) entourant chaque valeur insérée, pour que le texte du client
 * ne soit jamais interprété comme du Markdown et que l'aperçu puisse surligner les variables :
 * DEBUT cle SEP etat SEP valeur FIN ; les retours à la ligne d'une valeur deviennent SAUT_LIGNE.
 */
export const MARK = { start: '', sep: '', end: '', newline: '', pageBreak: '' } as const;
export type VarState = 'ok' | 'missing' | 'deferred';

// ---------------------------------------------------------------- Analyse

export type TemplateNode =
  | { kind: 'text'; value: string }
  | { kind: 'var'; key: string; line: number }
  | { kind: 'counter' }
  | { kind: 'pageBreak' }
  | { kind: 'if'; key: string; negate: boolean; then: TemplateNode[]; else: TemplateNode[]; line: number };

export interface TemplateIssue {
  line: number;
  severity: 'erreur' | 'avertissement';
  message: string;
}

export interface ParsedTemplate {
  nodes: TemplateNode[];
  issues: TemplateIssue[];
  /** Variables citées (hors {{n}}), dans l'ordre de première apparition. */
  keys: string[];
}

const TAG = /\{\{([^{}]*)\}\}/g;
const KEY = /^[a-z_]+(\.[a-z_]+)*$/;

/** Distance d'édition, pour suggérer la variable la plus proche. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function suggestKey(key: string): string | null {
  let best: string | null = null;
  let score = Infinity;
  for (const k of VARIABLE_KEYS) {
    const s = distance(key, k);
    if (s < score) [best, score] = [k, s];
  }
  return score <= Math.max(2, Math.floor(key.length / 4)) ? best : null;
}

const BOOLEAN_KEYS = new Set(VARIABLES.filter((x) => x.boolean).map((x) => x.key));

/** Analyse un modèle : arbre, erreurs (bloquantes pour la publication) et avertissements. */
export function parseTemplate(source: string): ParsedTemplate {
  const issues: TemplateIssue[] = [];
  const keys: string[] = [];
  const root: TemplateNode[] = [];
  // Pile des blocs « si » ouverts ; `target` = liste où ajouter les nœuds (then ou else).
  const stack: Array<{ node: Extract<TemplateNode, { kind: 'if' }>; target: TemplateNode[]; elseSeen: boolean }> = [];
  const out = () => (stack.length ? stack[stack.length - 1].target : root);
  const lineAt = (index: number) => source.slice(0, index).split('\n').length;
  const unknown = (key: string, line: number) => {
    const s = suggestKey(key);
    issues.push({ line, severity: 'erreur', message: `Variable inconnue « ${key} »${s ? `. Vouliez-vous dire « ${s} » ?` : ''}` });
  };
  const use = (key: string) => {
    if (!keys.includes(key)) keys.push(key);
  };

  let last = 0;
  for (const m of source.matchAll(TAG)) {
    const index = m.index;
    const line = lineAt(index);
    const tag = m[1].trim().replace(/\s+/g, ' ');
    // Une instruction de bloc seule sur sa ligne disparaît avec sa ligne (pas de ligne vide parasite).
    const lineStart = source.lastIndexOf('\n', index - 1) + 1;
    const lineEnd = source.indexOf('\n', index);
    const alone =
      /^[#/]/.test(tag) && lineStart >= last && !source.slice(lineStart, index).trim() && !source.slice(index + m[0].length, lineEnd === -1 ? undefined : lineEnd).trim();
    const textEnd = alone ? lineStart : index;
    if (textEnd > last) out().push({ kind: 'text', value: source.slice(last, textEnd) });
    last = alone ? (lineEnd === -1 ? source.length : lineEnd + 1) : index + m[0].length;

    if (tag === 'n') {
      out().push({ kind: 'counter' });
    } else if (tag === 'saut_de_page') {
      const before = source.slice(source.lastIndexOf('\n', index - 1) + 1, index);
      const afterEnd = source.indexOf('\n', last);
      const after = source.slice(last, afterEnd === -1 ? undefined : afterEnd);
      if (before.trim() || after.trim()) issues.push({ line, severity: 'avertissement', message: '{{saut_de_page}} doit être seul sur sa ligne' });
      out().push({ kind: 'pageBreak' });
    } else if (tag.startsWith('#si ') || tag === '#si') {
      const rest = tag.slice(3).trim();
      const negate = rest.startsWith('non ');
      const key = negate ? rest.slice(4).trim() : rest;
      if (!key) issues.push({ line, severity: 'erreur', message: 'Bloc {{#si}} sans variable : écrire {{#si mission.validation_client}}' });
      else if (!VARIABLE_KEYS.has(key)) unknown(key, line);
      else use(key);
      const node: Extract<TemplateNode, { kind: 'if' }> = { kind: 'if', key, negate, then: [], else: [], line };
      out().push(node);
      stack.push({ node, target: node.then, elseSeen: false });
    } else if (tag === '#sinon') {
      const top = stack[stack.length - 1];
      if (!top) issues.push({ line, severity: 'erreur', message: '{{#sinon}} en dehors d’un bloc {{#si …}}' });
      else if (top.elseSeen) issues.push({ line, severity: 'erreur', message: 'Deux {{#sinon}} dans le même bloc {{#si …}}' });
      else Object.assign(top, { target: top.node.else, elseSeen: true });
    } else if (tag === '/si') {
      if (!stack.pop()) issues.push({ line, severity: 'erreur', message: '{{/si}} sans {{#si …}} correspondant' });
    } else if (tag.startsWith('#') || tag.startsWith('/')) {
      issues.push({ line, severity: 'erreur', message: `Instruction inconnue « {{${tag}}} » (disponibles : {{#si …}}, {{#sinon}}, {{/si}})` });
    } else if (!KEY.test(tag)) {
      issues.push({ line, severity: 'erreur', message: `Variable mal écrite « {{${tag}}} » (lettres minuscules, points et _ seulement)` });
    } else if (!VARIABLE_KEYS.has(tag)) {
      unknown(tag, line);
    } else {
      if (BOOLEAN_KEYS.has(tag)) issues.push({ line, severity: 'avertissement', message: `« ${tag} » vaut oui / non : à utiliser plutôt dans {{#si ${tag}}}` });
      use(tag);
      out().push({ kind: 'var', key: tag, line });
    }
  }
  if (last < source.length) out().push({ kind: 'text', value: source.slice(last) });

  for (const open of stack) issues.push({ line: open.node.line, severity: 'erreur', message: `Bloc {{#si ${open.node.negate ? 'non ' : ''}${open.node.key}}} jamais fermé par {{/si}}` });
  // Accolades isolées : souvent une variable mal tapée ({{client.nom} ou {client.nom}}).
  source.split('\n').forEach((text, i) => {
    const rest = text.replace(TAG, '');
    if (rest.includes('{{') || rest.includes('}}')) issues.push({ line: i + 1, severity: 'erreur', message: 'Accolades {{ }} incomplètes' });
  });
  issues.sort((a, b) => a.line - b.line);
  return { nodes: root, issues, keys };
}

// ---------------------------------------------------------------- Rendu

export interface RenderResult {
  /** Markdown rempli, valeurs entourées de marqueurs (voir MARK). */
  text: string;
  /** Variables vides dans les parties retenues du modèle : le contrat ne peut pas être émis. */
  missing: string[];
}

const truthy = (v: string | boolean | null | undefined) => (typeof v === 'boolean' ? v : !!v && v.trim() !== '');

export function marker(key: string, state: VarState, value: string): string {
  return `${MARK.start}${key}${MARK.sep}${state}${MARK.sep}${value.replace(/\r?\n/g, MARK.newline)}${MARK.end}`;
}

/** Remplit un modèle analysé avec les valeurs d'un contrat. */
export function renderTemplate(parsed: ParsedTemplate, data: ContractData): RenderResult {
  const missing: string[] = [];
  let counter = 0;
  const walk = (nodes: TemplateNode[]): string =>
    nodes
      .map((n) => {
        switch (n.kind) {
          case 'text':
            return n.value;
          case 'counter':
            return String(++counter);
          case 'pageBreak':
            return MARK.pageBreak;
          case 'if':
            return walk(truthy(data[n.key]) !== n.negate ? n.then : n.else);
          case 'var': {
            const value = data[n.key];
            if (typeof value === 'boolean') return marker(n.key, 'ok', value ? 'oui' : 'non');
            if (value && value.trim()) return marker(n.key, 'ok', value);
            if (DEFERRED_KEYS.has(n.key)) return marker(n.key, 'deferred', DEFERRED_LABEL);
            if (!missing.includes(n.key)) missing.push(n.key);
            return marker(n.key, 'missing', '');
          }
        }
      })
      .join('');
  // Un bloc {{#si}} seul sur sa ligne ne laisse pas de ligne vide : on retire les lignes devenues vides
  // en double (au plus une ligne vide consécutive, qui sépare les paragraphes).
  const text = walk(parsed.nodes).replace(/\n[ \t]*(\n[ \t]*)+\n/g, '\n\n').trim() + '\n';
  return { text, missing };
}

/** Texte rempli sans marqueurs (valeur affichée, ou ⟨clé⟩ pour une valeur manquante). */
export function stripMarkers(text: string): string {
  const re = new RegExp(`${MARK.start}([^${MARK.sep}]*)${MARK.sep}([a-z]+)${MARK.sep}([^${MARK.end}]*)${MARK.end}`, 'g');
  return text
    .replace(re, (_, key: string, state: string, value: string) => (state === 'missing' ? `⟨${key}⟩` : value.replaceAll(MARK.newline, '\n')))
    .replaceAll(MARK.pageBreak, '');
}
