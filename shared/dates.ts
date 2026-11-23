// Utilitaires de dates « calendaires » : on manipule des chaînes YYYY-MM-DD / YYYY-MM, jamais d'heure locale.

export const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const WEEKDAY_NAMES = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** "2026-11" -> "novembre 2026" */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-11-07" -> "07/11/2026" */
export function frDate(date: string): string {
  return date.split('-').reverse().join('/');
}

/** Mois de la date "YYYY-MM-DD". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Décale un mois "YYYY-MM" de n mois. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${nm < 10 ? '0' : ''}${nm}`;
}

/** Nombre de mois de a vers b (b - a). */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** Date du jour à Paris, au format YYYY-MM-DD (référence métier pour les délais). */
export function todayInParis(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
