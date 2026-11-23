import type { Activity, Entry, SaveTimesheetBody, Timesheet, User } from '../../../../shared/types';
import { EDITABLE_STATUSES } from '../../../../shared/types';
import type { AppSettings } from '../../../../shared/settings';
import { workingDays } from '../../../../shared/holidays';
import { addMonths, frDate, monthName, monthOf } from '../../../../shared/dates';
import { isTooOld, missingWorkingDays, submissionOpensOn, submissionRefusal } from '../../../../shared/submission';
import { auditStmt } from '../../core/audit';
import { DAY, isoIn, nowIso } from '../../core/clock';
import { newId, randomToken, sha256 } from '../../core/crypto';
import { fail } from '../../core/errors';
import type { Mail } from '../../core/mail';
import { button, escapeHtml, layout } from '../../core/mail';
import { checkEntries } from './check-entries';
import {
  getOrCreateTimesheet,
  getTimesheetRow,
  listActivities,
  loadEntries,
  loadValidations,
  type TimesheetRow,
} from './timesheets.repository';
import { renderTimesheetPdf } from './timesheets.pdf';

export const VALIDATION_TTL = 30 * DAY;
/** Fenêtre de consultation / création d'un CRA autour du mois courant. */
export const MONTHS_BACK = 24;
export const MONTHS_AHEAD = 2;

export interface ServiceCtx {
  db: D1Database;
  settings: AppSettings;
  today: string;
  appUrl: string;
}

export function assertMonthInRange(month: string, today: string): void {
  const current = monthOf(today);
  if (month < addMonths(current, -MONTHS_BACK) || month > addMonths(current, MONTHS_AHEAD)) {
    throw fail(400, `Mois hors de la période autorisée (${MONTHS_BACK} mois en arrière, ${MONTHS_AHEAD} en avant)`);
  }
}

function blockedReason(ctx: ServiceCtx, row: TimesheetRow): string | null {
  if (!EDITABLE_STATUSES.includes(row.status)) return null;
  if (row.status === 'BROUILLON' && isTooOld(row.month, ctx.today, ctx.settings.submission)) {
    return `Ce mois est trop ancien pour être modifié ou soumis (au-delà de ${ctx.settings.submission.pastMonthsLimit} mois)`;
  }
  return submissionRefusal(row.month, ctx.today, ctx.settings.submission, ctx.settings.calendar.holidayRegion);
}

export async function toTimesheet(ctx: ServiceCtx, row: TimesheetRow): Promise<Timesheet> {
  const [entries, validations] = await Promise.all([loadEntries(ctx.db, row.id), loadValidations(ctx.db, row.id)]);
  const region = ctx.settings.calendar.holidayRegion;
  return {
    month: row.month,
    status: row.status,
    comment: row.comment,
    entries,
    validations,
    workingDays: workingDays(row.month, region),
    submittedAt: row.submitted_at,
    submissionOpensOn: submissionOpensOn(row.month, ctx.settings.submission, region),
    submissionBlockedReason: blockedReason(ctx, row),
  };
}

export async function getTimesheet(ctx: ServiceCtx, user: User, month: string): Promise<Timesheet> {
  assertMonthInRange(month, ctx.today);
  return toTimesheet(ctx, await getOrCreateTimesheet(ctx.db, user.id, month));
}

/** Activités autorisées pour contrôler une saisie : actives + désactivées déjà présentes dans ce CRA. */
async function activitiesFor(ctx: ServiceCtx, userId: string, timesheetId: string): Promise<Activity[]> {
  return listActivities(ctx.db, userId, ctx.settings, { timesheetId });
}

/** Enregistrement du brouillon : remplace toutes les lignes du mois. */
export async function saveTimesheet(ctx: ServiceCtx, user: User, month: string, body: SaveTimesheetBody): Promise<Timesheet> {
  assertMonthInRange(month, ctx.today);
  const row = await getOrCreateTimesheet(ctx.db, user.id, month);
  if (!EDITABLE_STATUSES.includes(row.status)) throw fail(409, 'Ce CRA n’est plus modifiable');
  if (row.status === 'BROUILLON' && isTooOld(month, ctx.today, ctx.settings.submission)) {
    throw fail(409, `Ce mois est trop ancien pour être modifié (au-delà de ${ctx.settings.submission.pastMonthsLimit} mois)`);
  }
  const errors = checkEntries(month, body.entries, await activitiesFor(ctx, user.id, row.id));
  if (errors.length) throw fail(422, 'Saisie invalide', { details: errors });

  // undefined = inchangé ; null ou "" = effacé.
  const comment = body.comment === undefined ? row.comment : body.comment ? body.comment.slice(0, 2000) : null;
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM entries WHERE timesheet_id = ?').bind(row.id),
    ...body.entries.map((e) =>
      ctx.db.prepare('INSERT INTO entries (timesheet_id, date, activity_id, quantity) VALUES (?, ?, ?, ?)').bind(row.id, e.date, e.activityId, e.quantity),
    ),
    ctx.db.prepare('UPDATE timesheets SET comment = ?, updated_at = ? WHERE id = ?').bind(comment, nowIso(), row.id),
  ]);
  return toTimesheet(ctx, { ...row, comment });
}

interface MissionToValidate {
  id: string;
  label: string;
  validator_name: string | null;
  validator_email: string;
  client_name: string;
}

