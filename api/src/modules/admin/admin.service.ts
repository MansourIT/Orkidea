import type { AdminTimesheetBoard, AdminTimesheetDetail, AdminTimesheetRow, Mission, TimesheetStatus, User } from '../../../../shared/types';
import { STATUS_LABELS } from '../../../../shared/types';
import { workingDays } from '../../../../shared/holidays';
import { submissionDeadline } from '../../../../shared/submission';
import { auditStmt } from '../../core/audit';
import { isoIn, nowIso } from '../../core/clock';
import { newId, randomToken, sha256 } from '../../core/crypto';
import { fail } from '../../core/errors';
import type { Mail } from '../../core/mail';
import { getTimesheetById, listActivities, parseWorkedHolidays } from '../timesheets/timesheets.repository';
import { MISSIONS_TO_VALIDATE_SQL, VALIDATION_TTL, toTimesheet, validationRequestMail, type ServiceCtx } from '../timesheets/timesheets.service';

const LATE_STATUSES = new Set(['NON_COMMENCE', 'BROUILLON', 'REJETE']);

/** Tableau de bord du mois : consultants actifs (et admins ayant une mission). */
export async function board(ctx: ServiceCtx, month: string): Promise<AdminTimesheetBoard> {
  const region = ctx.settings.calendar.holidayRegion;
  const deadline = submissionDeadline(month, ctx.settings.submission, region);
  const { results } = await ctx.db
    .prepare(
      `SELECT u.id AS consultantId, u.name AS consultant, u.email AS consultantEmail, t.id, COALESCE(t.status, 'NON_COMMENCE') AS status,
              t.submitted_at AS submittedAt, t.validated_at AS validatedAt,
              COALESCE((SELECT SUM(e.quantity) FROM entries e JOIN activities a ON a.id = e.activity_id
                        WHERE e.timesheet_id = t.id AND a.kind = 'travail'), 0) AS workedDays,
              COALESCE((SELECT SUM(e.quantity) FROM entries e JOIN activities a ON a.id = e.activity_id
                        WHERE e.timesheet_id = t.id AND a.kind = 'absence'), 0) AS absenceDays
       FROM users u LEFT JOIN timesheets t ON t.consultant_id = u.id AND t.month = ?
       WHERE u.active = 1 AND (u.role = 'consultant' OR EXISTS (SELECT 1 FROM missions m WHERE m.consultant_id = u.id))
       ORDER BY u.name`,
    )
    .bind(month)
    .all<Omit<AdminTimesheetRow, 'late'>>();
  return {
    month,
    workingDays: workingDays(month, region),
    deadline,
    rows: results.map((r) => ({ ...r, late: ctx.today > deadline && LATE_STATUSES.has(r.status) })),
  };
}

/** Détail d'un CRA : saisies, validations et activités (y compris archivées) du consultant. */
export async function detail(ctx: ServiceCtx, id: string): Promise<AdminTimesheetDetail> {
  const row = await requireTimesheet(ctx.db, id);
  const consultant = await ctx.db.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(row.consultant_id).first<{ id: string; name: string; email: string }>();
  const [timesheet, activities] = await Promise.all([toTimesheet(ctx, row), listActivities(ctx.db, row.consultant_id, ctx.settings, { timesheetId: id })]);
  return { id, consultant: consultant!, timesheet, activities };
}

/** Clôture de tous les CRA validés du mois (chaque clôture est tracée dans l'historique). */
export async function closeValidated(ctx: ServiceCtx, admin: User, month: string): Promise<number> {
  const { results } = await ctx.db.prepare(`SELECT id FROM timesheets WHERE month = ? AND status = 'VALIDE'`).bind(month).all<{ id: string }>();
  if (!results.length) return 0;
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const { id } of results) {
    stmts.push(
      auditStmt(
        ctx.db,
        { timesheetId: id, action: 'CLOTURE', actorType: 'admin', actor: admin.id, from: 'VALIDE', to: 'CLOTURE', comment: 'Clôture groupée du mois' },
        { sql: `EXISTS (SELECT 1 FROM timesheets WHERE id = ? AND status = 'VALIDE')`, params: [id] },
      ),
      ctx.db.prepare(`UPDATE timesheets SET status = 'CLOTURE', closed_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'VALIDE'`).bind(now, id),
    );
  }
  const res = await ctx.db.batch(stmts);
  return res.filter((_, i) => i % 2 === 1).reduce((n, r) => n + r.meta.changes, 0);
}

