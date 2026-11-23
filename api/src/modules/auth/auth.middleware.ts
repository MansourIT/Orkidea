import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../../env';
import type { User } from '../../../../shared/types';
import { nowIso } from '../../core/clock';
import { sha256 } from '../../core/crypto';

/** En HTTPS, préfixe __Host- : cookie limité à l'hôte exact, Secure et Path=/ obligatoires. */
export const SECURE_COOKIE = '__Host-ork_session';
export const DEV_COOKIE = 'ork_session';

export function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export function sessionCookieName(c: Context): string {
  return isHttps(c) ? SECURE_COOKIE : DEV_COOKIE;
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SECURE_COOKIE) ?? getCookie(c, DEV_COOKIE);
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const raw = readSessionCookie(c);
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
