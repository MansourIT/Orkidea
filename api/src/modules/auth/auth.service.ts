import type { User } from '../../../../shared/types';
import { DAY, isoIn, nowIso } from '../../core/clock';
import { randomToken, sha256 } from '../../core/crypto';

export const SESSION_TTL = 30 * DAY;
export const LOGIN_TTL = 15 * 60_000;
/** Au-delà de ce nombre de liens valides non utilisés, on n'en envoie plus (anti-bombardement). */
export const MAX_PENDING_LOGIN_LINKS = 3;

export interface LoginRequest {
  user: { id: string; name: string; email: string };
  token: string;
}

/** Crée un jeton de connexion si le compte existe, est actif et n'a pas trop de liens en attente. */
export async function createLoginToken(db: D1Database, email: string): Promise<LoginRequest | null> {
  const user = await db
    .prepare('SELECT id, name, email FROM users WHERE email = ? AND active = 1')
    .bind(email)
    .first<{ id: string; name: string; email: string }>();
  if (!user) return null;
  const pending = await db
    .prepare('SELECT count(*) AS n FROM login_tokens WHERE user_id = ? AND used_at IS NULL AND expires_at > ?')
    .bind(user.id, nowIso())
    .first<{ n: number }>();
  if ((pending?.n ?? 0) >= MAX_PENDING_LOGIN_LINKS) return null;
  const token = randomToken();
  await db
    .prepare('INSERT INTO login_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), user.id, isoIn(LOGIN_TTL))
    .run();
  return { user, token };
}

/**
 * Consomme le jeton (usage unique, atomique : deux requêtes simultanées ne peuvent pas l'utiliser)
 * et ouvre une session. Retourne null si le jeton est inconnu, expiré ou déjà utilisé.
 */
export async function consumeLoginToken(db: D1Database, token: string): Promise<{ session: string; user: User } | null> {
  const now = nowIso();
  const row = await db
    .prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id')
    .bind(now, await sha256(token), now)
    .first<{ user_id: string }>();
  if (!row) return null;
  const user = await db
    .prepare('SELECT id, email, name, role FROM users WHERE id = ? AND active = 1')
    .bind(row.user_id)
    .first<User>();
  if (!user) return null;
  const session = randomToken();
  await db
    .prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(session), user.id, isoIn(SESSION_TTL))
    .run();
  return { session, user };
}

export async function deleteSession(db: D1Database, raw: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(raw)).run();
}
