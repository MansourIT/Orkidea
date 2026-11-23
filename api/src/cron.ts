import type { Bindings } from './env';
import { nowIso } from './core/clock';

/** Tâche quotidienne : purge des sessions et liens de connexion expirés. */
export async function purgeExpired(env: Bindings): Promise<{ sessions: number; loginTokens: number }> {
  const now = nowIso();
  const [s, t] = await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now),
  ]);
  return { sessions: s.meta.changes, loginTokens: t.meta.changes };
}

export async function scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(
    purgeExpired(env).then((r) => console.log(`Purge : ${r.sessions} session(s), ${r.loginTokens} lien(s) de connexion supprimés`)),
  );
}
