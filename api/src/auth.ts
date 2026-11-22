import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from './env';
import type { User } from '../../shared/types';
import { DAY, isoIn, nowIso, randomToken, sha256 } from './lib/crypto';
import { button, layout, sendMail } from './lib/mail';

const COOKIE = 'ork_session';
const SESSION_TTL = 30 * DAY;
const LOGIN_TTL = 15 * 60_000;

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const raw = getCookie(c, COOKIE);
  if (!raw) return c.json({ error: 'Non authentifié' }, 401);
  const user = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(await sha256(raw), nowIso())
    .first<User>();
  if (!user) return c.json({ error: 'Session expirée' }, 401);
  c.set('user', user);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user')?.role !== 'admin') return c.json({ error: 'Accès réservé' }, 403);
  await next();
});

export const auth = new Hono<AppEnv>();

/** Demande de lien magique. Réponse identique que l'email existe ou non (pas d'énumération). */
auth.post('/login', async (c) => {
  const { email } = await c.req.json<{ email?: string }>().catch(() => ({ email: undefined }));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ error: 'Email invalide' }, 400);
  }
  const user = await c.env.DB.prepare('SELECT id, name, email FROM users WHERE email = ? AND active = 1')
    .bind(email.trim())
    .first<{ id: string; name: string; email: string }>();
  if (user) {
    const token = randomToken();
    await c.env.DB.prepare('INSERT INTO login_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(token), user.id, isoIn(LOGIN_TTL))
      .run();
    const link = `${c.env.APP_URL}/api/auth/callback?token=${encodeURIComponent(token)}`;
    await sendMail(c.env, {
      to: user.email,
      toName: user.name,
      subject: 'Votre lien de connexion Orkidea CRA',
      html: layout('Connexion à votre espace CRA', `<p>Bonjour ${user.name},</p><p>Ce lien est valable 15 minutes.</p>${button(link, 'Me connecter')}`),
    });
  }
  return c.json({ ok: true });
});

auth.get('/callback', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/login?erreur=lien');
  const hash = await sha256(token);
  const row = await c.env.DB.prepare(
    'SELECT user_id FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
  )
    .bind(hash, nowIso())
    .first<{ user_id: string }>();
  if (!row) return c.redirect('/login?erreur=lien');

  const session = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?').bind(nowIso(), hash),
    c.env.DB.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(
      await sha256(session),
      row.user_id,
      isoIn(SESSION_TTL),
    ),
  ]);
  setCookie(c, COOKIE, session, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL / 1000,
  });
  return c.redirect('/');
});

auth.post('/logout', async (c) => {
  const raw = getCookie(c, COOKIE);
  if (raw) await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(raw)).run();
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

auth.get('/me', requireUser, (c) => c.json(c.get('user')));

