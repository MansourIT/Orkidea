import type { PublicValidationView } from '../../../../shared/types';
import { monthName } from '../../../../shared/dates';
import { auditStmt } from '../../core/audit';
import { nowIso } from '../../core/clock';
import { sha256 } from '../../core/crypto';
import { fail } from '../../core/errors';
import { button, escapeHtml, layout, type Mail } from '../../core/mail';

interface ValidationCtx {
  id: string;
  status: 'EN_ATTENTE' | 'VALIDE' | 'REJETE' | 'ANNULE';
  expires_at: string;
  validator_email: string;
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
      `SELECT v.id, v.status, v.expires_at, v.validator_email, v.timesheet_id, v.comment, t.status AS timesheet_status, t.month,
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

/** Vue du valideur : uniquement les jours de SA mission (ni les autres clients, ni les absences). */
export async function getValidationView(db: D1Database, token: string): Promise<PublicValidationView> {
  const v = await findByToken(db, token);
  if (!v) throw fail(404, 'Lien invalide', { code: 'LIEN_INVALIDE' });
  if (v.status === 'ANNULE') throw fail(404, 'Ce lien a été remplacé par une nouvelle soumission du CRA', { code: 'LIEN_REMPLACE' });
  const { results: entries } = await db
    .prepare(
      `SELECT e.date, a.label AS activity, e.quantity FROM entries e JOIN activities a ON a.id = e.activity_id
       WHERE e.timesheet_id = ? AND a.mission_id = ? ORDER BY e.date, a.label`,
    )
    .bind(v.timesheet_id, v.mission_id)
    .all<{ date: string; activity: string; quantity: number }>();
  return {
    consultant: v.consultant_name,
    month: v.month,
    mission: v.mission_label,
    client: v.client_name,
    status: v.status,
    expired: v.expires_at < nowIso(),
    comment: v.comment,
    totalDays: entries.reduce((s, e) => s + e.quantity, 0),
    entries,
  };
}

/**
 * Décision du valideur. Tout se fait dans un seul batch (transaction D1), avec des mises à jour
 * conditionnelles : deux décisions simultanées ne peuvent pas être prises en compte toutes les deux.
 */
export async function decide(
  db: D1Database,
  appUrl: string,
  token: string,
  decision: 'VALIDE' | 'REJETE',
  comment: string | null,
): Promise<{ mail: Mail }> {
  const v = await findByToken(db, token);
  if (!v) throw fail(404, 'Lien invalide', { code: 'LIEN_INVALIDE' });
  if (v.status === 'ANNULE') throw fail(409, 'Ce lien a été remplacé par une nouvelle soumission du CRA', { code: 'LIEN_REMPLACE' });
  if (v.status !== 'EN_ATTENTE' || v.timesheet_status !== 'SOUMIS') throw fail(409, 'Cette demande n’est plus en attente', { code: 'DEJA_TRAITE' });
  const now = nowIso();
  if (v.expires_at < now) throw fail(410, 'Lien expiré', { code: 'LIEN_EXPIRE' });
  if (decision === 'REJETE' && !comment?.trim()) throw fail(400, 'Merci d’indiquer le motif du rejet');
  const text = comment?.trim() ? comment.trim().slice(0, 2000) : null;
  const ts = v.timesheet_id;

  // Ordre important : chaque événement d'historique est inséré AVANT sa transition, à condition que
  // l'état de départ soit encore là. Dans la transaction, seule la première décision le trouve.
  const results = await db.batch([
    auditStmt(
      db,
      {
        timesheetId: ts,
        action: decision === 'VALIDE' ? 'VALIDATION_CLIENT' : 'REJET_CLIENT',
        actorType: 'client',
        actor: v.validator_email,
        from: 'SOUMIS',
        to: decision === 'REJETE' ? 'REJETE' : null,
        comment: text ? `${v.mission_label} : ${text}` : v.mission_label,
      },
      { sql: `EXISTS (SELECT 1 FROM validations WHERE id = ? AND status = 'EN_ATTENTE' AND expires_at > ?)`, params: [v.id, now] },
    ),
    db
      .prepare(`UPDATE validations SET status = ?, comment = ?, decided_at = ? WHERE id = ? AND status = 'EN_ATTENTE' AND expires_at > ?`)
      .bind(decision, text, now, v.id, now),
    // Toutes les missions validées : événement puis passage du CRA à VALIDE.
    auditStmt(
      db,
      { timesheetId: ts, action: 'VALIDATION', actorType: 'systeme', actor: 'validation-client', from: 'SOUMIS', to: 'VALIDE' },
      {
        sql: `EXISTS (SELECT 1 FROM timesheets WHERE id = ? AND status = 'SOUMIS')
              AND NOT EXISTS (SELECT 1 FROM validations WHERE timesheet_id = ? AND status IN ('EN_ATTENTE', 'REJETE'))`,
        params: [ts, ts],
      },
    ),
    db
      .prepare(
        `UPDATE timesheets SET status = 'VALIDE', validated_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'SOUMIS'
         AND NOT EXISTS (SELECT 1 FROM validations WHERE timesheet_id = ?2 AND status IN ('EN_ATTENTE', 'REJETE'))`,
      )
      .bind(now, ts),
    // Un rejet renvoie tout le CRA en correction.
    db
      .prepare(
        `UPDATE timesheets SET status = 'REJETE', validated_at = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'SOUMIS'
         AND EXISTS (SELECT 1 FROM validations WHERE timesheet_id = ?2 AND status = 'REJETE')`,
      )
      .bind(now, ts),
    // Après un rejet, les autres demandes en attente n'ont plus d'objet.
    db
      .prepare(
        `UPDATE validations SET status = 'ANNULE' WHERE timesheet_id = ?1 AND status = 'EN_ATTENTE'
         AND EXISTS (SELECT 1 FROM timesheets WHERE id = ?1 AND status = 'REJETE')`,
      )
      .bind(ts),
  ]);
  if (!results[1].meta.changes) throw fail(409, 'Cette demande n’est plus en attente', { code: 'DEJA_TRAITE' });

  const ok = decision === 'VALIDE';
  return {
    mail: {
      to: v.consultant_email,
      toName: v.consultant_name,
      subject: `CRA ${monthName(v.month)} ${ok ? 'validé' : 'rejeté'} – ${v.mission_label}`,
      html: layout(
        ok ? 'CRA validé par le client' : 'CRA rejeté par le client',
        `<p>Votre CRA de <b>${monthName(v.month)}</b> pour <b>${escapeHtml(v.mission_label)}</b> a été ${ok ? 'validé' : 'rejeté'}.</p>
         ${text ? `<p>Commentaire : ${escapeHtml(text)}</p>` : ''}${button(`${appUrl}/saisie/${v.month}`, 'Ouvrir mon CRA')}`,
      ),
    },
  };
}
