import { createRoute } from '@hono/zod-openapi';
import { fail } from '../../core/errors';
import { DateSchema, IdSchema, jsonBody, newRouter, ok, z } from '../../core/router';
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

contractRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/sent',
    tags: ['Contrats'],
    summary: 'Contrat transmis au client (émis → envoyé)',
    request: { params: IdParam, body: { required: false, content: { 'application/json': { schema: z.object({ comment: z.string().max(500).optional() }) } } } },
    responses: { 200: ok('Envoyé'), 409: ok('Pas émis, ou déjà envoyé') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = (await c.req.json().catch(() => ({}))) as { comment?: unknown };
    const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim().slice(0, 500) : null;
    await svc.markSent(c.env.DB, c.get('user').id, id, comment);
    return c.json(await svc.getContract(c.env.DB, id), 200);
  },
);

/** Dépôt du PDF signé : corps brut application/pdf, date de signature en paramètre (?signedOn=YYYY-MM-DD). */
contractRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/{id}/signed',
    tags: ['Contrats'],
    summary: 'Dépôt (ou remplacement) du PDF signé',
    request: { params: IdParam, query: z.object({ signedOn: DateSchema }) },
    responses: { 200: ok('Signé'), 400: ok('Fichier ou date invalide'), 409: ok('Contrat non émis'), 413: ok('Fichier trop volumineux') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(c.req.header('content-type') ?? '').startsWith('application/pdf')) throw fail(415, 'Envoyez un fichier PDF');
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > svc.MAX_SIGNED_PDF) throw fail(413, 'Fichier trop volumineux (10 Mo au plus)');
    const pdf = new Uint8Array(await c.req.arrayBuffer());
    await svc.uploadSigned(c.env.DB, c.env.CONTRACTS, c.get('user').id, id, pdf, c.req.valid('query').signedOn);
    return c.json(await svc.getContract(c.env.DB, id), 200);
  },
);

contractRoutes.openapi(
  createRoute({ method: 'get', path: '/{id}/signed.pdf', tags: ['Contrats'], summary: 'PDF signé déposé', request: { params: IdParam }, responses: { ...pdfResponse, 404: ok('Aucun PDF signé') } }),
  async (c) => {
    const { body, filename } = await svc.signedPdf(c.env.DB, c.env.CONTRACTS, c.req.valid('param').id);
    return new Response(body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store' } });
  },
);
