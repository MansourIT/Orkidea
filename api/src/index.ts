import { swaggerUI } from '@hono/swagger-ui';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv, Bindings } from './env';
import { onError } from './core/errors';
import { newRouter } from './core/router';
import { scheduled } from './cron';
import { adminRoutes } from './modules/admin/admin.routes';
import { templateRoutes } from './modules/contracts/templates.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { timesheetRoutes } from './modules/timesheets/timesheets.routes';
import { validationRoutes } from './modules/validation/validation.routes';

export const app = newRouter();

app.use('/api/*', secureHeaders());

// Protection CSRF : les requêtes d'écriture doivent venir de l'app elle-même (en plus du cookie SameSite=Lax).
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    const site = c.req.header('sec-fetch-site');
    const allowed = [new URL(c.env.APP_URL).origin, new URL(c.req.url).origin];
    if ((origin && !allowed.includes(origin)) || site === 'cross-site') {
      return c.json({ error: 'Origine refusée' }, 403);
    }
  }
  await next();
});

// Documentation OpenAPI (Swagger) : uniquement si API_DOCS=true (dev).
app.use('/api/docs', async (c, next) => (c.env.API_DOCS === 'true' ? next() : c.json({ error: 'Introuvable' }, 404)));
app.use('/api/openapi.json', async (c, next) => (c.env.API_DOCS === 'true' ? next() : c.json({ error: 'Introuvable' }, 404)));

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
app.route('/api/public/validations', validationRoutes);
app.route('/api/admin/contract-templates', templateRoutes);
app.route('/api/admin', adminRoutes);

app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'Orkidea CRA', version: '2.0.0', description: 'API des comptes rendus d’activité. Authentification par cookie de session (lien magique).' },
});
app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

// En dernier : son middleware requireUser s'applique à toutes les autres routes /api/*.
app.route('/api', timesheetRoutes);

app.notFound((c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'Introuvable' }, 404) : c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Not found', 404),
);
app.onError(onError);

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;

export type { AppEnv };
