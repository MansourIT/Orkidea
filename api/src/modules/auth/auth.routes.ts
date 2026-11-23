import { createRoute } from '@hono/zod-openapi';
import { deleteCookie, setCookie } from 'hono/cookie';
import { escapeHtml, button, layout, sendInBackground } from '../../core/mail';
import { EmailSchema, jsonBody, newRouter, ok, z } from '../../core/router';
import { requireUser, readSessionCookie, sessionCookieName, isHttps, SECURE_COOKIE, DEV_COOKIE } from './auth.middleware';
import { consumeLoginToken, createLoginToken, deleteSession, SESSION_TTL } from './auth.service';

export const authRoutes = newRouter();

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Authentification'],
  summary: 'Demande de lien de connexion (réponse identique que le compte existe ou non)',
  request: { body: jsonBody(z.object({ email: EmailSchema })) },
  responses: { 200: ok('Demande prise en compte'), 400: ok('Email invalide'), 429: ok('Trop de tentatives') },
});

authRoutes.openapi(loginRoute, async (c) => {
  const { email } = c.req.valid('json');
  if (c.env.LOGIN_LIMITER) {
    const ip = c.req.header('cf-connecting-ip') ?? 'inconnue';
    const { success } = await c.env.LOGIN_LIMITER.limit({ key: `login:${ip}` });
    if (!success) return c.json({ error: 'Trop de tentatives, réessayez dans une minute' }, 429);
  }
  const req = await createLoginToken(c.env.DB, email);
  if (req) {
    // Le lien ouvre une page du front qui confirme en POST : les antivirus de messagerie
    // qui « pré-ouvrent » les liens (GET) ne consomment donc pas le jeton.
    const link = `${c.env.APP_URL}/connexion?token=${encodeURIComponent(req.token)}`;
    sendInBackground(
      c,
      {
        to: req.user.email,
        toName: req.user.name,
        subject: 'Votre lien de connexion Orkidea CRA',
        html: layout(
          'Connexion à votre espace CRA',
          `<p>Bonjour ${escapeHtml(req.user.name)},</p><p>Ce lien est valable 15 minutes et ne peut servir qu’une fois.</p>${button(link, 'Me connecter')}`,
        ),
      },
      'connexion',
    );
  }
  return c.json({ ok: true }, 200);
});

/** Anciens liens / ouverture directe : redirige vers la page de confirmation, sans consommer le jeton. */
authRoutes.get('/callback', (c) => {
  const token = c.req.query('token');
  return c.redirect(token ? `/connexion?token=${encodeURIComponent(token)}` : '/login?erreur=lien');
});

const callbackRoute = createRoute({
  method: 'post',
  path: '/callback',
  tags: ['Authentification'],
  summary: 'Échange du jeton du lien contre une session (cookie HttpOnly)',
  request: { body: jsonBody(z.object({ token: z.string().min(10).max(200) })) },
  responses: { 200: ok('Connecté'), 400: ok('Lien invalide ou expiré') },
});

authRoutes.openapi(callbackRoute, async (c) => {
  const result = await consumeLoginToken(c.env.DB, c.req.valid('json').token);
  if (!result) return c.json({ error: 'Lien invalide ou expiré', code: 'LIEN_INVALIDE' as const }, 400);
  setCookie(c, sessionCookieName(c), result.session, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL / 1000,
  });
  return c.json(result.user, 200);
});

authRoutes.post('/logout', async (c) => {
  const raw = readSessionCookie(c);
  if (raw) await deleteSession(c.env.DB, raw);
  deleteCookie(c, SECURE_COOKIE, { path: '/', secure: true });
  deleteCookie(c, DEV_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', requireUser, (c) => c.json(c.get('user')));
