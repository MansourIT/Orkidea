import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { auth, requireAdmin, requireUser } from './auth';
import { timesheets } from './routes/timesheets';
import { validation } from './routes/validation';
import { admin } from './routes/admin';

const app = new Hono<AppEnv>();

app.use('/api/*', secureHeaders());

// Protection CSRF simple : les requêtes d'écriture doivent venir de l'app elle-même.
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.env.APP_URL).origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: 'Origine refusée' }, 403);
    }
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', auth);
app.route('/api/public/validations', validation);

app.use('/api/admin/*', requireUser, requireAdmin);
app.route('/api/admin', admin);

app.use('/api/*', requireUser);
app.route('/api', timesheets);

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Introuvable' }, 404) : c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Not found', 404)));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Erreur serveur' }, 500);
});

export default app;

