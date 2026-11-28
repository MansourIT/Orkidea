import { createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../../env';
import type { ClientConfig } from '../../../../shared/types';
import { addMonths, monthDiff, monthOf } from '../../../../shared/dates';
import { today } from '../../core/clock';
import { fail } from '../../core/errors';
import { sendInBackground } from '../../core/mail';
import { IdSchema, jsonBody, MonthSchema, newRouter, ok, DateSchema, z } from '../../core/router';
import { requireUser } from '../auth/auth.middleware';
import { loadSettings } from '../settings/settings.repository';
import { getTimesheetRow, listActivities, listSummaries } from './timesheets.repository';
import { assertMonthInRange, getTimesheet, saveTimesheet, submitTimesheet, timesheetPdf, type ServiceCtx } from './timesheets.service';

export const timesheetRoutes = newRouter();
timesheetRoutes.use('*', requireUser);

export async function serviceCtx(c: Context<AppEnv>): Promise<ServiceCtx> {
  return { db: c.env.DB, settings: await loadSettings(c.env.DB), today: today(), appUrl: c.env.APP_URL };
}

const MonthParam = z.object({ month: MonthSchema });
const EntrySchema = z.object({
  date: DateSchema,
  activityId: IdSchema,
  quantity: z.union([z.literal(0.5), z.literal(1)]),
});
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM)');
const SaveBody = z.object({
  entries: z.array(EntrySchema).max(124, 'Trop de lignes de saisie'),
  comment: z.string().max(2000).nullable().optional(),
  onCall: z.array(z.object({ date: DateSchema, missionId: IdSchema })).max(155).optional(),
  interventions: z
    .array(z.object({ date: DateSchema, missionId: IdSchema, start: TimeSchema, end: TimeSchema, reason: z.string().max(200).nullable() }))
    .max(310)
    .optional(),
});

timesheetRoutes.openapi(
  createRoute({ method: 'get', path: '/config', tags: ['CRA'], summary: 'Paramétrage effectif et date du jour', responses: { 200: ok('Configuration') } }),
  async (c) => {
    const ctx = await serviceCtx(c);
    return c.json<ClientConfig>({ settings: ctx.settings, today: ctx.today }, 200);
  },
);

timesheetRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/activities',
    tags: ['CRA'],
    summary: 'Activités saisissables (avec month : inclut les activités archivées présentes dans ce CRA)',
    request: { query: z.object({ month: MonthSchema.optional() }) },
    responses: { 200: ok('Activités, dans l’ordre choisi par le consultant') },
  }),
  async (c) => {
    const user = c.get('user');
    const { month } = c.req.valid('query');
    const ctx = await serviceCtx(c);
    const row = month ? await getTimesheetRow(c.env.DB, user.id, month) : null;
    return c.json(await listActivities(c.env.DB, user.id, ctx.settings, { timesheetId: row?.id }), 200);
  },
);

timesheetRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/activities/order',
    tags: ['CRA'],
    summary: 'Ordre des activités (glisser-déposer)',
    request: { body: jsonBody(z.object({ ids: z.array(IdSchema).max(200) })) },
    responses: { 200: ok('Enregistré') },
  }),
  async (c) => {
    const user = c.get('user');
    const { ids } = c.req.valid('json');
    const ctx = await serviceCtx(c);
    const allowed = new Set((await listActivities(c.env.DB, user.id, ctx.settings)).map((a) => a.id));
    const stmts = [c.env.DB.prepare('DELETE FROM activity_order WHERE user_id = ?').bind(user.id)];
    [...new Set(ids)]
      .filter((id) => allowed.has(id))
      .forEach((id, i) =>
        stmts.push(c.env.DB.prepare('INSERT INTO activity_order (user_id, activity_id, position) VALUES (?, ?, ?)').bind(user.id, id, i)),
      );
    await c.env.DB.batch(stmts);
    return c.json({ ok: true }, 200);
  },
);

timesheetRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/timesheets',
    tags: ['CRA'],
    summary: 'Résumé des CRA du consultant (par défaut : 12 derniers mois), sans créer de brouillon',
    request: { query: z.object({ from: MonthSchema.optional(), to: MonthSchema.optional() }) },
    responses: { 200: ok('Du plus récent au plus ancien') },
  }),
  async (c) => {
    const q = c.req.valid('query');
    const ctx = await serviceCtx(c);
    const to = q.to ?? monthOf(ctx.today);
    const from = q.from ?? addMonths(to, -11);
    if (monthDiff(from, to) < 0 || monthDiff(from, to) > 35) throw fail(400, 'Période invalide (36 mois maximum)');
    return c.json(await listSummaries(c.env.DB, c.get('user').id, from, to, ctx.settings.calendar.holidayRegion), 200);
  },
);

timesheetRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/timesheets/{month}',
    tags: ['CRA'],
    summary: 'CRA du mois (crée le brouillon s’il n’existe pas)',
    request: { params: MonthParam },
    responses: { 200: ok('CRA') },
  }),
  async (c) => c.json(await getTimesheet(await serviceCtx(c), c.get('user'), c.req.valid('param').month), 200),
);

timesheetRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/timesheets/{month}',
    tags: ['CRA'],
    summary: 'Enregistrement du brouillon (remplace toutes les lignes)',
    request: { params: MonthParam, body: jsonBody(SaveBody) },
    responses: { 200: ok('CRA enregistré'), 409: ok('CRA non modifiable'), 422: ok('Saisie invalide (details)') },
  }),
  async (c) => c.json(await saveTimesheet(await serviceCtx(c), c.get('user'), c.req.valid('param').month, c.req.valid('json')), 200),
);

timesheetRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/timesheets/{month}/submit',
    tags: ['CRA'],
    summary: 'Soumission (validation client si le contrat l’exige, sinon VALIDE directement)',
    request: { params: MonthParam },
    responses: { 200: ok('CRA soumis'), 409: ok('Non soumettable'), 422: ok('Vide, hors délai ou incomplet') },
  }),
  async (c) => {
    const { timesheet, mails } = await submitTimesheet(await serviceCtx(c), c.get('user'), c.req.valid('param').month);
    for (const mail of mails) sendInBackground(c, mail, 'demande de validation');
    return c.json(timesheet, 200);
  },
);

timesheetRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/timesheets/{month}/pdf',
    tags: ['CRA'],
    summary: 'PDF du CRA',
    request: { params: MonthParam },
    responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: z.string() } } }, 404: ok('CRA introuvable') },
  }),
  async (c) => {
    const user = c.get('user');
    const { month } = c.req.valid('param');
    const ctx = await serviceCtx(c);
    assertMonthInRange(month, ctx.today);
    const row = await getTimesheetRow(c.env.DB, user.id, month);
    if (!row) throw fail(404, 'CRA introuvable');
    return timesheetPdf(ctx, user, row);
  },
);
