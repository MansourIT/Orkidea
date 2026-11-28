// Astreintes : jours d'astreinte (forfait) et interventions (temps réellement travaillé, en heures).
import { frenchHolidays, monthDays } from './holidays';
import type { HolidayRegion } from './holidays';

/** Le consultant est d'astreinte ce jour-là pour cette mission. */
export interface OnCallDay {
  date: string;
  missionId: string;
}

/**
 * Intervention pendant une astreinte. `end` ≤ `start` : l'intervention se termine le lendemain
 * (ex. 22:30 → 01:15). Elle reste rattachée à sa date de début.
 */
export interface Intervention {
  date: string;
  missionId: string;
  start: string; // HH:MM
  end: string; // HH:MM
  reason: string | null;
}

/** Mission du consultant sur laquelle l'astreinte est ouverte. */
export interface OnCallMission {
  id: string;
  label: string;
  color: string;
  startDate: string;
  endDate: string | null;
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_INTERVENTIONS_PER_DAY = 10;
/** Travail de nuit : 21 h → 6 h (art. L3122-2 du Code du travail). */
export const NIGHT_START = 21 * 60;
export const NIGHT_END = 6 * 60;

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Durée en minutes ; une fin antérieure ou égale au début signifie le lendemain. */
export function interventionMinutes(start: string, end: string): number {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return e > s ? e - s : e + 1440 - s;
}

/** Minutes de l'intervention comprises entre 21 h et 6 h. */
export function nightMinutes(start: string, end: string): number {
  const s = toMinutes(start);
  const e = s + interventionMinutes(start, end);
  // Fenêtres de nuit sur deux jours : [-180, 360], [1260, 1800], [2700, 3240] (en minutes depuis minuit du jour J).
  const windows: Array<[number, number]> = [
    [NIGHT_START - 1440, NIGHT_END],
    [NIGHT_START, NIGHT_END + 1440],
    [NIGHT_START + 1440, NIGHT_END + 2880],
  ];
  return windows.reduce((n, [a, b]) => n + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0);
}

/** « 2 h 30 », « 45 min », « 3 h ». */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export interface OnCallTotals {
  days: number;
  minutes: number;
  night: number;
  /** Minutes d'intervention commencées un samedi ou un dimanche. */
  weekend: number;
  /** Minutes d'intervention commencées un jour férié. */
  holiday: number;
}

/** Totaux d'astreinte (tous ou pour une mission). */
export function onCallTotals(days: OnCallDay[], interventions: Intervention[], region: HolidayRegion, missionId?: string): OnCallTotals {
  const keep = <T extends { missionId: string }>(x: T) => !missionId || x.missionId === missionId;
  const totals: OnCallTotals = { days: days.filter(keep).length, minutes: 0, night: 0, weekend: 0, holiday: 0 };
  for (const i of interventions.filter(keep)) {
    const minutes = interventionMinutes(i.start, i.end);
    const weekday = new Date(`${i.date}T00:00:00Z`).getUTCDay();
    totals.minutes += minutes;
    totals.night += nightMinutes(i.start, i.end);
    if (weekday === 0 || weekday === 6) totals.weekend += minutes;
    if (frenchHolidays(Number(i.date.slice(0, 4)), region)[i.date]) totals.holiday += minutes;
  }
  return totals;
}

/** Contrôles métier des astreintes d'un mois. Retourne la liste des erreurs (vide si OK). */
export function checkOnCall(month: string, days: OnCallDay[], interventions: Intervention[], missions: OnCallMission[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(days) || !Array.isArray(interventions)) return ['Format des astreintes invalide'];
  if (days.length > 31 * 5 || interventions.length > 31 * MAX_INTERVENTIONS_PER_DAY) return ['Trop de lignes d’astreinte'];
  const monthDates = new Set(monthDays(month).map((d) => d.date));
  const byId = new Map(missions.map((m) => [m.id, m]));
  const inMission = (date: string, m: OnCallMission) => date >= m.startDate && (!m.endDate || date <= m.endDate);

  const onCall = new Set<string>();
  for (const d of days) {
    const m = byId.get(d?.missionId);
    if (!d || !monthDates.has(d.date)) errors.push(`Astreinte hors du mois : ${d?.date}`);
    else if (!m) errors.push(`Astreinte non prévue pour cette mission le ${d.date}`);
    else if (!inMission(d.date, m)) errors.push(`Astreinte du ${d.date} en dehors des dates de la mission ${m.label}`);
    else if (onCall.has(`${d.date}|${d.missionId}`)) errors.push(`Astreinte en double le ${d.date}`);
    else onCall.add(`${d.date}|${d.missionId}`);
  }

  const perDay = new Map<string, number>();
  const spans: Array<{ from: number; to: number; date: string }> = [];
  const dayIndex = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  for (const i of interventions) {
    if (!i || !monthDates.has(i.date)) {
      errors.push(`Intervention hors du mois : ${i?.date}`);
      continue;
    }
    if (!TIME_RE.test(i.start ?? '') || !TIME_RE.test(i.end ?? '')) {
      errors.push(`Heures invalides pour l’intervention du ${i.date} (format HH:MM)`);
      continue;
    }
    if (i.start === i.end) {
      errors.push(`Intervention du ${i.date} : l’heure de fin doit différer de l’heure de début`);
      continue;
    }
    if (i.reason && i.reason.length > 200) errors.push(`Motif trop long pour l’intervention du ${i.date} (200 caractères au plus)`);
    if (!onCall.has(`${i.date}|${i.missionId}`)) {
      errors.push(`Intervention du ${i.date} sans astreinte ce jour-là sur la mission`);
      continue;
    }
    perDay.set(i.date, (perDay.get(i.date) ?? 0) + 1);
    const from = dayIndex(i.date) * 1440 + toMinutes(i.start);
    spans.push({ from, to: from + interventionMinutes(i.start, i.end), date: i.date });
  }
  for (const [date, n] of perDay) if (n > MAX_INTERVENTIONS_PER_DAY) errors.push(`Plus de ${MAX_INTERVENTIONS_PER_DAY} interventions le ${date}`);
  spans.sort((a, b) => a.from - b.from);
  for (let k = 1; k < spans.length; k++) {
    if (spans[k].from < spans[k - 1].to) errors.push(`Interventions qui se chevauchent le ${spans[k].date}`);
  }
  return errors;
}
