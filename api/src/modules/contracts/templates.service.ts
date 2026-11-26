import type { ContractTemplateDetail, ContractTemplateSummary, TemplateVersionInfo } from '../../../../shared/types';
import { parseTemplate } from '../../../../shared/contrats/modele';
import { nowIso } from '../../core/clock';
import { newId } from '../../core/crypto';
import { fail } from '../../core/errors';

interface SummaryRow {
  id: string;
  name: string;
  description: string | null;
  archived: number;
  created_at: string;
  published_version: number | null;
  published_at: string | null;
  draft_version: number | null;
  draft_updated_at: string | null;
  contracts: number;
}

const SUMMARY_SQL = `
  SELECT t.id, t.name, t.description, t.archived, t.created_at,
         p.version AS published_version, p.published_at,
         d.version AS draft_version, d.updated_at AS draft_updated_at,
         (SELECT COUNT(*) FROM contracts c JOIN contract_template_versions v ON v.id = c.template_version_id WHERE v.template_id = t.id) AS contracts
  FROM contract_templates t
  LEFT JOIN contract_template_versions p ON p.template_id = t.id AND p.status = 'PUBLIEE'
       AND p.version = (SELECT MAX(version) FROM contract_template_versions WHERE template_id = t.id AND status = 'PUBLIEE')
  LEFT JOIN contract_template_versions d ON d.template_id = t.id AND d.status = 'BROUILLON'`;

const toSummary = (r: SummaryRow): ContractTemplateSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  archived: !!r.archived,
  createdAt: r.created_at,
  published: r.published_version === null ? null : { version: r.published_version, publishedAt: r.published_at! },
  draft: r.draft_version === null ? null : { version: r.draft_version, updatedAt: r.draft_updated_at! },
  contractsCount: r.contracts,
});

export async function listTemplates(db: D1Database): Promise<ContractTemplateSummary[]> {
  const { results } = await db.prepare(`${SUMMARY_SQL} ORDER BY t.archived, t.name COLLATE NOCASE`).all<SummaryRow>();
  return results.map(toSummary);
}

export async function getTemplate(db: D1Database, id: string): Promise<ContractTemplateDetail> {
  const row = await db.prepare(`${SUMMARY_SQL} WHERE t.id = ?`).bind(id).first<SummaryRow>();
  if (!row) throw fail(404, 'Modèle introuvable');
  const summary = toSummary(row);
  const { results } = await db
    .prepare(
      `SELECT v.version, v.status, v.updated_at AS updatedAt, u.name AS updatedBy, v.published_at AS publishedAt, p.name AS publishedBy
       FROM contract_template_versions v
       LEFT JOIN users u ON u.id = v.updated_by LEFT JOIN users p ON p.id = v.published_by
       WHERE v.template_id = ? ORDER BY v.version DESC`,
    )
    .bind(id)
    .all<TemplateVersionInfo>();
  const body = async (version: number | undefined) =>
    version === undefined
      ? null
      : ((await db.prepare('SELECT body FROM contract_template_versions WHERE template_id = ? AND version = ?').bind(id, version).first<{ body: string }>())?.body ?? null);
  return { ...summary, versions: results, draftBody: await body(summary.draft?.version), publishedBody: await body(summary.published?.version) };
}

export async function versionBody(db: D1Database, id: string, version: number): Promise<string> {
  const row = await db.prepare('SELECT body FROM contract_template_versions WHERE template_id = ? AND version = ?').bind(id, version).first<{ body: string }>();
  if (!row) throw fail(404, 'Version introuvable');
  return row.body;
}

export async function createTemplate(db: D1Database, userId: string, input: { name: string; description: string | null; body: string }): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db.batch([
    db.prepare('INSERT INTO contract_templates (id, name, description, created_at, created_by) VALUES (?, ?, ?, ?, ?)').bind(id, input.name, input.description, now, userId),
    db
      .prepare(`INSERT INTO contract_template_versions (id, template_id, version, body, status, updated_at, updated_by) VALUES (?, ?, 1, ?, 'BROUILLON', ?, ?)`)
      .bind(newId(), id, input.body, now, userId),
  ]);
  return id;
}

async function requireTemplate(db: D1Database, id: string): Promise<{ archived: number }> {
  const row = await db.prepare('SELECT archived FROM contract_templates WHERE id = ?').bind(id).first<{ archived: number }>();
  if (!row) throw fail(404, 'Modèle introuvable');
  return row;
}

/**
 * Enregistre le brouillon. S'il n'y en a pas (dernière version publiée), un brouillon « version suivante » est créé.
 * `baseVersion` / `baseUpdatedAt` : état du brouillon chargé dans l'éditeur, pour refuser d'écraser
 * une modification faite entre-temps dans un autre onglet.
 */
