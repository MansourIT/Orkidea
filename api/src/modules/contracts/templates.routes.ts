import { createRoute } from '@hono/zod-openapi';
import { IdSchema, jsonBody, newRouter, ok, z } from '../../core/router';
import { requireAdmin, requireUser } from '../auth/auth.middleware';
import * as svc from './templates.service';

/** Modèles de contrat (« contrats mères ») et leurs versions. Réservé à l'administration. */
export const templateRoutes = newRouter();
templateRoutes.use('*', requireUser, requireAdmin);

const IdParam = z.object({ id: IdSchema });
const NameSchema = z.string().trim().min(1, 'Nom du modèle obligatoire').max(120);
const DescriptionSchema = z.string().trim().max(300).nullable().optional();
/** 200 Ko : largement au-delà d'un contrat de plusieurs dizaines de pages. */
const BodySchema = z.string().max(200_000, 'Modèle trop long (200 000 caractères au plus)');

templateRoutes.openapi(
  createRoute({ method: 'get', path: '/', tags: ['Contrats'], summary: 'Modèles de contrat', responses: { 200: ok('Liste') } }),
  async (c) => c.json(await svc.listTemplates(c.env.DB), 200),
);

templateRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Contrats'],
    summary: 'Création d’un modèle (brouillon v1)',
    request: { body: jsonBody(z.object({ name: NameSchema, description: DescriptionSchema, body: BodySchema })) },
    responses: { 201: ok('Créé') },
  }),
  async (c) => {
    const b = c.req.valid('json');
    const id = await svc.createTemplate(c.env.DB, c.get('user').id, { name: b.name, description: b.description || null, body: b.body });
    return c.json({ id }, 201);
  },
);

templateRoutes.openapi(
  createRoute({ method: 'get', path: '/{id}', tags: ['Contrats'], summary: 'Modèle, versions et textes', request: { params: IdParam }, responses: { 200: ok('Modèle'), 404: ok('Introuvable') } }),
  async (c) => c.json(await svc.getTemplate(c.env.DB, c.req.valid('param').id), 200),
);

templateRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Contrats'],
    summary: 'Renommage, description, archivage',
    request: { params: IdParam, body: jsonBody(z.object({ name: NameSchema.optional(), description: DescriptionSchema, archived: z.boolean().optional() })) },
    responses: { 200: ok('Modifié'), 404: ok('Introuvable') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    await svc.updateTemplate(c.env.DB, id, { ...b, description: b.description === undefined ? undefined : b.description || null });
    return c.json(await svc.getTemplate(c.env.DB, id), 200);
  },
);

templateRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/{id}/draft',
    tags: ['Contrats'],
    summary: 'Enregistrement du brouillon (créé à partir de la dernière version si besoin)',
    request: { params: IdParam, body: jsonBody(z.object({ body: BodySchema, baseUpdatedAt: z.string().nullable() })) },
    responses: { 200: ok('Enregistré'), 409: ok('Modifié entre-temps') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    await svc.saveDraft(c.env.DB, c.get('user').id, id, b.body, b.baseUpdatedAt);
    return c.json(await svc.getTemplate(c.env.DB, id), 200);
  },
);

templateRoutes.openapi(
  createRoute({ method: 'delete', path: '/{id}/draft', tags: ['Contrats'], summary: 'Abandon du brouillon', request: { params: IdParam }, responses: { 200: ok('Abandonné') } }),
  async (c) => {
    const { id } = c.req.valid('param');
    await svc.discardDraft(c.env.DB, id);
    return c.json(await svc.getTemplate(c.env.DB, id), 200);
  },
);

templateRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/publish',
    tags: ['Contrats'],
    summary: 'Publication du brouillon (refusée s’il contient des erreurs)',
    request: { params: IdParam },
    responses: { 200: ok('Publié'), 400: ok('Erreurs dans le modèle'), 409: ok('Pas de brouillon') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await svc.publishDraft(c.env.DB, c.get('user').id, id);
    return c.json(await svc.getTemplate(c.env.DB, id), 200);
  },
);

templateRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/versions/{version}',
    tags: ['Contrats'],
    summary: 'Texte d’une version',
    request: { params: z.object({ id: IdSchema, version: z.coerce.number().int().min(1) }) },
    responses: { 200: ok('Texte') },
  }),
  async (c) => {
    const { id, version } = c.req.valid('param');
    return c.json({ version, body: await svc.versionBody(c.env.DB, id, version) }, 200);
  },
);
