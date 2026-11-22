// Logique pure du « pinceau » de saisie (aucune dépendance Angular) : testable isolément.
import type { Entry } from '@shared/types';

export type Brush = { kind: 'activity'; activityId: string; quantity: 0.5 | 1 } | { kind: 'eraser' };

/**
 * - toggle : clic simple (re-cliquer la même activité au même quantum la retire) ;
 * - paint : suite d'un trait de glisser qui ajoute (jamais de retrait) ;
 * - unpaint : suite d'un trait commencé par un retrait (retire l'activité des jours survolés).
 */
export type StrokeMode = 'toggle' | 'paint' | 'unpaint';

export function dayTotal(day: readonly Entry[]): number {
  return day.reduce((s, e) => s + e.quantity, 0);
}

/** Applique le pinceau au contenu d'un jour et retourne le nouveau contenu (total toujours ≤ 1 jour). */
export function applyBrush(day: readonly Entry[], date: string, brush: Brush, mode: StrokeMode = 'toggle'): Entry[] {
  if (brush.kind === 'eraser') return [];
  const { activityId, quantity } = brush;
  const others = day.filter((e) => e.activityId !== activityId);
  if (mode === 'unpaint') return others;
  const same = day.find((e) => e.activityId === activityId);
  if (same && same.quantity === quantity) return mode === 'toggle' ? others : [...day];
  const entry: Entry = { date, activityId, quantity };
  // 1 jour : remplace tout le contenu du jour.
  if (quantity === 1) return [entry];
  // ½ jour : s'ajoute s'il reste de la place, sinon remplace.
  return dayTotal(others) + 0.5 <= 1 ? [...others, entry] : [entry];
}

/** Après le premier jour d'un trait : si le clic a retiré l'activité, le reste du trait retire aussi. */
export function strokeModeAfterFirst(before: readonly Entry[], after: readonly Entry[], brush: Brush): 'paint' | 'unpaint' {
  if (brush.kind !== 'activity') return 'paint';
  const had = before.some((e) => e.activityId === brush.activityId);
  const has = after.some((e) => e.activityId === brush.activityId);
  return had && !has ? 'unpaint' : 'paint';
}

/** Tri stable des lignes (date puis activité) : sert à la comparaison « modifications non enregistrées ». */
export function sortEntries(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.activityId.localeCompare(b.activityId));
}
