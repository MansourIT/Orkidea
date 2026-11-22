import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { EDITABLE_STATUSES, type SaveTimesheetBody } from '../../../shared/types';
import { isValidMonth } from '../../../shared/holidays';
import { DAY, isoIn, newId, nowIso, randomToken, sha256 } from '../lib/crypto';
import { button, escapeHtml, layout, sendMail } from '../lib/mail';
import { checkEntries, getOrCreateTimesheet, getTimesheetRow, listActivities, loadEntries, toTimesheet } from '../lib/timesheets';
import { renderTimesheetPdf } from '../pdf';

export const timesheets = new Hono<AppEnv>();

const VALIDATION_TTL = 30 * DAY;

timesheets.get('/activities', async (c) => {
  const acts = await listActivities(c.env.DB, c.get('user').id);
  return c.json(acts.map(({ missionStart, missionEnd, ...a }) => a));
});

/** Ordre des activités choisi par glisser-déposer. */
timesheets.put('/activities/order', async (c) => {
  const user = c.get('user');
  const { ids } = await c.req.json<{ ids: string[] }>();
  if (!Array.isArray(ids) || ids.length > 200) return c.json({ error: 'Format invalide' }, 400);
  const allowed = new Set((await listActivities(c.env.DB, user.id)).map((a) => a.id));
  const stmts = [c.env.DB.prepare('DELETE FROM activity_order WHERE user_id = ?').bind(user.id)];
  ids.filter((id) => allowed.has(id)).forEach((id, i) =>
    stmts.push(c.env.DB.prepare('INSERT INTO activity_order (user_id, activity_id, position) VALUES (?, ?, ?)').bind(user.id, id, i)),
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

timesheets.get('/timesheets/:month', async (c) => {
  const month = c.req.param('month');
  if (!isValidMonth(month)) return c.json({ error: 'Mois invalide' }, 400);
  const row = await getOrCreateTimesheet(c.env.DB, c.get('user').id, month);
  return c.json(await toTimesheet(c.env.DB, row));
});

/** Enregistrement du brouillon : remplace toutes les lignes du mois. */
timesheets.put('/timesheets/:month', async (c) => {
  const month = c.req.param('month');
  if (!isValidMonth(month)) return c.json({ error: 'Mois invalide' }, 400);
  const user = c.get('user');
  const body = await c.req.json<SaveTimesheetBody>().catch(() => null);
  if (!body) return c.json({ error: 'Corps invalide' }, 400);

  const row = await getOrCreateTimesheet(c.env.DB, user.id, month);
  if (!EDITABLE_STATUSES.includes(row.status)) {
    return c.json({ error: 'Ce CRA n’est plus modifiable' }, 409);
  }
  const errors = checkEntries(month, body.entries, await listActivities(c.env.DB, user.id));
  if (errors.length) return c.json({ error: 'Saisie invalide', details: errors }, 422);

  const comment = typeof body.comment === 'string' ? body.comment.slice(0, 2000) : row.comment;
  const stmts = [
    c.env.DB.prepare('DELETE FROM entries WHERE timesheet_id = ?').bind(row.id),
    ...body.entries.map((e) =>
      c.env.DB.prepare('INSERT INTO entries (timesheet_id, date, activity_id, quantity) VALUES (?, ?, ?, ?)').bind(
        row.id,
        e.date,
        e.activityId,
        e.quantity,
      ),
    ),
    c.env.DB.prepare('UPDATE timesheets SET comment = ?, updated_at = ? WHERE id = ?').bind(comment, nowIso(), row.id),
  ];
  await c.env.DB.batch(stmts);
  return c.json(await toTimesheet(c.env.DB, { ...row, comment }));
});

/**
 * Soumission. Pour chaque mission présente dans le CRA dont le contrat impose une validation client,
 * une demande est envoyée au valideur. Sans validation requise, le CRA passe directement à VALIDE.
 */
timesheets.post('/timesheets/:month/submit', async (c) => {
  const month = c.req.param('month');
  if (!isValidMonth(month)) return c.json({ error: 'Mois invalide' }, 400);
  const user = c.get('user');
  const db = c.env.DB;

  const row = await getTimesheetRow(db, user.id, month);
  if (!row || !EDITABLE_STATUSES.includes(row.status)) return c.json({ error: 'Ce CRA ne peut pas être soumis' }, 409);
  const entries = await loadEntries(db, row.id);
  if (!entries.length) return c.json({ error: 'Le CRA est vide' }, 422);

  const { results: missions } = await db
    .prepare(
      `SELECT DISTINCT m.id, m.label, m.validator_name, m.validator_email, cl.name AS client_name
       FROM entries e JOIN activities a ON a.id = e.activity_id
       JOIN missions m ON m.id = a.mission_id JOIN clients cl ON cl.id = m.client_id
       WHERE e.timesheet_id = ? AND m.client_validation = 1`,
    )
    .bind(row.id)
    .all<{ id: string; label: string; validator_name: string | null; validator_email: string; client_name: string }>();

  const now = nowIso();
  // Une nouvelle soumission remplace toutes les demandes précédentes (les anciens liens deviennent invalides).
  const stmts = [db.prepare(`UPDATE validations SET status = 'ANNULE' WHERE timesheet_id = ? AND status != 'ANNULE'`).bind(row.id)];
  const mails: Array<{ to: string; name: string | null; mission: string; client: string; token: string }> = [];

  for (const m of missions) {
    const token = randomToken();
    stmts.push(
      db
        .prepare('INSERT INTO validations (id, timesheet_id, mission_id, token_hash, validator_email, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(newId(), row.id, m.id, await sha256(token), m.validator_email, isoIn(VALIDATION_TTL)),
    );
    mails.push({ to: m.validator_email, name: m.validator_name, mission: m.label, client: m.client_name, token });
  }

  const newStatus = missions.length ? 'SOUMIS' : 'VALIDE';
  stmts.push(
    db
      .prepare('UPDATE timesheets SET status = ?, submitted_at = ?, validated_at = ?, updated_at = ? WHERE id = ?')
      .bind(newStatus, now, newStatus === 'VALIDE' ? now : null, now, row.id),
  );
  await db.batch(stmts);

  for (const m of mails) {
    const link = `${c.env.APP_URL}/validation/${encodeURIComponent(m.token)}`;
    c.executionCtx.waitUntil(
      sendMail(c.env, {
        to: m.to,
        toName: m.name ?? undefined,
        subject: `CRA ${month} de ${user.name} à valider – ${m.mission}`,
        html: layout(
          'Compte rendu d’activité à valider',
          `<p>Bonjour${m.name ? ' ' + escapeHtml(m.name) : ''},</p>
           <p>${escapeHtml(user.name)} a soumis son CRA de <b>${month}</b> pour la mission <b>${escapeHtml(m.mission)}</b> (${escapeHtml(m.client)}).</p>
           ${button(link, 'Consulter et valider')}<p style="font-size:12px;color:#888">Lien valable 30 jours, sans création de compte.</p>`,
        ),
      }).catch((err) => console.error('Envoi email validation', err)),
    );
  }

  const updated = await getTimesheetRow(db, user.id, month);
  return c.json(await toTimesheet(db, updated!));
});

timesheets.get('/timesheets/:month/pdf', async (c) => {
  const month = c.req.param('month');
  if (!isValidMonth(month)) return c.json({ error: 'Mois invalide' }, 400);
  const user = c.get('user');
  const row = await getTimesheetRow(c.env.DB, user.id, month);
  if (!row) return c.json({ error: 'CRA introuvable' }, 404);
  const ts = await toTimesheet(c.env.DB, row);
  const acts = await listActivities(c.env.DB, user.id);
  const pdf = await renderTimesheetPdf({ consultant: user.name, timesheet: ts, activities: acts });
  return new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="CRA-${month}-${user.name.replace(/[^\w-]+/g, '_')}.pdf"`,
    },
  });
});

