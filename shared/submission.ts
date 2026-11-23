// Règles de soumission d'un CRA, partagées par l'API et le front.
import { addMonths, frDate, monthName, monthOf } from './dates';
import { type HolidayRegion, workingDates } from './holidays';
import type { SubmissionSettings } from './settings';
import type { Entry } from './types';

/** Première date (YYYY-MM-DD) à laquelle le CRA du mois peut être soumis, ou null si dès le 1er. */
export function submissionOpensOn(month: string, s: SubmissionSettings, region: HolidayRegion): string | null {
  if (s.opening === 'TOUJOURS') return null;
  const dates = workingDates(month, region);
  if (!dates.length) return null;
  const n = s.opening === 'FIN_DE_MOIS' ? 1 : Math.max(1, s.opensDays);
  return dates[Math.max(0, dates.length - n)];
}

/** Raison pour laquelle le mois ne peut pas (encore) être soumis aujourd'hui, ou null. */
export function submissionRefusal(month: string, today: string, s: SubmissionSettings, region: HolidayRegion): string | null {
  const current = monthOf(today);
  if (month > current) {
    if (!s.futureMonths) return `Impossible de soumettre un mois futur (${monthName(month)})`;
    return null;
  }
  if (month === current) {
    const opens = submissionOpensOn(month, s, region);
    if (opens && today < opens) return `La soumission de ${monthName(month)} ouvre le ${frDate(opens)}`;
  }
  return null;
}

/** Le mois est-il trop ancien pour être modifié / soumis (hors CRA rejeté) ? */
export function isTooOld(month: string, today: string, s: SubmissionSettings): boolean {
  return month < addMonths(monthOf(today), -s.pastMonthsLimit);
}

/** Jours ouvrés dont le total saisi est inférieur à 1 jour. */
export function missingWorkingDays(month: string, entries: Entry[], region: HolidayRegion): string[] {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.date, (totals.get(e.date) ?? 0) + e.quantity);
  return workingDates(month, region).filter((d) => (totals.get(d) ?? 0) < 1);
}

/** Date limite de soumission : Nème jour ouvré du mois suivant. */
export function submissionDeadline(month: string, s: SubmissionSettings, region: HolidayRegion): string {
  const next = workingDates(addMonths(month, 1), region);
  return next[Math.min(next.length, Math.max(1, s.deadlineWorkingDay)) - 1];
}
