import { contractNumber } from '../../../../shared/company';
import { parseMarkdown } from '../../../../shared/contrats/markdown';
import { parseTemplate, renderTemplate } from '../../../../shared/contrats/modele';
import { type ContractData, contractData } from '../../../../shared/contrats/variables';
import { todayInParis } from '../../../../shared/dates';
import type { Client, ContractDetail, ContractEvent, ContractEventAction, ContractStatus, ContractSummary } from '../../../../shared/types';
import { nowIso } from '../../core/clock';
import { newId, sha256 } from '../../core/crypto';
import { fail } from '../../core/errors';
import { getMission } from '../admin/admin.service';
import { loadCompany } from '../settings/settings.repository';
import { renderContractPdf } from './contract.pdf';

interface ContractRow {
  id: string;
  number: string | null;
  status: ContractStatus;
  mission_id: string;
  mission_label: string;
  client: string;
  consultant: string;
  template_id: string;
  template_name: string;
  template_version: number;
  template_body: string;
  body: string;
  data_json: string;
  pdf_key: string | null;
  pdf_sha256: string | null;
  cancel_reason: string | null;
  created_at: string;
  issued_at: string | null;
  sent_at: string | null;
  signed_on: string | null;
  signed_pdf_key: string | null;
  signed_pdf_sha256: string | null;
  updated_at: string;
}

const SELECT = `
  SELECT c.*, m.label AS mission_label, cl.name AS client, u.name AS consultant,
         t.id AS template_id, t.name AS template_name, v.version AS template_version, v.body AS template_body
  FROM contracts c
  JOIN missions m ON m.id = c.mission_id JOIN clients cl ON cl.id = m.client_id JOIN users u ON u.id = m.consultant_id
  JOIN contract_template_versions v ON v.id = c.template_version_id JOIN contract_templates t ON t.id = v.template_id`;

const toSummary = (r: ContractRow): ContractSummary => ({
  id: r.id,
  number: r.number,
  status: r.status,
  mission: { id: r.mission_id, label: r.mission_label },
  client: r.client,
  consultant: r.consultant,
  template: { id: r.template_id, name: r.template_name, version: r.template_version },
  createdAt: r.created_at,
  issuedAt: r.issued_at,
  sentAt: r.sent_at,
  signedOn: r.signed_on,
  updatedAt: r.updated_at,
});

