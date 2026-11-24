import { createRoute } from '@hono/zod-openapi';
import type { AdminUser, Client } from '../../../../shared/types';
import { listEvents } from '../../core/audit';
import { fail } from '../../core/errors';
import { sendInBackground } from '../../core/mail';
import { DateSchema, EmailSchema, IdSchema, jsonBody, MonthSchema, newRouter, ok, z } from '../../core/router';
import { requireAdmin, requireUser } from '../auth/auth.middleware';
import { saveSettings } from '../settings/settings.repository';
import { AppSettingsSchema, DayPolicySchema, HolidayCodeSchema, HolidayRegionSchema } from '../settings/settings.schemas';
import { getTimesheetById } from '../timesheets/timesheets.repository';
import { serviceCtx } from '../timesheets/timesheets.routes';
import { timesheetPdf } from '../timesheets/timesheets.service';
import * as svc from './admin.service';

/** Back-office Orkidea (rôle admin). */
export const adminRoutes = newRouter();
adminRoutes.use('*', requireUser, requireAdmin);

const IdParam = z.object({ id: IdSchema });
const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide (attendu #RRGGBB)');
const LabelSchema = z.string().trim().min(1).max(120);

// ---------------------------------------------------------------- CRA

adminRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/timesheets',
    tags: ['Admin'],
    summary: 'Tableau de bord du mois',
    request: { query: z.object({ month: MonthSchema }) },
    responses: { 200: ok('Statut de chaque consultant') },
  }),
  async (c) => c.json(await svc.board(await serviceCtx(c), c.req.valid('query').month), 200),
);

adminRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/timesheets/export',
    tags: ['Admin'],
    summary: 'Export CSV du mois (paie / facturation)',
    request: { query: z.object({ month: MonthSchema }) },
    responses: { 200: { description: 'CSV (séparateur ;)', content: { 'text/csv': { schema: z.string() } } } },
  }),
  async (c) => {
    const { month } = c.req.valid('query');
    const csv = await svc.exportMonthCsv(await serviceCtx(c), month);
    return new Response(csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="CRA-${month}.csv"` },
    });
  },
);

adminRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/timesheets/close-validated',
    tags: ['Admin'],
    summary: 'Clôture de tous les CRA validés du mois',
    request: { query: z.object({ month: MonthSchema }) },
    responses: { 200: ok('Nombre de CRA clôturés') },
  }),
  async (c) => c.json({ closed: await svc.closeValidated(await serviceCtx(c), c.get('user'), c.req.valid('query').month) }, 200),
);

adminRoutes.openapi(
  createRoute({ method: 'get', path: '/timesheets/{id}/detail', tags: ['Admin'], summary: 'Détail d’un CRA (saisies, validations, activités)', request: { params: IdParam }, responses: { 200: ok('Détail'), 404: ok('Introuvable') } }),
  async (c) => c.json(await svc.detail(await serviceCtx(c), c.req.valid('param').id), 200),
);

adminRoutes.openapi(
  createRoute({ method: 'post', path: '/timesheets/{id}/close', tags: ['Admin'], summary: 'Clôture d’un CRA validé', request: { params: IdParam }, responses: { 200: ok('Clôturé'), 404: ok('Introuvable'), 409: ok('Non validé') } }),
  async (c) => {
    await svc.close(await serviceCtx(c), c.get('user'), c.req.valid('param').id);
    return c.json({ ok: true }, 200);
  },
);

adminRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/timesheets/{id}/reopen',
    tags: ['Admin'],
    summary: 'Réouverture (retour en brouillon)',
    request: { params: IdParam, body: { required: false, content: { 'application/json': { schema: z.object({ comment: z.string().max(2000).optional() }) } } } },
    responses: { 200: ok('Rouvert'), 404: ok('Introuvable'), 409: ok('Déjà en brouillon') },
  }),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { comment?: unknown };
    const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim().slice(0, 2000) : null;
    await svc.reopen(await serviceCtx(c), c.get('user'), c.req.valid('param').id, comment);
    return c.json({ ok: true }, 200);
  },
);

adminRoutes.openapi(
  createRoute({ method: 'post', path: '/timesheets/{id}/resend', tags: ['Admin'], summary: 'Relance des valideurs (nouveaux liens)', request: { params: IdParam }, responses: { 200: ok('Relancé') } }),
  async (c) => {
    const mails = await svc.resendValidations(await serviceCtx(c), c.get('user'), c.req.valid('param').id);
    for (const m of mails) sendInBackground(c, m, 'relance validation');
    return c.json({ ok: true, sent: mails.length }, 200);
  },
);

adminRoutes.openapi(
  createRoute({ method: 'get', path: '/timesheets/{id}/events', tags: ['Admin'], summary: 'Historique du CRA', request: { params: IdParam }, responses: { 200: ok('Événements') } }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await getTimesheetById(c.env.DB, id))) throw fail(404, 'CRA introuvable');
    return c.json(await listEvents(c.env.DB, id), 200);
  },
);

adminRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/timesheets/{id}/pdf',
    tags: ['Admin'],
    summary: 'PDF du CRA d’un consultant',
    request: { params: IdParam },
    responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: z.string() } } }, 404: ok('Introuvable') },
  }),
  async (c) => {
    const row = await getTimesheetById(c.env.DB, c.req.valid('param').id);
    if (!row) throw fail(404, 'CRA introuvable');
    const consultant = await c.env.DB.prepare('SELECT id, name FROM users WHERE id = ?').bind(row.consultant_id).first<{ id: string; name: string }>();
    return timesheetPdf(await serviceCtx(c), consultant!, row);
  },
);

// ---------------------------------------------------------------- Paramétrage

adminRoutes.openapi(
  createRoute({ method: 'get', path: '/settings', tags: ['Admin'], summary: 'Paramétrage (calendrier, soumission)', responses: { 200: ok('Paramétrage') } }),
  async (c) => c.json((await serviceCtx(c)).settings, 200),
);

adminRoutes.openapi(
  createRoute({ method: 'put', path: '/settings', tags: ['Admin'], summary: 'Modification du paramétrage', request: { body: jsonBody(AppSettingsSchema) }, responses: { 200: ok('Enregistré') } }),
  async (c) => {
    const settings = c.req.valid('json');
    await saveSettings(c.env.DB, settings, c.get('user').id);
    return c.json(settings, 200);
  },
);

// ---------------------------------------------------------------- Utilisateurs

adminRoutes.openapi(
  createRoute({ method: 'get', path: '/users', tags: ['Admin'], summary: 'Utilisateurs', responses: { 200: ok('Liste') } }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id, email, name, role, active FROM users ORDER BY name').all<Omit<AdminUser, 'active'> & { active: number }>();
    return c.json(results.map((u) => ({ ...u, active: !!u.active })), 200);
  },
);

const RoleSchema = z.enum(['consultant', 'admin']);

adminRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/users',
    tags: ['Admin'],
    summary: 'Création d’un utilisateur',
    request: { body: jsonBody(z.object({ email: EmailSchema, name: LabelSchema, role: RoleSchema.optional() })) },
    responses: { 201: ok('Créé'), 409: ok('Email déjà utilisé') },
  }),
  async (c) => {
    const b = c.req.valid('json');
    if (await svc.emailTaken(c.env.DB, b.email)) throw fail(409, 'Un utilisateur existe déjà avec cet email');
    const id = crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)').bind(id, b.email, b.name, b.role ?? 'consultant').run();
    return c.json({ id }, 201);
  },
);

adminRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/users/{id}',
    tags: ['Admin'],
    summary: 'Modification / désactivation d’un utilisateur',
    request: { params: IdParam, body: jsonBody(z.object({ email: EmailSchema.optional(), name: LabelSchema.optional(), role: RoleSchema.optional(), active: z.boolean().optional() })) },
    responses: { 200: ok('Modifié'), 404: ok('Introuvable'), 409: ok('Conflit') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const me = c.get('user');
    const current = await c.env.DB.prepare('SELECT id, email, name, role, active FROM users WHERE id = ?').bind(id).first<Omit<AdminUser, 'active'> & { active: number }>();
    if (!current) throw fail(404, 'Utilisateur introuvable');
    if (id === me.id && (b.active === false || b.role === 'consultant')) throw fail(409, 'Vous ne pouvez pas retirer vos propres droits d’administration');
    if (b.email && (await svc.emailTaken(c.env.DB, b.email, id))) throw fail(409, 'Un utilisateur existe déjà avec cet email');
    const next = { ...current, ...b, active: b.active ?? !!current.active };
    const stmts = [
      c.env.DB.prepare('UPDATE users SET email = ?, name = ?, role = ?, active = ? WHERE id = ?').bind(next.email, next.name, next.role, next.active ? 1 : 0, id),
    ];
    // Désactivation : les sessions ouvertes sont coupées immédiatement.
    if (!next.active) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
    await c.env.DB.batch(stmts);
    return c.json({ id: next.id, email: next.email, name: next.name, role: next.role, active: next.active }, 200);
  },
);

// ---------------------------------------------------------------- Clients

const SiretSchema = z.string().regex(/^\d{14}$/, 'SIRET invalide (14 chiffres)');

adminRoutes.openapi(
  createRoute({ method: 'get', path: '/clients', tags: ['Admin'], summary: 'Clients', responses: { 200: ok('Liste') } }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id, name, siret FROM clients ORDER BY name').all<Client>();
    return c.json(results, 200);
  },
);

adminRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/clients',
    tags: ['Admin'],
    summary: 'Création d’un client',
    request: { body: jsonBody(z.object({ name: LabelSchema, siret: SiretSchema.nullable().optional() })) },
    responses: { 201: ok('Créé') },
  }),
  async (c) => {
    const b = c.req.valid('json');
    const id = crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO clients (id, name, siret) VALUES (?, ?, ?)').bind(id, b.name, b.siret ?? null).run();
    return c.json({ id }, 201);
  },
);

adminRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/clients/{id}',
    tags: ['Admin'],
    summary: 'Modification d’un client',
    request: { params: IdParam, body: jsonBody(z.object({ name: LabelSchema.optional(), siret: SiretSchema.nullable().optional() })) },
    responses: { 200: ok('Modifié'), 404: ok('Introuvable') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const current = await c.env.DB.prepare('SELECT id, name, siret FROM clients WHERE id = ?').bind(id).first<Client>();
    if (!current) throw fail(404, 'Client introuvable');
    const next = { ...current, ...b, siret: b.siret === undefined ? current.siret : b.siret };
    await c.env.DB.prepare('UPDATE clients SET name = ?, siret = ? WHERE id = ?').bind(next.name, next.siret, id).run();
    return c.json(next, 200);
  },
);

// ---------------------------------------------------------------- Missions

const MissionFields = {
  label: LabelSchema,
  startDate: DateSchema,
  endDate: DateSchema.nullable().optional(),
  tjm: z.number().min(0).max(100_000).nullable().optional(),
  clientValidation: z.boolean().optional(),
  validatorName: z.string().trim().max(120).nullable().optional(),
  validatorEmail: EmailSchema.nullable().optional(),
  weekendPolicy: DayPolicySchema.nullable().optional(),
  holidayPolicy: DayPolicySchema.nullable().optional(),
  workedHolidays: z.array(HolidayCodeSchema).max(13).nullable().optional(),
  holidayRegion: HolidayRegionSchema.nullable().optional(),
};

const MissionCreate = z.object({
  consultantId: IdSchema,
  clientId: IdSchema,
  ...MissionFields,
  color: ColorSchema.optional(),
  activities: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});

const MissionPatch = z.object({
  label: MissionFields.label.optional(),
  startDate: MissionFields.startDate.optional(),
  endDate: MissionFields.endDate,
  tjm: MissionFields.tjm,
  clientValidation: MissionFields.clientValidation,
  validatorName: MissionFields.validatorName,
  validatorEmail: MissionFields.validatorEmail,
  weekendPolicy: MissionFields.weekendPolicy,
  holidayPolicy: MissionFields.holidayPolicy,
  workedHolidays: MissionFields.workedHolidays,
  holidayRegion: MissionFields.holidayRegion,
  active: z.boolean().optional(),
  color: ColorSchema.optional(),
  addActivities: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});

interface MissionValues {
  label: string;
  startDate: string;
  endDate: string | null;
  clientValidation: boolean;
  validatorEmail: string | null;
}

/** Règles transverses d'une mission (après fusion pour un PATCH). */
function checkMission(m: MissionValues): void {
  if (m.endDate && m.endDate < m.startDate) throw fail(400, 'La date de fin doit être postérieure à la date de début');
  if (m.clientValidation && !m.validatorEmail) throw fail(400, 'Le nom et l’email du valideur sont requis si le contrat exige la validation client');
}

const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

adminRoutes.openapi(
  createRoute({ method: 'get', path: '/missions', tags: ['Admin'], summary: 'Missions et leurs activités', responses: { 200: ok('Liste') } }),
  async (c) => c.json(await svc.listMissions(c.env.DB), 200),
);

adminRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/missions',
    tags: ['Admin'],
    summary: 'Création d’une mission avec ses activités',
    request: { body: jsonBody(MissionCreate) },
    responses: { 201: ok('Créée'), 400: ok('Données invalides') },
  }),
  async (c) => {
    const b = c.req.valid('json');
    checkMission({ ...b, endDate: b.endDate ?? null, clientValidation: !!b.clientValidation, validatorEmail: b.validatorEmail ?? null });
    await svc.ensureExists(c.env.DB, 'users', b.consultantId, 'Consultant');
    await svc.ensureExists(c.env.DB, 'clients', b.clientId, 'Client');
    const id = crypto.randomUUID();
    const color = b.color ?? '#3B82F6';
    const labels = b.activities?.length ? [...new Set(b.activities)] : ['Prestation'];
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO missions (id, consultant_id, client_id, label, start_date, end_date, tjm, client_validation, validator_name, validator_email,
                               weekend_policy, holiday_policy, worked_holidays, holiday_region)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        b.consultantId,
        b.clientId,
        b.label,
        b.startDate,
        b.endDate ?? null,
        b.tjm ?? null,
        b.clientValidation ? 1 : 0,
        b.validatorName ?? null,
        b.validatorEmail ?? null,
        b.weekendPolicy ?? null,
        b.holidayPolicy ?? null,
        json(b.workedHolidays),
        b.holidayRegion ?? null,
      ),
      ...labels.map((label) => svc.newActivityStmt(c.env.DB, id, label, color)),
    ]);
    return c.json({ id }, 201);
  },
);

adminRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/missions/{id}',
    tags: ['Admin'],
    summary: 'Modification d’une mission (dates, valideur, surcharges de calendrier, activités)',
    request: { params: IdParam, body: jsonBody(MissionPatch) },
    responses: { 200: ok('Mission modifiée'), 404: ok('Introuvable') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const m = await svc.getMission(c.env.DB, id);
    const pick = <K extends keyof typeof b>(k: K, fallback: unknown) => (b[k] === undefined ? fallback : b[k]);
    const next = {
      label: pick('label', m.label) as string,
      startDate: pick('startDate', m.startDate) as string,
      endDate: pick('endDate', m.endDate) as string | null,
      tjm: pick('tjm', m.tjm) as number | null,
      clientValidation: pick('clientValidation', m.clientValidation) as boolean,
      validatorName: pick('validatorName', m.validatorName) as string | null,
      validatorEmail: pick('validatorEmail', m.validatorEmail) as string | null,
      weekendPolicy: pick('weekendPolicy', m.weekendPolicy),
      holidayPolicy: pick('holidayPolicy', m.holidayPolicy),
      workedHolidays: pick('workedHolidays', m.workedHolidays),
      holidayRegion: pick('holidayRegion', m.holidayRegion),
      active: b.active ?? m.active,
    };
    checkMission(next);
    const stmts = [
      c.env.DB.prepare(
        `UPDATE missions SET label = ?, start_date = ?, end_date = ?, tjm = ?, client_validation = ?, validator_name = ?, validator_email = ?,
                weekend_policy = ?, holiday_policy = ?, worked_holidays = ?, holiday_region = ?, active = ? WHERE id = ?`,
      ).bind(
        next.label,
        next.startDate,
        next.endDate,
        next.tjm,
        next.clientValidation ? 1 : 0,
        next.validatorName,
        next.validatorEmail,
        next.weekendPolicy ?? null,
        next.holidayPolicy ?? null,
        json(next.workedHolidays),
        next.holidayRegion ?? null,
        next.active ? 1 : 0,
        id,
      ),
    ];
    if (b.color) stmts.push(c.env.DB.prepare('UPDATE activities SET color = ? WHERE mission_id = ?').bind(b.color, id));
    const color = b.color ?? m.activities[0]?.color ?? '#3B82F6';
    for (const label of b.addActivities ?? []) stmts.push(svc.newActivityStmt(c.env.DB, id, label, color));
    await c.env.DB.batch(stmts);
    return c.json(await svc.getMission(c.env.DB, id), 200);
  },
);

adminRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/activities/{id}',
    tags: ['Admin'],
    summary: 'Modification / désactivation d’une activité de mission',
    request: { params: IdParam, body: jsonBody(z.object({ label: z.string().trim().min(1).max(60).optional(), color: ColorSchema.optional(), active: z.boolean().optional() })) },
    responses: { 200: ok('Modifiée'), 404: ok('Introuvable') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const a = await c.env.DB.prepare('SELECT id, label, color, active FROM activities WHERE id = ? AND mission_id IS NOT NULL')
      .bind(id)
      .first<{ id: string; label: string; color: string; active: number }>();
    if (!a) throw fail(404, 'Activité introuvable (les types d’absence ne sont pas modifiables)');
    const next = { label: b.label ?? a.label, color: b.color ?? a.color, active: b.active ?? !!a.active };
    await c.env.DB.prepare('UPDATE activities SET label = ?, color = ?, active = ? WHERE id = ?').bind(next.label, next.color, next.active ? 1 : 0, id).run();
    return c.json({ id, ...next }, 200);
  },
);
