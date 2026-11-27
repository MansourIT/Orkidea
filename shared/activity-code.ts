// Code court d'une activité (ex. DEV, REU, CP) : affiché dans les cases du calendrier et le tableau.

export const ACTIVITY_CODE_RE = /^[A-Z0-9]{1,5}$/;
export const ACTIVITY_CODE_HINT = '1 à 5 lettres majuscules ou chiffres';

const words = (label: string) =>
  label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

/** Code proposé : 3 premières lettres d'un mot unique, sinon initiales (Mise en production → MEP). */
export function defaultActivityCode(label: string): string {
  const w = words(label);
  if (!w.length) return 'ACT';
  if (w.length === 1) return w[0].slice(0, 3);
  return w
    .map((x) => x[0])
    .join('')
    .slice(0, 4);
}

/** Code proposé et libre parmi `taken` (suffixe numérique au besoin : DEV, DEV2…). */
export function suggestActivityCode(label: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((c) => c.toUpperCase()));
  const base = defaultActivityCode(label).slice(0, 4);
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const code = `${base.slice(0, 5 - String(i).length)}${i}`;
    if (!used.has(code)) return code;
  }
  return base;
}

/** Code effectif : celui enregistré, sinon le code proposé à partir du libellé (activités antérieures). */
export function activityCode(code: string | null | undefined, label: string): string {
  return code || defaultActivityCode(label);
}
