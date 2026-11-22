// Jours fériés français, calculés localement (aucune dépendance externe).
// Région « metropole » par défaut ; « alsace-moselle » ajoute le Vendredi saint et la Saint-Étienne.

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

export type HolidayRegion = 'metropole' | 'alsace-moselle';
export const HOLIDAY_REGIONS: HolidayRegion[] = ['metropole', 'alsace-moselle'];

/** Codes stables des jours fériés (utilisés dans le paramétrage, ex. Pentecôte travaillée). */
export const HOLIDAY_CODES = [
  'jour-an',
  'vendredi-saint',
  'lundi-paques',
  'fete-travail',
  'victoire-1945',
  'ascension',
  'lundi-pentecote',
  'fete-nationale',
  'assomption',
  'toussaint',
  'armistice',
  'noel',
  'saint-etienne',
] as const;
export type HolidayCode = (typeof HOLIDAY_CODES)[number];

export const HOLIDAY_LABELS: Record<HolidayCode, string> = {
  'jour-an': "Jour de l'an",
  'vendredi-saint': 'Vendredi saint',
  'lundi-paques': 'Lundi de Pâques',
  'fete-travail': 'Fête du Travail',
  'victoire-1945': 'Victoire 1945',
  ascension: 'Ascension',
  'lundi-pentecote': 'Lundi de Pentecôte',
  'fete-nationale': 'Fête nationale',
  assomption: 'Assomption',
  toussaint: 'Toussaint',
  armistice: 'Armistice 1918',
  noel: 'Noël',
  'saint-etienne': 'Saint-Étienne',
};

export interface Holiday {
  date: string;
  code: HolidayCode;
  label: string;
}

const cache = new Map<string, Holiday[]>();

/** Liste des jours fériés d'une année, dans l'ordre chronologique. */
export function holidayList(year: number, region: HolidayRegion = 'metropole'): Holiday[] {
  const key = `${year}|${region}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const easter = easterSunday(year);
  const dates: Array<[string, HolidayCode]> = [
    [isoDate(year, 1, 1), 'jour-an'],
    ...(region === 'alsace-moselle' ? ([[shift(easter, -2), 'vendredi-saint']] as Array<[string, HolidayCode]>) : []),
    [shift(easter, 1), 'lundi-paques'],
    [isoDate(year, 5, 1), 'fete-travail'],
    [isoDate(year, 5, 8), 'victoire-1945'],
    [shift(easter, 39), 'ascension'],
    [shift(easter, 50), 'lundi-pentecote'],
    [isoDate(year, 7, 14), 'fete-nationale'],
    [isoDate(year, 8, 15), 'assomption'],
    [isoDate(year, 11, 1), 'toussaint'],
    [isoDate(year, 11, 11), 'armistice'],
    [isoDate(year, 12, 25), 'noel'],
    ...(region === 'alsace-moselle' ? ([[isoDate(year, 12, 26), 'saint-etienne']] as Array<[string, HolidayCode]>) : []),
  ];
  const list = dates.map(([date, code]) => ({ date, code, label: HOLIDAY_LABELS[code] }));
  cache.set(key, list);
  return list;
}

/** Map date ISO -> libellé du jour férié. */
export function frenchHolidays(year: number, region: HolidayRegion = 'metropole'): Record<string, string> {
  return Object.fromEntries(holidayList(year, region).map((h) => [h.date, h.label]));
}

/** Jour férié à une date donnée (ou null). */
export function holidayAt(date: string, region: HolidayRegion = 'metropole'): Holiday | null {
  return holidayList(Number(date.slice(0, 4)), region).find((h) => h.date === date) ?? null;
}

export interface DayInfo {
  date: string; // YYYY-MM-DD
  day: number;
  weekday: number; // 1 = lundi ... 7 = dimanche
  weekend: boolean;
  holiday: string | null;
  holidayCode: HolidayCode | null;
}

/** Jours d'un mois "YYYY-MM". */
export function monthDays(month: string, region: HolidayRegion = 'metropole'): DayInfo[] {
  const [y, m] = month.split('-').map(Number);
  const holidays = new Map(holidayList(y, region).map((h) => [h.date, h]));
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days: DayInfo[] = [];
  for (let d = 1; d <= count; d++) {
    const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
    const weekday = js === 0 ? 7 : js;
    const date = isoDate(y, m, d);
    const h = holidays.get(date);
    days.push({ date, day: d, weekday, weekend: weekday >= 6, holiday: h?.label ?? null, holidayCode: h?.code ?? null });
  }
  return days;
}

/** Dates des jours ouvrés (hors week-ends et fériés). */
export function workingDates(month: string, region: HolidayRegion = 'metropole'): string[] {
  return monthDays(month, region)
    .filter((d) => !d.weekend && !d.holiday)
    .map((d) => d.date);
}

/** Nombre de jours ouvrés (hors week-ends et fériés). */
export function workingDays(month: string, region: HolidayRegion = 'metropole'): number {
  return workingDates(month, region).length;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}
