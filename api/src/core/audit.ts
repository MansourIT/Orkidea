import type { TimesheetEvent, TimesheetEventAction, TimesheetStatus } from '../../../shared/types';
import { nowIso } from './clock';
import { newId } from './crypto';

export interface AuditInput {
  timesheetId: string;
  action: TimesheetEventAction;
  actorType: TimesheetEvent['actorType'];
  actor: string;
  from: TimesheetStatus | null;
  to: TimesheetStatus | null;
  comment?: string | null;
}

/**
 * Requête d'insertion dans l'historique, à ajouter au batch de la transition.
 * `when` (SQL + paramètres) n'insère l'événement que si la transition a bien eu lieu.
 */
export function auditStmt(db: D1Database, e: AuditInput, when?: { sql: string; params: unknown[] }): D1PreparedStatement {
  const values = [newId(), e.timesheetId, e.action, e.actorType, e.actor, e.from, e.to, e.comment ?? null, nowIso()];
  return db
    .prepare(
      `INSERT INTO timesheet_events (id, timesheet_id, action, actor_type, actor, from_status, to_status, comment, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?${when ? ` WHERE ${when.sql}` : ''}`,
    )
    .bind(...values, ...(when?.params ?? []));
}

export async function listEvents(db: D1Database, timesheetId: string): Promise<TimesheetEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT action, actor_type AS actorType, actor, from_status AS fromStatus, to_status AS toStatus, comment, created_at AS createdAt
       FROM timesheet_events WHERE timesheet_id = ? ORDER BY created_at, rowid`,
    )
    .bind(timesheetId)
    .all<TimesheetEvent>();
  return results;
}