/** Valeur CSV (séparateur « ; », guillemets doublés). */
function csvCell(v: string | number | null): string {
  if (v === null) return '';
  const s = typeof v === 'number' ? v.toLocaleString('fr-FR', { maximumFractionDigits: 2, useGrouping: false }) : v;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Export du mois pour la paie et la facturation : une ligne par consultant et par activité
 * (une ligne vide pour un consultant sans saisie). Format Excel français : « ; », virgule décimale, BOM UTF-8.
 */
export async function exportMonthCsv(ctx: ServiceCtx, month: string): Promise<string> {
  const b = await board(ctx, month);
  const { results } = await ctx.db
    .prepare(
      `SELECT t.consultant_id AS consultantId, a.kind, a.label AS activity, m.label AS mission, cl.name AS client, m.tjm,
              SUM(e.quantity) AS days
       FROM timesheets t JOIN entries e ON e.timesheet_id = t.id JOIN activities a ON a.id = e.activity_id
       LEFT JOIN missions m ON m.id = a.mission_id LEFT JOIN clients cl ON cl.id = m.client_id
       WHERE t.month = ?
       GROUP BY t.consultant_id, a.id
       ORDER BY a.kind DESC, m.label, a.label`,
    )
    .bind(month)
    .all<{ consultantId: string; kind: 'travail' | 'absence'; activity: string; mission: string | null; client: string | null; tjm: number | null; days: number }>();
  const header = ['Mois', 'Consultant', 'Email', 'Statut', 'Soumis le', 'Type', 'Mission', 'Client', 'Activité', 'Jours', 'TJM (€ HT)', 'Montant indicatif (€ HT)'];
  const lines = [header.join(';')];
  for (const r of b.rows) {
    const status = r.status === 'NON_COMMENCE' ? 'Non commencé' : STATUS_LABELS[r.status];
    const submitted = r.submittedAt ? r.submittedAt.slice(0, 10).split('-').reverse().join('/') : '';
    const base = [month, r.consultant, r.consultantEmail, status, submitted];
    const mine = results.filter((x) => x.consultantId === r.consultantId);
    if (!mine.length) lines.push([...base, '', '', '', '', 0, null, null].map(csvCell).join(';'));
    for (const x of mine) {
      const amount = x.kind === 'travail' && x.tjm !== null ? x.days * x.tjm : null;
      lines.push([...base, x.kind === 'travail' ? 'Travail' : 'Absence', x.mission ?? '', x.client ?? '', x.activity, x.days, x.kind === 'travail' ? x.tjm : null, amount].map(csvCell).join(';'));
    }
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

async function requireTimesheet(db: D1Database, id: string) {
  const row = await getTimesheetById(db, id);
  if (!row) throw fail(404, 'CRA introuvable');
  return row;
}

export async function close(ctx: ServiceCtx, admin: User, id: string): Promise<void> {
  const row = await requireTimesheet(ctx.db, id);
  const now = nowIso();
  const [, res] = await ctx.db.batch([
    // Événement inséré avant la transition, seulement si le CRA est encore VALIDE (pas de doublon en cas de double clic).
    auditStmt(
      ctx.db,
      { timesheetId: id, action: 'CLOTURE', actorType: 'admin', actor: admin.id, from: 'VALIDE', to: 'CLOTURE' },
      { sql: `EXISTS (SELECT 1 FROM timesheets WHERE id = ? AND status = 'VALIDE')`, params: [id] },
    ),
    ctx.db.prepare(`UPDATE timesheets SET status = 'CLOTURE', closed_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'VALIDE'`).bind(now, id),
  ]);
  if (!res.meta.changes) throw fail(409, `Seul un CRA validé peut être clôturé (statut actuel : ${row.status})`);
}

const REOPENABLE: TimesheetStatus[] = ['SOUMIS', 'VALIDE', 'REJETE', 'CLOTURE'];

/** Rouvre un CRA (retour en BROUILLON) : toutes les demandes de validation en cours ou passées sont annulées. */
export async function reopen(ctx: ServiceCtx, admin: User, id: string, comment: string | null): Promise<void> {
  const row = await requireTimesheet(ctx.db, id);
  if (!REOPENABLE.includes(row.status)) throw fail(409, 'Ce CRA est déjà en brouillon');
  const now = nowIso();
  const [, , res] = await ctx.db.batch([
    auditStmt(
      ctx.db,
      { timesheetId: id, action: 'REOUVERTURE', actorType: 'admin', actor: admin.id, from: row.status, to: 'BROUILLON', comment },
      { sql: 'EXISTS (SELECT 1 FROM timesheets WHERE id = ? AND status = ?)', params: [id, row.status] },
    ),
    ctx.db.prepare(`UPDATE validations SET status = 'ANNULE' WHERE timesheet_id = ? AND status != 'ANNULE'`).bind(id),
    ctx.db
      .prepare(`UPDATE timesheets SET status = 'BROUILLON', validated_at = NULL, closed_at = NULL, updated_at = ? WHERE id = ? AND status = ?`)
      .bind(now, id, row.status),
  ]);
  if (!res.meta.changes) throw fail(409, 'Le statut du CRA a changé entre-temps, rechargez la page');
}

/** Renvoie les demandes de validation en attente avec de nouveaux liens (les anciens deviennent invalides). */
export async function resendValidations(ctx: ServiceCtx, admin: User, id: string): Promise<Mail[]> {
  const row = await requireTimesheet(ctx.db, id);
  if (row.status !== 'SOUMIS') throw fail(409, 'Seul un CRA en attente de validation peut être relancé');
  const consultant = await ctx.db.prepare('SELECT name FROM users WHERE id = ?').bind(row.consultant_id).first<{ name: string }>();
  const { results: missions } = await ctx.db
    .prepare(`${MISSIONS_TO_VALIDATE_SQL} AND m.id IN (SELECT mission_id FROM validations WHERE timesheet_id = ? AND status = 'EN_ATTENTE')`)
    .bind(id, id)
    .all<{ id: string; label: string; validator_name: string | null; validator_email: string; client_name: string }>();
  if (!missions.length) throw fail(409, 'Aucune demande de validation en attente');
  const stmts: D1PreparedStatement[] = [];
  const mails: Mail[] = [];
  for (const m of missions) {
    const token = randomToken();
    // Le valideur peut avoir changé sur la mission : on reprend l'email actuel.
    stmts.push(
      ctx.db
        .prepare(`UPDATE validations SET token_hash = ?, validator_email = ?, expires_at = ? WHERE timesheet_id = ? AND mission_id = ? AND status = 'EN_ATTENTE'`)
        .bind(await sha256(token), m.validator_email, isoIn(VALIDATION_TTL), id, m.id),
    );
    mails.push(validationRequestMail(ctx.appUrl, consultant?.name ?? '', row.month, m, token));
  }
  stmts.push(
    auditStmt(ctx.db, {
      timesheetId: id,
      action: 'RELANCE',
      actorType: 'admin',
      actor: admin.id,
      from: 'SOUMIS',
      to: 'SOUMIS',
      comment: missions.map((m) => m.label).join(', '),
    }),
  );
  await ctx.db.batch(stmts);
  return mails;
}

// ---------------------------------------------------------------- Référentiels

interface MissionDbRow {
  id: string;
  consultant_id: string;
  consultant: string;
  client_id: string;
  client: string;
  label: string;
  start_date: string;
  end_date: string | null;
  tjm: number | null;
  client_validation: number;
  validator_name: string | null;
  validator_email: string | null;
  active: number;
  weekend_policy: Mission['weekendPolicy'];
  holiday_policy: Mission['holidayPolicy'];
  worked_holidays: string | null;
  holiday_region: Mission['holidayRegion'];
}

export async function listMissions(db: D1Database, id?: string): Promise<Mission[]> {
  const { results } = await db
    .prepare(
      `SELECT m.*, u.name AS consultant, cl.name AS client FROM missions m
       JOIN users u ON u.id = m.consultant_id JOIN clients cl ON cl.id = m.client_id
       ${id ? 'WHERE m.id = ?' : ''} ORDER BY m.created_at DESC, m.label`,
    )
    .bind(...(id ? [id] : []))
    .all<MissionDbRow>();
  const { results: acts } = await db
    .prepare(`SELECT id, mission_id, label, color, active FROM activities WHERE mission_id IS NOT NULL ORDER BY label`)
    .all<{ id: string; mission_id: string; label: string; color: string; active: number }>();
  return results.map((m) => ({
    id: m.id,
    consultantId: m.consultant_id,
    consultant: m.consultant,
    clientId: m.client_id,
    client: m.client,
    label: m.label,
    startDate: m.start_date,
    endDate: m.end_date,
    tjm: m.tjm,
    clientValidation: !!m.client_validation,
    validatorName: m.validator_name,
    validatorEmail: m.validator_email,
    active: !!m.active,
    weekendPolicy: m.weekend_policy,
    holidayPolicy: m.holiday_policy,
    workedHolidays: parseWorkedHolidays(m.worked_holidays),
    holidayRegion: m.holiday_region,
    activities: acts
      .filter((a) => a.mission_id === m.id)
      .map((a) => ({ id: a.id, label: a.label, color: a.color, active: !!a.active })),
  }));
}

export async function getMission(db: D1Database, id: string): Promise<Mission> {
  const [m] = await listMissions(db, id);
  if (!m) throw fail(404, 'Mission introuvable');
  return m;
}

export async function ensureExists(db: D1Database, table: 'users' | 'clients', id: string, label: string): Promise<void> {
  const row = await db.prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw fail(400, `${label} introuvable`);
}

export async function emailTaken(db: D1Database, email: string, exceptId?: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .bind(email, exceptId ?? '')
    .first();
  return !!row;
}

export function newActivityStmt(db: D1Database, missionId: string, label: string, color: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO activities (id, mission_id, label, kind, color) VALUES (?, ?, ?, 'travail', ?)`).bind(newId(), missionId, label, color);
}
