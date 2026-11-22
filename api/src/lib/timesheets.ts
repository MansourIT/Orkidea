import type { Activity, Entry, Timesheet, TimesheetStatus, ValidationSummary } from '../../../shared/types';
import { monthDays, workingDays } from '../../../shared/holidays';
import { newId } from './crypto';

export interface TimesheetRow {
  id: string;
  consultant_id: string;
  month: string;
  status: TimesheetStatus;
  comment: string | null;
  submitted_at: string | null;
}

export async function getTimesheetRow(db: D1Database, userId: string, month: string): Promise<TimesheetRow | null> {
  return db
    .prepare('SELECT id, consultant_id, month, status, comment, submitted_at FROM timesheets WHERE consultant_id = ? AND month = ?')
    .bind(userId, month)
    .first<TimesheetRow>();
}

export async function getOrCreateTimesheet(db: D1Database, userId: string, month: string): Promise<TimesheetRow> {
  const existing = await getTimesheetRow(db, userId, month);
  if (existing) return existing;
  await db
    .prepare('INSERT OR IGNORE INTO timesheets (id, consultant_id, month) VALUES (?, ?, ?)')
    .bind(newId(), userId, month)
    .run();
  return (await getTimesheetRow(db, userId, month))!;
}

export async function loadEntries(db: D1Database, timesheetId: string): Promise<Entry[]> {
  const { results } = await db
    .prepare('SELECT date, activity_id AS activityId, quantity FROM entries WHERE timesheet_id = ? ORDER BY date')
    .bind(timesheetId)
    .all<Entry>();
  return results;
}

export async function loadValidations(db: D1Database, timesheetId: string): Promise<ValidationSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT v.mission_id AS missionId, m.label AS missionLabel, cl.name AS clientName,
              v.status, v.comment, v.decided_at AS decidedAt
       FROM validations v JOIN missions m ON m.id = v.mission_id JOIN clients cl ON cl.id = m.client_id
       WHERE v.timesheet_id = ? AND v.status != 'ANNULE' ORDER BY m.label`,
    )
    .bind(timesheetId)
    .all<ValidationSummary>();
  return results;
}

export async function toTimesheet(db: D1Database, row: TimesheetRow): Promise<Timesheet> {
  const [entries, validations] = await Promise.all([loadEntries(db, row.id), loadValidations(db, row.id)]);
  return {
    month: row.month,
    status: row.status,
    comment: row.comment,
    entries,
    validations,
    workingDays: workingDays(row.month),
    submittedAt: row.submitted_at,
  };
}

interface ActivityRow extends Activity {
  missionStart: string | null;
  missionEnd: string | null;
}

/** Activités saisissables par le consultant : celles de ses missions actives + absences communes. */
export async function listActivities(db: D1Database, userId: string): Promise<ActivityRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.mission_id AS missionId, m.label AS missionLabel, cl.name AS clientName,
              a.label, a.kind, a.color, m.start_date AS missionStart, m.end_date AS missionEnd
       FROM activities a
       LEFT JOIN missions m ON m.id = a.mission_id
       LEFT JOIN clients cl ON cl.id = m.client_id
       LEFT JOIN activity_order o ON o.activity_id = a.id AND o.user_id = ?1
       WHERE a.active = 1 AND (a.mission_id IS NULL OR (m.consultant_id = ?1 AND m.active = 1))
       ORDER BY COALESCE(o.position, 1000), a.kind DESC, m.label, a.label`,
    )
    .bind(userId)
    .all<ActivityRow>();
  return results;
}

/** Contrôles métier sur une saisie. Retourne la liste des erreurs (vide si OK). */
export function checkEntries(month: string, entries: Entry[], activities: ActivityRow[]): string[] {
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
    if (act.kind === 'travail' && ((act.missionStart && e.date < act.missionStart) || (act.missionEnd && e.date > act.missionEnd))) {
      errors.push(`Le ${e.date} est en dehors des dates de la mission ${act.missionLabel}`);
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

