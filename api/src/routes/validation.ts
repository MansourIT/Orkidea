import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { nowIso, sha256 } from '../lib/crypto';
import { escapeHtml, layout, sendMail, button } from '../lib/mail';

/** Routes publiques utilisées par le valideur client via son lien (sans compte). */
export const validation = new Hono<AppEnv>();

interface ValidationCtx {
  id: string;
  status: string;
  expires_at: string;
  timesheet_id: string;
  timesheet_status: string;
  month: string;
  mission_id: string;
  mission_label: string;
  client_name: string;
  consultant_name: string;
  consultant_email: string;
  comment: string | null;
}

async function findByToken(db: D1Database, token: string): Promise<ValidationCtx | null> {
  return db
    .prepare(
      `SELECT v.id, v.status, v.expires_at, v.timesheet_id, v.comment, t.status AS timesheet_status, t.month,
              m.id AS mission_id, m.label AS mission_label, cl.name AS client_name,
              u.name AS consultant_name, u.email AS consultant_email
       FROM validations v JOIN timesheets t ON t.id = v.timesheet_id
       JOIN missions m ON m.id = v.mission_id JOIN clients cl ON cl.id = m.client_id
       JOIN users u ON u.id = t.consultant_id
       WHERE v.token_hash = ?`,
    )
    .bind(await sha256(token))
    .first<ValidationCtx>();
}

validation.get('/:token', async (c) => {
  const v = await findByToken(c.env.DB, c.req.param('token'));
  if (!v || v.status === 'ANNULE') return c.json({ error: 'Lien invalide ou remplacé par une nouvelle soumission' }, 404);
  // Le client ne voit que les jours de SA mission (pas les autres clients ni le détail des absences).
  const { results: entries } = await c.env.DB.prepare(
    `SELECT e.date, a.label AS activity, e.quantity FROM entries e JOIN activities a ON a.id = e.activity_id
     WHERE e.timesheet_id = ? AND a.mission_id = ? ORDER BY e.date, a.label`,
  )
    .bind(v.timesheet_id, v.mission_id)
    .all<{ date: string; activity: string; quantity: number }>();
  return c.json({
    consultant: v.consultant_name,
    month: v.month,
    mission: v.mission_label,
    client: v.client_name,
    status: v.status,
    expired: v.expires_at < nowIso(),
    comment: v.comment,
    totalDays: entries.reduce((s, e) => s + e.quantity, 0),
    entries,
  });
});

validation.post('/:token', async (c) => {
  const db = c.env.DB;
  const v = await findByToken(db, c.req.param('token'));
  if (!v || v.status !== 'EN_ATTENTE' || v.timesheet_status !== 'SOUMIS') {
    return c.json({ error: 'Cette demande n’est plus en attente' }, 409);
  }
  if (v.expires_at < nowIso()) return c.json({ error: 'Lien expiré' }, 410);

  const body = await c.req.json<{ decision?: string; comment?: string }>().catch(() => ({}) as { decision?: string; comment?: string });
  if (body.decision !== 'VALIDE' && body.decision !== 'REJETE') return c.json({ error: 'Décision invalide' }, 400);
  if (body.decision === 'REJETE' && !body.comment?.trim()) return c.json({ error: 'Merci d’indiquer le motif du rejet' }, 400);

  const now = nowIso();
  await db
    .prepare('UPDATE validations SET status = ?, comment = ?, decided_at = ? WHERE id = ?')
    .bind(body.decision, body.comment?.slice(0, 2000) ?? null, now, v.id)
    .run();

  // Recalcul du statut global du CRA.
  const { results } = await db
    .prepare(`SELECT status FROM validations WHERE timesheet_id = ? AND status != 'ANNULE'`)
    .bind(v.timesheet_id)
    .all<{ status: string }>();
  let newStatus: string | null = null;
  if (results.some((r) => r.status === 'REJETE')) newStatus = 'REJETE';
  else if (results.every((r) => r.status === 'VALIDE')) newStatus = 'VALIDE';

  if (newStatus) {
    await db
      .prepare('UPDATE timesheets SET status = ?, validated_at = ?, updated_at = ? WHERE id = ?')
      .bind(newStatus, newStatus === 'VALIDE' ? now : null, now, v.timesheet_id)
      .run();
    if (newStatus === 'REJETE') {
      await db.prepare(`UPDATE validations SET status = 'ANNULE' WHERE timesheet_id = ? AND status = 'EN_ATTENTE'`).bind(v.timesheet_id).run();
    }
  }

  const ok = body.decision === 'VALIDE';
  c.executionCtx.waitUntil(
    sendMail(c.env, {
      to: v.consultant_email,
      toName: v.consultant_name,
      subject: `CRA ${v.month} ${ok ? 'validé' : 'rejeté'} – ${v.mission_label}`,
      html: layout(
        ok ? 'CRA validé par le client' : 'CRA rejeté par le client',
        `<p>Votre CRA de <b>${v.month}</b> pour <b>${escapeHtml(v.mission_label)}</b> a été ${ok ? 'validé' : 'rejeté'}.</p>
         ${body.comment ? `<p>Commentaire : ${escapeHtml(body.comment)}</p>` : ''}${button(c.env.APP_URL, 'Ouvrir mon CRA')}`,
      ),
    }).catch((err) => console.error('Envoi email décision', err)),
  );

  return c.json({ ok: true, status: body.decision });
});

