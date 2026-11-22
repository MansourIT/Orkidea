import { createRoute } from '@hono/zod-openapi';
import { sendInBackground } from '../../core/mail';
import { jsonBody, newRouter, ok, z } from '../../core/router';
import { decide, getValidationView } from './validation.service';

/** Routes publiques utilisées par le valideur client via son lien (sans compte). */
export const validationRoutes = newRouter();

const TokenParam = z.object({ token: z.string().min(10).max(200) });

validationRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/{token}',
    tags: ['Validation client'],
    summary: 'Jours de la mission à valider',
    request: { params: TokenParam },
    responses: { 200: ok('Vue du valideur'), 404: ok('Lien invalide (LIEN_INVALIDE) ou remplacé (LIEN_REMPLACE)') },
  }),
  async (c) => c.json(await getValidationView(c.env.DB, c.req.valid('param').token), 200),
);

validationRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/{token}',
    tags: ['Validation client'],
    summary: 'Validation ou rejet (motif obligatoire)',
    request: {
      params: TokenParam,
      body: jsonBody(z.object({ decision: z.enum(['VALIDE', 'REJETE']), comment: z.string().max(2000).nullable().optional() })),
    },
    responses: { 200: ok('Décision enregistrée'), 400: ok('Motif manquant'), 409: ok('Déjà traitée ou remplacée'), 410: ok('Lien expiré') },
  }),
  async (c) => {
    const { decision, comment } = c.req.valid('json');
    const { mail } = await decide(c.env.DB, c.env.APP_URL, c.req.valid('param').token, decision, comment ?? null);
    sendInBackground(c, mail, 'décision client');
    return c.json({ ok: true, status: decision }, 200);
  },
);
