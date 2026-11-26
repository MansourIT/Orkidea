import { createRoute } from '@hono/zod-openapi';
import { IdSchema, jsonBody, newRouter, ok, z } from '../../core/router';
import { requireAdmin, requireUser } from '../auth/auth.middleware';
import * as svc from './contracts.service';

/** Contrats de prestation générés depuis les missions. Réservé à l'administration. */
export const contractRoutes = newRouter();
contractRoutes.use('*', requireUser, requireAdmin);

const IdParam = z.object({ id: IdSchema });
const BodySchema = z.string().max(200_000, 'Texte trop long (200 000 caractères au plus)');
const pdfResponse = { 200: { description: 'PDF', content: { 'application/pdf': { schema: z.string() } } } };

contractRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Contrats'],
    summary: 'Contrats (tous, ou d’une mission)',
    request: { query: z.object({ missionId: IdSchema.optional() }) },
    responses: { 200: ok('Liste') },
  }),
  async (c) => c.json(await svc.listContracts(c.env.DB, c.req.valid('query')), 200),
);

contractRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Contrats'],
    summary: 'Nouveau contrat en brouillon (dernière version publiée du modèle)',
    request: { body: jsonBody(z.object({ missionId: IdSchema, templateId: IdSchema })) },
    responses: { 201: ok('Créé'), 409: ok('Modèle non publié ou mission désactivée') },
  }),
  async (c) => {
    const b = c.req.valid('json');
    return c.json({ id: await svc.createContract(c.env.DB, c.get('user').id, b.missionId, b.templateId) }, 201);
  },
);

contractRoutes.openapi(
  createRoute({ method: 'get', path: '/{id}', tags: ['Contrats'], summary: 'Contrat, données et historique', request: { params: IdParam }, responses: { 200: ok('Contrat'), 404: ok('Introuvable') } }),
  async (c) => c.json(await svc.getContract(c.env.DB, c.req.valid('param').id), 200),
);

contractRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/{id}/body',
    tags: ['Contrats'],
    summary: 'Ajustement du texte d’un brouillon',
    request: { params: IdParam, body: jsonBody(z.object({ body: BodySchema, baseUpdatedAt: z.string() })) },
    responses: { 200: ok('Enregistré'), 409: ok('Modifié entre-temps ou déjà émis') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    await svc.saveBody(c.env.DB, c.get('user').id, id, b.body, b.baseUpdatedAt);
    return c.json(await svc.getContract(c.env.DB, id), 200);
  },
);

contractRoutes.openapi(
  createRoute({ method: 'post', path: '/{id}/reset', tags: ['Contrats'], summary: 'Retour au texte du modèle', request: { params: IdParam }, responses: { 200: ok('Rétabli') } }),
  async (c) => {
    const { id } = c.req.valid('param');
    await svc.resetBody(c.env.DB, c.get('user').id, id);
    return c.json(await svc.getContract(c.env.DB, id), 200);
  },
);

contractRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/issue',
    tags: ['Contrats'],
    summary: 'Émission : numéro, données figées, PDF',
    request: { params: IdParam, body: jsonBody(z.object({ baseUpdatedAt: z.string() })) },
    responses: { 200: ok('Émis'), 400: ok('Erreurs ou données manquantes'), 409: ok('Déjà émis ou modifié') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await svc.issueContract(c.env.DB, c.env.CONTRACTS, c.get('user').id, id, c.req.valid('json').baseUpdatedAt), 200);
  },
);

contractRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['Contrats'],
    summary: 'Annulation (motif obligatoire)',
    request: { params: IdParam, body: jsonBody(z.object({ reason: z.string().trim().min(1, 'Motif obligatoire').max(500) })) },
    responses: { 200: ok('Annulé'), 409: ok('Signé ou déjà annulé') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await svc.cancelContract(c.env.DB, c.get('user').id, id, c.req.valid('json').reason);
    return c.json(await svc.getContract(c.env.DB, id), 200);
  },
);

contractRoutes.openapi(
  createRoute({ method: 'get', path: '/{id}/pdf', tags: ['Contrats'], summary: 'PDF du contrat émis', request: { params: IdParam }, responses: { ...pdfResponse, 409: ok('Pas encore émis') } }),
  async (c) => {
    const { body, filename } = await svc.contractPdf(c.env.DB, c.env.CONTRACTS, c.req.valid('param').id);
    return new Response(body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store' } });
  },
);

contractRoutes.openapi(
  createRoute({ method: 'get', path: '/{id}/draft.pdf', tags: ['Contrats'], summary: 'Aperçu PDF d’un brouillon (non numéroté)', request: { params: IdParam }, responses: pdfResponse }),
  async (c) => {
    const pdf = await svc.draftPdf(c.env.DB, c.req.valid('param').id);
    return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="brouillon.pdf"', 'cache-control': 'private, no-store' } });
  },
);
