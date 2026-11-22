// Jours fériés de France métropolitaine, calculés localement (aucune dépendance externe).

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function shift(date: Date, days: number): string {
  const d = new Date(date.getTime() + days * 86400000);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Map date ISO -> libellé du jour férié. */
export function frenchHolidays(year: number): Record<string, string> {
  const easter = easterSunday(year);
  return {
    [isoDate(year, 1, 1)]: "Jour de l'an",
    [shift(easter, 1)]: 'Lundi de Pâques',
    [isoDate(year, 5, 1)]: 'Fête du Travail',
    [isoDate(year, 5, 8)]: 'Victoire 1945',
    [shift(easter, 39)]: 'Ascension',
    [shift(easter, 50)]: 'Lundi de Pentecôte',
    [isoDate(year, 7, 14)]: 'Fête nationale',
    [isoDate(year, 8, 15)]: 'Assomption',
    [isoDate(year, 11, 1)]: 'Toussaint',
    [isoDate(year, 11, 11)]: 'Armistice 1918',
    [isoDate(year, 12, 25)]: 'Noël',
  };
}

export interface DayInfo {
  date: string; // YYYY-MM-DD
  day: number;
  weekday: number; // 1 = lundi ... 7 = dimanche
  weekend: boolean;
  holiday: string | null;
}

/** Jours d'un mois "YYYY-MM". */
export function monthDays(month: string): DayInfo[] {
  const [y, m] = month.split('-').map(Number);
  const holidays = frenchHolidays(y);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days: DayInfo[] = [];
  for (let d = 1; d <= count; d++) {
    const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
    const weekday = js === 0 ? 7 : js;
    const date = isoDate(y, m, d);
    days.push({ date, day: d, weekday, weekend: weekday >= 6, holiday: holidays[date] ?? null });
  }
  return days;
}

/** Nombre de jours ouvrés (hors week-ends et fériés). */
export function workingDays(month: string): number {
  return monthDays(month).filter((d) => !d.weekend && !d.holiday).length;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