function eventStmt(db: D1Database, contractId: string, action: ContractEventAction, actor: string, comment: string | null = null): D1PreparedStatement {
  return db
    .prepare('INSERT INTO contract_events (id, contract_id, action, actor, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(newId(), contractId, action, actor, comment, nowIso());
}

export async function listContracts(db: D1Database, filter: { missionId?: string } = {}): Promise<ContractSummary[]> {
  const { results } = await db
    .prepare(`${SELECT} ${filter.missionId ? 'WHERE c.mission_id = ?' : ''} ORDER BY c.created_at DESC`)
    .bind(...(filter.missionId ? [filter.missionId] : []))
    .all<ContractRow>();
  return results.map(toSummary);
}

async function requireRow(db: D1Database, id: string): Promise<ContractRow> {
  const row = await db.prepare(`${SELECT} WHERE c.id = ?`).bind(id).first<ContractRow>();
  if (!row) throw fail(404, 'Contrat introuvable');
  return row;
}

/** Valeurs actuelles des variables pour une mission (brouillon : numéro attribué plus tard). */
export async function currentData(db: D1Database, missionId: string, number: string | null = null, date = todayInParis()): Promise<ContractData> {
  const mission = await getMission(db, missionId);
  const [client, consultant, company] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, siret, address, postal_code AS postalCode, city, representative_name AS representativeName,
                representative_role AS representativeRole, contract_email AS contractEmail FROM clients WHERE id = ?`,
      )
      .bind(mission.clientId)
      .first<Client>(),
    db.prepare('SELECT name, email, qualification FROM users WHERE id = ?').bind(mission.consultantId).first<{ name: string; email: string; qualification: string | null }>(),
    loadCompany(db),
  ]);
  return contractData({ company, client: client!, consultant: consultant!, mission, number, date });
}

export async function getContract(db: D1Database, id: string): Promise<ContractDetail> {
  const r = await requireRow(db, id);
  // Brouillon : données du moment ; contrat émis : données figées à l'émission.
  const data: ContractData = r.status === 'BROUILLON' ? await currentData(db, r.mission_id) : (JSON.parse(r.data_json) as ContractData);
  const { results: events } = await db
    .prepare(
      `SELECT e.action, COALESCE(u.name, e.actor) AS actor, e.comment, e.created_at AS createdAt
       FROM contract_events e LEFT JOIN users u ON u.id = e.actor WHERE e.contract_id = ? ORDER BY e.created_at DESC, e.rowid DESC`,
    )
    .bind(id)
    .all<ContractEvent>();
  return {
    ...toSummary(r),
    body: r.body,
    templateBody: r.template_body,
    data,
    missing: r.status === 'BROUILLON' ? renderTemplate(parseTemplate(r.body), data).missing : [],
    pdfSha256: r.pdf_sha256,
    signedPdfSha256: r.signed_pdf_sha256,
    cancelReason: r.cancel_reason,
    events,
  };
}

/** Nouveau brouillon : texte de la dernière version publiée du modèle, données lues en direct jusqu'à l'émission. */
export async function createContract(db: D1Database, userId: string, missionId: string, templateId: string): Promise<string> {
  const mission = await getMission(db, missionId);
  if (!mission.active) throw fail(409, 'Cette mission est désactivée');
  const version = await db
    .prepare(
      `SELECT v.id, v.body FROM contract_template_versions v JOIN contract_templates t ON t.id = v.template_id
       WHERE v.template_id = ? AND v.status = 'PUBLIEE' AND t.archived = 0 ORDER BY v.version DESC LIMIT 1`,
    )
    .bind(templateId)
    .first<{ id: string; body: string }>();
  if (!version) throw fail(409, 'Ce modèle n’a pas de version publiée (ou il est archivé)');
  const id = newId();
  const now = nowIso();
  await db.batch([
    db
      .prepare(`INSERT INTO contracts (id, mission_id, template_version_id, status, body, data_json, created_at, created_by, updated_at) VALUES (?, ?, ?, 'BROUILLON', ?, '{}', ?, ?, ?)`)
      .bind(id, missionId, version.id, version.body, now, userId, now),
    eventStmt(db, id, 'CREATION', userId),
  ]);
  return id;
}

/** Ajustement du texte d'un brouillon (contrôle de concurrence sur la date de dernière modification). */
export async function saveBody(db: D1Database, userId: string, id: string, body: string, baseUpdatedAt: string): Promise<void> {
  const r = await requireRow(db, id);
  if (r.status !== 'BROUILLON') throw fail(409, 'Seul un contrat en brouillon peut être modifié');
  const [res] = await db.batch([
    db.prepare(`UPDATE contracts SET body = ?, updated_at = ? WHERE id = ? AND status = 'BROUILLON' AND updated_at = ?`).bind(body, nowIso(), id, baseUpdatedAt),
    db
      .prepare(`INSERT INTO contract_events (id, contract_id, action, actor, created_at) SELECT ?, ?, 'MODIFICATION', ?, ? WHERE changes() > 0`)
      .bind(newId(), id, userId, nowIso()),
  ]);
  if (!res.meta.changes) throw fail(409, 'Le contrat a été modifié entre-temps (autre onglet ?). Rechargez la page.');
}

/** Rend le PDF d'un contrat à partir de son texte et de ses données figées. */
async function buildPdf(body: string, data: ContractData, number: string, issuedOn: string, title: string): Promise<Uint8Array> {
  const blocks = parseMarkdown(renderTemplate(parseTemplate(body), data).text);
  return renderContractPdf({ title, number, issuedOn, blocks });
}

const pdfKey = (id: string, number: string) => `contrats/${id}/${number}.pdf`;

/**
 * Émission : numéro (préfixe-année-rang, remis à zéro chaque année), données figées, PDF déposé dans R2 avec son
 * empreinte. Refusée si le texte contient des erreurs ou s'il manque des données.
 */
export async function issueContract(db: D1Database, bucket: R2Bucket, userId: string, id: string, baseUpdatedAt: string): Promise<ContractDetail> {
  const r = await requireRow(db, id);
  if (r.status !== 'BROUILLON') throw fail(409, 'Ce contrat a déjà été émis ou annulé');
  if (r.updated_at !== baseUpdatedAt) throw fail(409, 'Le contrat a été modifié entre-temps. Rechargez la page.');
  const parsed = parseTemplate(r.body);
  const errors = parsed.issues.filter((i) => i.severity === 'erreur');
  if (errors.length) throw fail(400, 'Le texte du contrat contient des erreurs', { details: errors.map((e) => `Ligne ${e.line} : ${e.message}`) });

  const company = await loadCompany(db);
  const today = todayInParis();
  const year = Number(today.slice(0, 4));
  const prefix = `${company.contractNumberPrefix}-${year}-`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await db
      .prepare(`SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS n FROM contracts WHERE number LIKE ? || '%'`)
      .bind(prefix.length + 1, prefix)
      .first<{ n: number | null }>();
    const number = contractNumber(company.contractNumberPrefix, year, (last?.n ?? 0) + 1);
    const data = await currentData(db, r.mission_id, number, today);
    const missing = renderTemplate(parsed, data).missing;
    if (missing.length) throw fail(400, 'Des données manquent pour émettre ce contrat', { details: missing });

    const pdf = await buildPdf(r.body, data, number, today, r.template_name);
    const hash = await sha256(pdf);
    const key = pdfKey(id, number);
    await bucket.put(key, pdf, { httpMetadata: { contentType: 'application/pdf' }, sha256: hash, customMetadata: { number } });
    try {
      const now = nowIso();
      const [res] = await db.batch([
        db
          .prepare(
            `UPDATE contracts SET status = 'EMIS', number = ?, data_json = ?, pdf_key = ?, pdf_sha256 = ?, issued_at = ?, updated_at = ?
             WHERE id = ? AND status = 'BROUILLON' AND updated_at = ?`,
          )
          .bind(number, JSON.stringify(data), key, hash, now, now, id, baseUpdatedAt),
        db
          .prepare(`INSERT INTO contract_events (id, contract_id, action, actor, comment, created_at) SELECT ?, ?, 'EMISSION', ?, ?, ? WHERE changes() > 0`)
          .bind(newId(), id, userId, number, now),
      ]);
      if (!res.meta.changes) {
        await bucket.delete(key);
        throw fail(409, 'Le contrat a changé entre-temps. Rechargez la page.');
      }
      return getContract(db, id);
    } catch (err) {
      // Numéro pris entre-temps par une autre émission : nouvel essai avec le rang suivant.
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        await bucket.delete(key);
        continue;
      }
      throw err;
    }
  }
  throw fail(503, 'Numérotation momentanément indisponible, réessayez');
}

/** PDF d'un contrat émis : fichier R2 (régénéré à l'identique s'il manque). */
export async function contractPdf(db: D1Database, bucket: R2Bucket, id: string): Promise<{ body: ReadableStream | Uint8Array; filename: string }> {
  const r = await requireRow(db, id);
  if (!r.number || !r.pdf_key) throw fail(409, 'Le PDF est disponible une fois le contrat émis');
  const object = await bucket.get(r.pdf_key);
  if (object) return { body: object.body, filename: `${r.number}.pdf` };
  const pdf = await buildPdf(r.body, JSON.parse(r.data_json) as ContractData, r.number, r.issued_at!.slice(0, 10), r.template_name);
  await bucket.put(r.pdf_key, pdf, { httpMetadata: { contentType: 'application/pdf' } });
  return { body: pdf, filename: `${r.number}.pdf` };
}

/** Aperçu PDF d'un brouillon (non numéroté, non stocké). */
export async function draftPdf(db: D1Database, id: string): Promise<Uint8Array> {
  const r = await requireRow(db, id);
  if (r.status !== 'BROUILLON') throw fail(409, 'Ce contrat n’est plus un brouillon');
  const data = await currentData(db, r.mission_id);
  return buildPdf(r.body, data, 'BROUILLON', todayInParis(), r.template_name);
}

export async function cancelContract(db: D1Database, userId: string, id: string, reason: string): Promise<void> {
  const r = await requireRow(db, id);
  if (r.status === 'SIGNE' || r.status === 'ANNULE') throw fail(409, r.status === 'SIGNE' ? 'Un contrat signé ne peut pas être annulé' : 'Ce contrat est déjà annulé');
  const now = nowIso();
  const [res] = await db.batch([
    db.prepare(`UPDATE contracts SET status = 'ANNULE', cancel_reason = ?, updated_at = ? WHERE id = ? AND status = ?`).bind(reason, now, id, r.status),
    db.prepare(`INSERT INTO contract_events (id, contract_id, action, actor, comment, created_at) SELECT ?, ?, 'ANNULATION', ?, ?, ? WHERE changes() > 0`).bind(newId(), id, userId, reason, now),
  ]);
  if (!res.meta.changes) throw fail(409, 'Le contrat a changé entre-temps. Rechargez la page.');
}

/** Ancien texte d'un brouillon remplacé par la version publiée du modèle (annule les ajustements). */
export async function resetBody(db: D1Database, userId: string, id: string): Promise<void> {
  const r = await requireRow(db, id);
  await saveBody(db, userId, id, r.template_body, r.updated_at);
}

/** Contrat transmis au client (par l'administrateur lui-même) : EMIS → ENVOYE. */
export async function markSent(db: D1Database, userId: string, id: string, comment: string | null): Promise<void> {
  const r = await requireRow(db, id);
  if (r.status !== 'EMIS') throw fail(409, r.status === 'BROUILLON' ? 'Émettez le contrat avant de l’envoyer' : 'Ce contrat a déjà été envoyé, signé ou annulé');
  const now = nowIso();
  const [res] = await db.batch([
    db.prepare(`UPDATE contracts SET status = 'ENVOYE', sent_at = ?, updated_at = ? WHERE id = ? AND status = 'EMIS'`).bind(now, now, id),
    db.prepare(`INSERT INTO contract_events (id, contract_id, action, actor, comment, created_at) SELECT ?, ?, 'ENVOI', ?, ?, ? WHERE changes() > 0`).bind(newId(), id, userId, comment, now),
  ]);
  if (!res.meta.changes) throw fail(409, 'Le contrat a changé entre-temps. Rechargez la page.');
}

/** 10 Mo : un contrat scanné de plusieurs dizaines de pages. */
export const MAX_SIGNED_PDF = 10 * 1024 * 1024;

/**
 * Dépôt du PDF signé (contrat émis ou envoyé → SIGNE). Un nouveau dépôt sur un contrat signé remplace le fichier
 * (erreur de document) ; l'historique en garde la trace.
 */
export async function uploadSigned(db: D1Database, bucket: R2Bucket, userId: string, id: string, pdf: Uint8Array, signedOn: string): Promise<void> {
  const r = await requireRow(db, id);
  if (!['EMIS', 'ENVOYE', 'SIGNE'].includes(r.status) || !r.number) throw fail(409, 'Seul un contrat émis peut recevoir sa version signée');
  if (pdf.length > MAX_SIGNED_PDF) throw fail(413, 'Fichier trop volumineux (10 Mo au plus)');
  if (new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-') throw fail(400, 'Le fichier n’est pas un PDF');
  if (r.issued_at && signedOn < r.issued_at.slice(0, 10)) throw fail(400, 'La date de signature est antérieure à l’émission du contrat');
  if (signedOn > todayInParis()) throw fail(400, 'La date de signature ne peut pas être dans le futur');
  const hash = await sha256(pdf);
  const key = `contrats/${id}/${r.number}-signe.pdf`;
  await bucket.put(key, pdf, { httpMetadata: { contentType: 'application/pdf' }, sha256: hash, customMetadata: { number: r.number, signedOn } });
  const now = nowIso();
  const replacing = r.status === 'SIGNE';
  await db.batch([
    db
      .prepare(`UPDATE contracts SET status = 'SIGNE', signed_pdf_key = ?, signed_pdf_sha256 = ?, signed_on = ?, sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?`)
      .bind(key, hash, signedOn, now, now, id),
    eventStmt(db, id, 'SIGNATURE', userId, replacing ? `PDF signé remplacé (signé le ${signedOn})` : `Signé le ${signedOn}`),
  ]);
}

export async function signedPdf(db: D1Database, bucket: R2Bucket, id: string): Promise<{ body: ReadableStream; filename: string }> {
  const r = await requireRow(db, id);
  if (!r.signed_pdf_key) throw fail(404, 'Aucun PDF signé déposé pour ce contrat');
  const object = await bucket.get(r.signed_pdf_key);
  if (!object) throw fail(404, 'PDF signé introuvable dans le stockage');
  return { body: object.body, filename: `${r.number}-signe.pdf` };
}
