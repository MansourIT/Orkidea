import type { Activity, Entry, TimesheetStatus, TimesheetSummary, ValidationSummary } from '../../../../shared/types';
import type { AppSettings, DayPolicy, MissionCalendarOverrides } from '../../../../shared/settings';
import type { HolidayCode, HolidayRegion } from '../../../../shared/holidays';
import { workingDays } from '../../../../shared/holidays';
import { addMonths, monthDiff } from '../../../../shared/dates';
import { resolveRules } from '../../../../shared/calendar-rules';
import { newId } from '../../core/crypto';

export interface TimesheetRow {
  id: string;
  consultant_id: string;
  month: string;
  status: TimesheetStatus;
  comment: string | null;
  submitted_at: string | null;
}

const TS_COLUMNS = 'id, consultant_id, month, status, comment, submitted_at';

export async function getTimesheetRow(db: D1Database, userId: string, month: string): Promise<TimesheetRow | null> {
  return db.prepare(`SELECT ${TS_COLUMNS} FROM timesheets WHERE consultant_id = ? AND month = ?`).bind(userId, month).first<TimesheetRow>();
}

export async function getTimesheetById(db: D1Database, id: string): Promise<TimesheetRow | null> {
  return db.prepare(`SELECT ${TS_COLUMNS} FROM timesheets WHERE id = ?`).bind(id).first<TimesheetRow>();
}

export async function getOrCreateTimesheet(db: D1Database, userId: string, month: string): Promise<TimesheetRow> {
  const existing = await getTimesheetRow(db, userId, month);
  if (existing) return existing;
  await db.prepare('INSERT OR IGNORE INTO timesheets (id, consultant_id, month) VALUES (?, ?, ?)').bind(newId(), userId, month).run();
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

interface ActivityDbRow {
  id: string;
  missionId: string | null;
  missionLabel: string | null;
  clientName: string | null;
  label: string;
  kind: Activity['kind'];
  color: string;
  startDate: string | null;
  endDate: string | null;
  weekendPolicy: DayPolicy | null;
  holidayPolicy: DayPolicy | null;
  workedHolidays: string | null;
  holidayRegion: HolidayRegion | null;
}

const ACTIVITY_SELECT = `SELECT a.id, a.mission_id AS missionId, m.label AS missionLabel, cl.name AS clientName,
       a.label, a.kind, a.color, m.start_date AS startDate, m.end_date AS endDate,
       m.weekend_policy AS weekendPolicy, m.holiday_policy AS holidayPolicy,
       m.worked_holidays AS workedHolidays, m.holiday_region AS holidayRegion
FROM activities a
LEFT JOIN missions m ON m.id = a.mission_id
LEFT JOIN clients cl ON cl.id = m.client_id`;

export function parseWorkedHolidays(raw: string | null): HolidayCode[] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as HolidayCode[]) : null;
  } catch {
    return null;
  }
}

function toActivity(r: ActivityDbRow, settings: AppSettings, archived: boolean): Activity {
  const overrides: MissionCalendarOverrides = {
    weekendPolicy: r.weekendPolicy,
    holidayPolicy: r.holidayPolicy,
    workedHolidays: parseWorkedHolidays(r.workedHolidays),
    holidayRegion: r.holidayRegion,
  };
  return {
    id: r.id,
    missionId: r.missionId,
    missionLabel: r.missionLabel,
    clientName: r.clientName,
    label: r.label,
    kind: r.kind,
    color: r.color,
    startDate: r.startDate,
    endDate: r.endDate,
    rules: resolveRules(settings.calendar, r.kind, overrides),
    ...(archived ? { archived: true } : {}),
  };
}

/**
 * Activités du consultant : celles de ses missions actives + absences communes, dans l'ordre choisi.
 * Avec timesheetId : ajoute les activités désactivées encore présentes dans ce CRA (affichage, PDF, conservation).
 */
export async function listActivities(
  db: D1Database,
  userId: string,
  settings: AppSettings,
  opts: { timesheetId?: string } = {},
): Promise<Activity[]> {
  const { results } = await db
    .prepare(
      `${ACTIVITY_SELECT}
       LEFT JOIN activity_order o ON o.activity_id = a.id AND o.user_id = ?1
       WHERE a.active = 1 AND (a.mission_id IS NULL OR (m.consultant_id = ?1 AND m.active = 1))
       ORDER BY COALESCE(o.position, 1000), a.kind DESC, m.label, a.label`,
    )
    .bind(userId)
    .all<ActivityDbRow>();
  const list = results.map((r) => toActivity(r, settings, false));
  if (opts.timesheetId) {
    const known = new Set(list.map((a) => a.id));
    const { results: used } = await db
      .prepare(`${ACTIVITY_SELECT} WHERE a.id IN (SELECT DISTINCT activity_id FROM entries WHERE timesheet_id = ?) ORDER BY m.label, a.label`)
      .bind(opts.timesheetId)
      .all<ActivityDbRow>();
    for (const r of used) if (!known.has(r.id)) list.push(toActivity(r, settings, true));
  }
  return list;
}

/** Résumés des CRA du consultant entre deux mois inclus (les mois sans CRA sont « NON_COMMENCE »). */
export async function listSummaries(
  db: D1Database,
  userId: string,
  from: string,
  to: string,
  region: HolidayRegion,
): Promise<TimesheetSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT t.month, t.status, t.submitted_at AS submittedAt,
              COALESCE(SUM(CASE WHEN a.kind = 'travail' THEN e.quantity END), 0) AS workedDays,
              COALESCE(SUM(CASE WHEN a.kind = 'absence' THEN e.quantity END), 0) AS absenceDays
       FROM timesheets t
       LEFT JOIN entries e ON e.timesheet_id = t.id
       LEFT JOIN activities a ON a.id = e.activity_id
       WHERE t.consultant_id = ? AND t.month BETWEEN ? AND ?
       GROUP BY t.id`,
    )
    .bind(userId, from, to)
    .all<Omit<TimesheetSummary, 'workingDays'>>();
  const byMonth = new Map(results.map((r) => [r.month, r]));
  const out: TimesheetSummary[] = [];
  for (let i = monthDiff(from, to); i >= 0; i--) {
    const month = addMonths(from, i);
    const r = byMonth.get(month);
    out.push({
      month,
      status: r?.status ?? 'NON_COMMENCE',
      workedDays: r?.workedDays ?? 0,
      absenceDays: r?.absenceDays ?? 0,
      workingDays: workingDays(month, region),
      submittedAt: r?.submittedAt ?? null,
    });
  }
  return out;
}
