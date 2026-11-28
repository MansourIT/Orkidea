import { createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../../env';
import { today } from '../../core/clock';
import { DateSchema, IdSchema, jsonBody, MonthSchema, newRouter, ok, z } from '../../core/router';
import { requireAdmin, requireUser } from '../auth/auth.middleware';
import { loadInvoiceSettings, loadSettings, saveInvoiceSettings } from '../settings/settings.repository';
import { InvoiceSettingsSchema } from '../settings/settings.schemas';
import * as svc from './invoices.service';

/** Facturation depuis les CRA validés. Réservé à l'administration. */
export const invoiceRoutes = newRouter();
invoiceRoutes.use('*', requireUser, requireAdmin);

async function ctx(c: Context<AppEnv>): Promise<svc.InvoiceCtx> {
  return { db: c.env.DB, today: today(), region: (await loadSettings(c.env.DB)).calendar.holidayRegion };
}

const IdParam = z.object({ id: IdSchema });
const LineSchema = z.object({
  description: z.string().trim().min(1, 'Désignation obligatoire').max(200),
  quantity: z.number().min(-10_000).max(10_000),
  unit: z.enum(['jour', 'heure', 'forfait']),
  unitPrice: z.number().int().min(0).max(100_000_000),
});
const pdfResponse = { 200: { description: 'PDF', content: { 'application/pdf': { schema: z.string() } } } };

invoiceRoutes.openapi(
  createRoute({ method: 'get', path: '/settings', tags: ['Factures'], summary: 'Paramètres de facturation', responses: { 200: ok('Paramètres') } }),
  async (c) => c.json(await loadInvoiceSettings(c.env.DB), 200),
);

invoiceRoutes.openapi(
  createRoute({ method: 'put', path: '/settings', tags: ['Factures'], summary: 'Modification des paramètres de facturation', request: { body: jsonBody(InvoiceSettingsSchema) }, responses: { 200: ok('Enregistrés') } }),
  async (c) => {
    const s = c.req.valid('json');
    await saveInvoiceSettings(c.env.DB, s, c.get('user').id);
    return c.json(s, 200);
  },
);

invoiceRoutes.openapi(
  createRoute({ method: 'get', path: '/billable', tags: ['Factures'], summary: 'Missions à facturer pour un mois (CRA validé)', request: { query: z.object({ month: MonthSchema }) }, responses: { 200: ok('Liste') } }),
  async (c) => c.json(await svc.billable(await ctx(c), c.req.valid('query').month), 200),
);

invoiceRoutes.openapi(
  createRoute({ method: 'get', path: '/journal', tags: ['Factures'], summary: 'Journal des ventes (CSV)', request: { query: z.object({ year: z.string().regex(/^\d{4}$/) }) }, responses: { 200: { description: 'CSV', content: { 'text/csv': { schema: z.string() } } } } }),
  async (c) => {
    const { year } = c.req.valid('query');
    return new Response(await svc.salesJournalCsv(await ctx(c), year), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="journal-ventes-${year}.csv"` },
    });
  },
);

invoiceRoutes.openapi(
  createRoute({ method: 'get', path: '/', tags: ['Factures'], summary: 'Factures et avoirs', request: { query: z.object({ month: MonthSchema.optional() }) }, responses: { 200: ok('Liste') } }),
  async (c) => c.json(await svc.listInvoices(await ctx(c), c.req.valid('query')), 200),
);

invoiceRoutes.openapi(
  createRoute({ method: 'post', path: '/', tags: ['Factures'], summary: 'Brouillon de facture depuis le CRA validé', request: { body: jsonBody(z.object({ missionId: IdSchema, month: MonthSchema })) }, responses: { 201: ok('Créée'), 400: ok('Données manquantes'), 409: ok('Déjà facturé ou CRA non validé') } }),
  async (c) => {
    const b = c.req.valid('json');
    return c.json({ id: await svc.createInvoice(await ctx(c), c.get('user').id, b.missionId, b.month) }, 201);
  },
);

invoiceRoutes.openapi(
  createRoute({ method: 'get', path: '/{id}', tags: ['Factures'], summary: 'Facture', request: { params: IdParam }, responses: { 200: ok('Facture'), 404: ok('Introuvable') } }),
  async (c) => c.json(await svc.getInvoice(await ctx(c), c.req.valid('param').id), 200),
);

invoiceRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Factures'],
    summary: 'Modification d’un brouillon',
    request: {
      params: IdParam,
      body: jsonBody(
        z.object({
          lines: z.array(LineSchema).min(1, 'Au moins une ligne').max(50).optional(),
          notes: z.string().trim().max(1000).nullable().optional(),
          purchaseOrder: z.string().trim().max(80).nullable().optional(),
          baseUpdatedAt: z.string(),
        }),
      ),
    },
    responses: { 200: ok('Modifiée'), 409: ok('Émise ou modifiée entre-temps') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const x = await ctx(c);
    await svc.updateDraft(x, c.get('user').id, id, { ...b, notes: b.notes === undefined ? undefined : b.notes || null, purchaseOrder: b.purchaseOrder === undefined ? undefined : b.purchaseOrder || null });
    return c.json(await svc.getInvoice(x, id), 200);
  },
);

invoiceRoutes.openapi(
  createRoute({ method: 'delete', path: '/{id}', tags: ['Factures'], summary: 'Suppression d’un brouillon', request: { params: IdParam }, responses: { 200: ok('Supprimé'), 409: ok('Facture émise') } }),
  async (c) => {
    await svc.deleteDraft(await ctx(c), c.req.valid('param').id);
    return c.json({ ok: true }, 200);
  },
);

invoiceRoutes.openapi(
  createRoute({ method: 'post', path: '/{id}/issue', tags: ['Factures'], summary: 'Émission (numéro, PDF figé)', request: { params: IdParam, body: jsonBody(z.object({ baseUpdatedAt: z.string() })) }, responses: { 200: ok('Émise'), 400: ok('Mentions manquantes'), 409: ok('Déjà émise ou modifiée') } }),
  async (c) => c.json(await svc.issueInvoice(await ctx(c), c.env.CONTRACTS, c.get('user').id, c.req.valid('param').id, c.req.valid('json').baseUpdatedAt), 200),
);

invoiceRoutes.openapi(
  createRoute({ method: 'post', path: '/{id}/sent', tags: ['Factures'], summary: 'Facture transmise au client', request: { params: IdParam }, responses: { 200: ok('Envoyée') } }),
  async (c) => {
    const { id } = c.req.valid('param');
    const x = await ctx(c);
    await svc.markSent(x, c.get('user').id, id);
    return c.json(await svc.getInvoice(x, id), 200);
  },
);

invoiceRoutes.openapi(
  createRoute({ method: 'post', path: '/{id}/paid', tags: ['Factures'], summary: 'Paiement reçu', request: { params: IdParam, body: jsonBody(z.object({ paidOn: DateSchema })) }, responses: { 200: ok('Payée') } }),
  async (c) => {
    const { id } = c.req.valid('param');
    const x = await ctx(c);
    await svc.markPaid(x, c.get('user').id, id, c.req.valid('json').paidOn);
    return c.json(await svc.getInvoice(x, id), 200);
  },
);

invoiceRoutes.openapi(
  createRoute({ method: 'post', path: '/{id}/credit-note', tags: ['Factures'], summary: 'Avoir d’annulation (brouillon)', request: { params: IdParam }, responses: { 201: ok('Avoir créé'), 409: ok('Impossible') } }),
  async (c) => c.json({ id: await svc.createCreditNote(await ctx(c), c.get('user').id, c.req.valid('param').id) }, 201),
);

invoiceRoutes.openapi(
  createRoute({ method: 'get', path: '/{id}/pdf', tags: ['Factures'], summary: 'PDF de la facture émise', request: { params: IdParam }, responses: { ...pdfResponse, 409: ok('Pas encore émise') } }),
  async (c) => {
    const { body, filename } = await svc.invoicePdf(await ctx(c), c.env.CONTRACTS, c.req.valid('param').id);
    return new Response(body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store' } });
  },
);
