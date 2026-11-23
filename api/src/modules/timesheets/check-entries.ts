import type { Activity, Entry } from '../../../../shared/types';
import { monthDays } from '../../../../shared/holidays';
import { dayRefusal } from '../../../../shared/calendar-rules';

/** Contrôles métier sur une saisie. Retourne la liste des erreurs (vide si OK). */
export function checkEntries(month: string, entries: Entry[], activities: Activity[]): string[] {
  const errors: string[] = [];
  const days = new Set(monthDays(month).map((d) => d.date));
  const byId = new Map(activities.map((a) => [a.id, a]));
  const perDay = new Map<string, number>();
  const seen = new Set<string>();

  if (!Array.isArray(entries)) return ['Format de saisie invalide'];
  if (entries.length > 31 * 4) return ['Trop de lignes de saisie'];

  for (const e of entries) {
    if (!e || typeof e.date !== 'string' || !days.has(e.date)) {
      errors.push(`Date hors du mois : ${e?.date}`);
      continue;
    }
    const act = byId.get(e.activityId);
    if (!act) {
      errors.push(`Activité inconnue le ${e.date}`);
      continue;
    }
    if (e.quantity !== 0.5 && e.quantity !== 1) {
      errors.push(`Quantité invalide le ${e.date} (0,5 ou 1 jour)`);
      continue;
    }
    if (act.kind === 'travail' && ((act.startDate && e.date < act.startDate) || (act.endDate && e.date > act.endDate))) {
      errors.push(`Le ${e.date} est en dehors des dates de la mission ${act.missionLabel}`);
    } else {
      // Week-ends et jours fériés : selon le paramétrage global et la mission.
      const refusal = dayRefusal(e.date, act);
      if (refusal) errors.push(refusal);
    }
    const key = `${e.date}|${e.activityId}`;
    if (seen.has(key)) errors.push(`Doublon le ${e.date}`);
    seen.add(key);
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.quantity);
  }
  for (const [date, total] of perDay) {
    if (total > 1) errors.push(`Plus d'une journée saisie le ${date}`);
  }
  return errors;
}