export async function saveDraft(db: D1Database, userId: string, id: string, body: string, baseUpdatedAt: string | null): Promise<void> {
  const t = await requireTemplate(db, id);
  if (t.archived) throw fail(409, 'Ce modèle est archivé : restaurez-le pour le modifier');
  const draft = await db
    .prepare(`SELECT version, updated_at FROM contract_template_versions WHERE template_id = ? AND status = 'BROUILLON'`)
    .bind(id)
    .first<{ version: number; updated_at: string }>();
  const now = nowIso();
  if (draft) {
    if (baseUpdatedAt !== null && baseUpdatedAt !== draft.updated_at) throw fail(409, 'Le brouillon a été modifié entre-temps (autre onglet ?). Rechargez la page.');
    const res = await db
      .prepare(`UPDATE contract_template_versions SET body = ?, updated_at = ?, updated_by = ? WHERE template_id = ? AND version = ? AND status = 'BROUILLON' AND updated_at = ?`)
      .bind(body, now, userId, id, draft.version, draft.updated_at)
      .run();
    if (!res.meta.changes) throw fail(409, 'Le brouillon a été modifié entre-temps. Rechargez la page.');
    return;
  }
  if (baseUpdatedAt !== null) throw fail(409, 'Le brouillon a été publié ou abandonné entre-temps. Rechargez la page.');
  const max = await db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM contract_template_versions WHERE template_id = ?').bind(id).first<{ v: number }>();
  // L'index unique « un brouillon par modèle » protège contre deux créations simultanées.
  await db
    .prepare(`INSERT INTO contract_template_versions (id, template_id, version, body, status, updated_at, updated_by) VALUES (?, ?, ?, ?, 'BROUILLON', ?, ?)`)
    .bind(newId(), id, (max?.v ?? 0) + 1, body, now, userId)
    .run()
    .catch(() => {
      throw fail(409, 'Un brouillon vient d’être créé dans un autre onglet. Rechargez la page.');
    });
}

/** Publie le brouillon : refusé s'il contient des erreurs ; la version devient non modifiable. */
export async function publishDraft(db: D1Database, userId: string, id: string): Promise<number> {
  const t = await requireTemplate(db, id);
  if (t.archived) throw fail(409, 'Ce modèle est archivé : restaurez-le pour le publier');
  const draft = await db
    .prepare(`SELECT version, body FROM contract_template_versions WHERE template_id = ? AND status = 'BROUILLON'`)
    .bind(id)
    .first<{ version: number; body: string }>();
  if (!draft) throw fail(409, 'Aucun brouillon à publier');
  const errors = parseTemplate(draft.body).issues.filter((i) => i.severity === 'erreur');
  if (errors.length) throw fail(400, 'Le modèle contient des erreurs : corrigez-les avant de publier', { details: errors.map((e) => `Ligne ${e.line} : ${e.message}`) });
  if (!draft.body.trim()) throw fail(400, 'Le modèle est vide');
  const now = nowIso();
  const res = await db
    .prepare(`UPDATE contract_template_versions SET status = 'PUBLIEE', published_at = ?, published_by = ? WHERE template_id = ? AND version = ? AND status = 'BROUILLON'`)
    .bind(now, userId, id, draft.version)
    .run();
  if (!res.meta.changes) throw fail(409, 'Le brouillon a changé entre-temps. Rechargez la page.');
  return draft.version;
}

/** Abandonne le brouillon (seulement s'il existe une version publiée : sinon le modèle serait vide). */
export async function discardDraft(db: D1Database, id: string): Promise<void> {
  await requireTemplate(db, id);
  const published = await db.prepare(`SELECT 1 AS ok FROM contract_template_versions WHERE template_id = ? AND status = 'PUBLIEE'`).bind(id).first();
  if (!published) throw fail(409, 'Ce modèle n’a jamais été publié : son brouillon ne peut pas être abandonné');
  await db.prepare(`DELETE FROM contract_template_versions WHERE template_id = ? AND status = 'BROUILLON'`).bind(id).run();
}

export async function updateTemplate(db: D1Database, id: string, patch: { name?: string; description?: string | null; archived?: boolean }): Promise<void> {
  await requireTemplate(db, id);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) sets.push('name = ?') && values.push(patch.name);
  if (patch.description !== undefined) sets.push('description = ?') && values.push(patch.description);
  if (patch.archived !== undefined) sets.push('archived = ?') && values.push(patch.archived ? 1 : 0);
  if (!sets.length) return;
  await db.prepare(`UPDATE contract_templates SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
}
