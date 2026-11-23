// Règles de saisie par jour, partagées par l'API (contrôle bloquant) et le front (grille).
import { holidayAt } from './holidays';
import { frDate } from './dates';
import type { CalendarSettings, DayRules, MissionCalendarOverrides } from './settings';
import type { ActivityKind } from './types';

/** Règles effectives : réglage global surchargé par la mission. Les absences ne se posent jamais sur un jour non ouvré. */
export function resolveRules(global: CalendarSettings, kind: ActivityKind, mission?: Partial<MissionCalendarOverrides> | null): DayRules {
  const region = mission?.holidayRegion ?? global.holidayRegion;
  if (kind === 'absence') return { weekend: 'INTERDIT', holidays: 'INTERDIT', workedHolidays: [], region: global.holidayRegion };
  return {
    weekend: mission?.weekendPolicy ?? global.weekendPolicy,
    holidays: mission?.holidayPolicy ?? global.holidayPolicy,
    workedHolidays: mission?.workedHolidays ?? global.workedHolidays,
    region,
  };
}

export interface RuleTarget {
  kind: ActivityKind;
  label: string;
  missionLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  rules: DayRules;
}

function weekdayOf(date: string): number {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
}

function nameOf(a: RuleTarget): string {
  return a.missionLabel ? `${a.missionLabel} · ${a.label}` : a.label;
}

/** Raison pour laquelle une activité n'est pas saisissable à cette date (null = autorisé). */
export function dayRefusal(date: string, a: RuleTarget): string | null {
  if (a.kind === 'travail') {
    if (a.startDate && date < a.startDate) return `Le ${frDate(date)} est avant le début de la mission ${a.missionLabel ?? ''}`.trim();
    if (a.endDate && date > a.endDate) return `Le ${frDate(date)} est après la fin de la mission ${a.missionLabel ?? ''}`.trim();
  }
  if (weekdayOf(date) >= 6 && a.rules.weekend !== 'AUTORISE') {
    return `Le ${frDate(date)} est un week-end : saisie non autorisée pour ${nameOf(a)}`;
  }
  const h = holidayAt(date, a.rules.region);
  if (h && a.rules.holidays !== 'AUTORISE' && !a.rules.workedHolidays.includes(h.code)) {
    return `Le ${frDate(date)} est férié (${h.label}) : saisie non autorisée pour ${nameOf(a)}`;
  }
  return null;
}