export function validationRequestMail(appUrl: string, consultant: string, month: string, m: MissionToValidate, token: string): Mail {
  const link = `${appUrl}/validation/${encodeURIComponent(token)}`;
  return {
    to: m.validator_email,
    toName: m.validator_name ?? undefined,
    subject: `CRA ${monthName(month)} de ${consultant} à valider – ${m.label}`,
    html: layout(
      'Compte rendu d’activité à valider',
      `<p>Bonjour${m.validator_name ? ' ' + escapeHtml(m.validator_name) : ''},</p>
       <p>${escapeHtml(consultant)} a soumis son CRA de <b>${monthName(month)}</b> pour la mission <b>${escapeHtml(m.label)}</b> (${escapeHtml(m.client_name)}).</p>
       ${button(link, 'Consulter et valider')}<p style="font-size:12px;color:#888">Lien valable 30 jours, sans création de compte.</p>`,
    ),
  };
}

export const MISSIONS_TO_VALIDATE_SQL = `SELECT DISTINCT m.id, m.label, m.validator_name, m.validator_email, cl.name AS client_name
  FROM entries e JOIN activities a ON a.id = e.activity_id
  JOIN missions m ON m.id = a.mission_id JOIN clients cl ON cl.id = m.client_id
  WHERE e.timesheet_id = ? AND m.client_validation = 1`;

/**
 * Soumission. Pour chaque mission présente dans le CRA dont le contrat impose une validation client,
 * une demande est envoyée au valideur. Sans validation requise, le CRA passe directement à VALIDE.
 * Retourne le CRA et les emails à envoyer.
 */
export async function submitTimesheet(ctx: ServiceCtx, user: User, month: string): Promise<{ timesheet: Timesheet; mails: Mail[] }> {
  assertMonthInRange(month, ctx.today);
  const db = ctx.db;
  const row = await getTimesheetRow(db, user.id, month);
  if (!row || !EDITABLE_STATUSES.includes(row.status)) throw fail(409, 'Ce CRA ne peut pas être soumis');
  const entries = await loadEntries(db, row.id);
  if (!entries.length) throw fail(422, 'Le CRA est vide');

  const blocked = blockedReason(ctx, row);
  if (blocked) throw fail(422, blocked);

  // Les missions ou le paramétrage ont pu changer depuis l'enregistrement : on recontrôle tout.
  const errors = checkEntries(month, entries, await activitiesFor(ctx, user.id, row.id));
  if (errors.length) throw fail(422, 'Saisie invalide', { details: errors });

  if (ctx.settings.submission.completeness === 'BLOQUER') {
    const missing = missingWorkingDays(month, entries, ctx.settings.calendar.holidayRegion);
    if (missing.length) {
      throw fail(422, `${missing.length} jour(s) ouvré(s) non renseigné(s)`, { details: missing.map(frDate), code: 'JOURS_MANQUANTS' });
    }
  }

  const { results: missions } = await db.prepare(MISSIONS_TO_VALIDATE_SQL).bind(row.id).all<MissionToValidate>();

  const now = nowIso();
  // Une nouvelle soumission remplace toutes les demandes précédentes (les anciens liens deviennent invalides).
  const stmts = [db.prepare(`UPDATE validations SET status = 'ANNULE' WHERE timesheet_id = ? AND status != 'ANNULE'`).bind(row.id)];
  const mails: Mail[] = [];
  for (const m of missions) {
    const token = randomToken();
    stmts.push(
      db
        .prepare('INSERT INTO validations (id, timesheet_id, mission_id, token_hash, validator_email, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(newId(), row.id, m.id, await sha256(token), m.validator_email, isoIn(VALIDATION_TTL)),
    );
    mails.push(validationRequestMail(ctx.appUrl, user.name, month, m, token));
  }

  const newStatus = missions.length ? 'SOUMIS' : 'VALIDE';
  stmts.push(
    db
      .prepare('UPDATE timesheets SET status = ?, submitted_at = ?, validated_at = ?, updated_at = ? WHERE id = ?')
      .bind(newStatus, now, newStatus === 'VALIDE' ? now : null, now, row.id),
    auditStmt(db, {
      timesheetId: row.id,
      action: 'SOUMISSION',
      actorType: 'consultant',
      actor: user.id,
      from: row.status,
      to: newStatus,
      comment: missions.length ? `Validation demandée : ${missions.map((m) => m.label).join(', ')}` : null,
    }),
  );
  await db.batch(stmts);

  const updated = (await getTimesheetRow(db, user.id, month))!;
  return { timesheet: await toTimesheet(ctx, updated), mails };
}

/** PDF d'un CRA (consultant ou admin). */
export async function timesheetPdf(ctx: ServiceCtx, consultant: { id: string; name: string }, row: TimesheetRow): Promise<Response> {
  const ts = await toTimesheet(ctx, row);
  const acts = await listActivities(ctx.db, consultant.id, ctx.settings, { timesheetId: row.id });
  const pdf = await renderTimesheetPdf({ consultant: consultant.name, timesheet: ts, activities: acts });
  const fileName = `CRA-${row.month}-${consultant.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_')}.pdf`;
  return new Response(pdf, {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${fileName}"` },
  });
}

export type { Entry };
