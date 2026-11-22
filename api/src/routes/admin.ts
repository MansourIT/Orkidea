import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { isValidMonth, workingDays } from '../../../shared/holidays';
import { newId, nowIso } from '../lib/crypto';

/** Back-office Orkidea (rôle admin). */
export const admin = new Hono<AppEnv>();

admin.get('/timesheets', async (c) => {
  const month = c.req.query('month') ?? '';
  if (!isValidMonth(month)) return c.json({ error: 'Mois invalide' }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id AS consultantId, u.name AS consultant, t.id, COALESCE(t.status, 'NON_COMMENCE') AS status,
            t.submitted_at AS submittedAt, t.validated_at AS validatedAt,
            COALESCE((SELECT SUM(e.quantity) FROM entries e JOIN activities a ON a.id = e.activity_id
                      WHERE e.timesheet_id = t.id AND a.kind = 'travail'), 0) AS workedDays,
            COALESCE((SELECT SUM(e.quantity) FROM entries e JOIN activities a ON a.id = e.activity_id
                      WHERE e.timesheet_id = t.id AND a.kind = 'absence'), 0) AS absenceDays
     FROM users u LEFT JOIN timesheets t ON t.consultant_id = u.id AND t.month = ?
     WHERE u.role = 'consultant' AND u.active = 1 ORDER BY u.name`,
  )
    .bind(month)
    .all();
  return c.json({ month, workingDays: workingDays(month), rows: results });
});

admin.post('/timesheets/:id/close', async (c) => {
  const r = await c.env.DB.prepare(`UPDATE timesheets SET status = 'CLOTURE', closed_at = ?, updated_at = ? WHERE id = ? AND status = 'VALIDE'`)
    .bind(nowIso(), nowIso(), c.req.param('id'))
    .run();
  if (!r.meta.changes) return c.json({ error: 'Seul un CRA validé peut être clôturé' }, 409);
  return c.json({ ok: true });
});

/** Rouvre un CRA (correction demandée par le consultant après validation). */
admin.post('/timesheets/:id/reopen', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE validations SET status = 'ANNULE' WHERE timesheet_id = ? AND status = 'EN_ATTENTE'`).bind(id),
    c.env.DB.prepare(`UPDATE timesheets SET status = 'BROUILLON', validated_at = NULL, closed_at = NULL, updated_at = ? WHERE id = ?`).bind(nowIso(), id),
  ]);
  return c.json({ ok: true });
});

admin.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, email, name, role, active FROM users ORDER BY name').all();
  return c.json(results);
});

admin.post('/users', async (c) => {
  const b = await c.req.json<{ email: string; name: string; role?: 'consultant' | 'admin' }>();
  if (!b?.email || !b?.name) return c.json({ error: 'email et name requis' }, 400);
  const id = newId();
  await c.env.DB.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)')
    .bind(id, b.email.trim(), b.name.trim(), b.role === 'admin' ? 'admin' : 'consultant')
    .run();
  return c.json({ id }, 201);
});

admin.get('/clients', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, siret FROM clients ORDER BY name').all();
  return c.json(results);
});

admin.post('/clients', async (c) => {
  const b = await c.req.json<{ name: string; siret?: string }>();
  if (!b?.name) return c.json({ error: 'name requis' }, 400);
  const id = newId();
  await c.env.DB.prepare('INSERT INTO clients (id, name, siret) VALUES (?, ?, ?)').bind(id, b.name.trim(), b.siret ?? null).run();
  return c.json({ id }, 201);
});

admin.get('/missions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, u.name AS consultant, cl.name AS client FROM missions m
     JOIN users u ON u.id = m.consultant_id JOIN clients cl ON cl.id = m.client_id ORDER BY m.created_at DESC`,
  ).all();
  return c.json(results);
});

/**
 * Création d'une mission avec ses activités.
 * clientValidation = true si le contrat impose la validation du CRA par le client.
 */
admin.post('/missions', async (c) => {
  const b = await c.req.json<{
    consultantId: string;
    clientId: string;
    label: string;
    startDate: string;
    endDate?: string;
    tjm?: number;
    clientValidation?: boolean;
    validatorName?: string;
    validatorEmail?: string;
    color?: string;
    activities?: string[];
  }>();
  if (!b?.consultantId || !b?.clientId || !b?.label || !b?.startDate) {
    return c.json({ error: 'consultantId, clientId, label et startDate requis' }, 400);
  }
  if (b.clientValidation && !b.validatorEmail) return c.json({ error: 'validatorEmail requis si validation client' }, 400);
  const id = newId();
  const color = /^#[0-9a-f]{6}$/i.test(b.color ?? '') ? b.color! : '#3B82F6';
  const labels = b.activities?.length ? b.activities : ['Prestation'];
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO missions (id, consultant_id, client_id, label, start_date, end_date, tjm, client_validation, validator_name, validator_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, b.consultantId, b.clientId, b.label, b.startDate, b.endDate ?? null, b.tjm ?? null, b.clientValidation ? 1 : 0, b.validatorName ?? null, b.validatorEmail ?? null),
    ...labels.map((label) =>
      c.env.DB.prepare(`INSERT INTO activities (id, mission_id, label, kind, color) VALUES (?, ?, ?, 'travail', ?)`).bind(newId(), id, label, color),
    ),
  ]);
  return c.json({ id }, 201);
});

