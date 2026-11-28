import { buildInvoiceLines, creditLines, invoiceNumber, invoiceTotals, type InvoiceKind, type InvoiceLine, type InvoiceSettings, type InvoiceStatus } from '../../../../shared/factures';
import type { Intervention } from '../../../../shared/astreintes';
import { interventionMinutes } from '../../../../shared/astreintes';
import type { HolidayRegion } from '../../../../shared/holidays';
import type { BillableItem, InvoiceDetail, InvoiceEvent, InvoiceSummary, TimesheetStatus } from '../../../../shared/types';
import { nowIso } from '../../core/clock';
import { newId, sha256 } from '../../core/crypto';
import { fail } from '../../core/errors';
import { loadCompany, loadInvoiceSettings } from '../settings/settings.repository';
import { renderInvoicePdf, type InvoicePdfData } from './invoice.pdf';

export interface InvoiceCtx {
  db: D1Database;
  today: string;
  region: HolidayRegion;
}

const BILLED_STATUSES: TimesheetStatus[] = ['VALIDE', 'CLOTURE'];

// ---------------------------------------------------------------- Calcul depuis le CRA

interface MissionBilling {
  id: string;
  label: string;
  consultant_id: string;
  consultant: string;
  client_id: string;
  client: string;
  tjm: number | null;
  purchase_order: string | null;
  payment_terms_days: number | null;
  on_call_daily_rate: number | null;
  on_call_hourly_rate: number | null;
  on_call_night_pct: number | null;
  on_call_weekend_pct: number | null;
}

async function missionBilling(db: D1Database, missionId: string): Promise<MissionBilling> {
  const m = await db
    .prepare(
      `SELECT m.id, m.label, m.consultant_id, u.name AS consultant, m.client_id, cl.name AS client, m.tjm, m.purchase_order, m.payment_terms_days,
              m.on_call_daily_rate, m.on_call_hourly_rate, m.on_call_night_pct, m.on_call_weekend_pct
       FROM missions m JOIN users u ON u.id = m.consultant_id JOIN clients cl ON cl.id = m.client_id WHERE m.id = ?`,
    )
    .bind(missionId)
    .first<MissionBilling>();
  if (!m) throw fail(404, 'Mission introuvable');
  return m;
}

/** Lignes calculées pour une mission et un mois, depuis le CRA validé du consultant. */
async function computeLines(ctx: InvoiceCtx, m: MissionBilling, month: string) {
  const ts = await ctx.db
    .prepare('SELECT id, status FROM timesheets WHERE consultant_id = ? AND month = ?')
    .bind(m.consultant_id, month)
    .first<{ id: string; status: TimesheetStatus }>();
  if (!ts || !BILLED_STATUSES.includes(ts.status)) throw fail(409, 'Le CRA de ce mois n’est pas encore validé');
  const [acts, days, interventions] = await ctx.db.batch([
    ctx.db
      .prepare(
        `SELECT a.label, SUM(e.quantity) AS days FROM entries e JOIN activities a ON a.id = e.activity_id
         WHERE e.timesheet_id = ? AND a.mission_id = ? AND a.kind = 'travail' GROUP BY a.id ORDER BY a.label`,
      )
      .bind(ts.id, m.id),
    ctx.db.prepare('SELECT COUNT(*) AS n FROM on_call_days WHERE timesheet_id = ? AND mission_id = ?').bind(ts.id, m.id),
    ctx.db
      .prepare(`SELECT date, mission_id AS missionId, start_time AS start, end_time AS "end", reason FROM interventions WHERE timesheet_id = ? AND mission_id = ?`)
      .bind(ts.id, m.id),
  ]);
  const activities = acts.results as Array<{ label: string; days: number }>;
  const list = interventions.results as unknown as Intervention[];
  const onCallDays = (days.results[0] as { n: number }).n;
  const built = buildInvoiceLines({
    month,
    tjm: m.tjm,
    activities,
    onCallDays,
    interventions: list,
    rates: { daily: m.on_call_daily_rate, hourly: m.on_call_hourly_rate, nightPct: m.on_call_night_pct, weekendPct: m.on_call_weekend_pct },
    region: ctx.region,
  });
  return {
    ...built,
    timesheetStatus: ts.status,
    days: activities.reduce((n, a) => n + a.days, 0),
    onCallDays,
    interventionMinutes: list.reduce((n, i) => n + interventionMinutes(i.start, i.end), 0),
  };
}

/** Une facture (non annulée par un avoir) existe déjà pour cette mission et ce mois. */
const ALREADY_BILLED = `EXISTS (SELECT 1 FROM invoices i WHERE i.mission_id = m.id AND i.month = ?2 AND i.kind = 'FACTURE'
  AND NOT EXISTS (SELECT 1 FROM invoices a WHERE a.credited_invoice_id = i.id AND a.kind = 'AVOIR' AND a.status != 'BROUILLON'))`;

/** Missions dont le CRA du mois est validé, avec jours ou astreinte, et pas encore facturées. */
export async function billable(ctx: InvoiceCtx, month: string): Promise<BillableItem[]> {
  const { results } = await ctx.db
    .prepare(
      `SELECT DISTINCT m.id FROM missions m JOIN timesheets t ON t.consultant_id = m.consultant_id AND t.month = ?2
       WHERE t.status IN ('VALIDE', 'CLOTURE')
         AND (EXISTS (SELECT 1 FROM entries e JOIN activities a ON a.id = e.activity_id WHERE e.timesheet_id = t.id AND a.mission_id = m.id AND a.kind = 'travail')
              OR EXISTS (SELECT 1 FROM on_call_days d WHERE d.timesheet_id = t.id AND d.mission_id = m.id))
         AND NOT ${ALREADY_BILLED}
       ORDER BY m.label`,
    )
    .bind(null, month)
    .all<{ id: string }>();
  const items: BillableItem[] = [];
  for (const { id } of results) {
    const m = await missionBilling(ctx.db, id);
    const c = await computeLines(ctx, m, month);
    items.push({
      missionId: m.id,
      mission: m.label,
      client: m.client,
      consultant: m.consultant,
      month,
      timesheetStatus: c.timesheetStatus,
      days: c.days,
      onCallDays: c.onCallDays,
      interventionMinutes: c.interventionMinutes,
      lines: c.lines,
      totalHt: invoiceTotals(c.lines, 0).ht,
      problems: c.problems,
    });
  }
  return items;
}

// ---------------------------------------------------------------- Lecture

interface InvoiceRow {
  id: string;
  kind: InvoiceKind;
  number: string | null;
  status: InvoiceStatus;
  client_id: string;
  client: string;
  mission_id: string;
  mission: string;
  consultant: string;
  month: string;
  credited_invoice_id: string | null;
  lines_json: string;
  vat_rate: number;
  total_ht: number;
  total_vat: number;
  total_ttc: number;
  purchase_order: string | null;
  notes: string | null;
  issue_date: string | null;
  due_date: string | null;
  data_json: string;
  pdf_key: string | null;
  pdf_sha256: string | null;
  sent_at: string | null;
  paid_on: string | null;
  updated_at: string;
}

const SELECT = `SELECT i.*, cl.name AS client, m.label AS mission, u.name AS consultant
  FROM invoices i JOIN clients cl ON cl.id = i.client_id JOIN missions m ON m.id = i.mission_id JOIN users u ON u.id = m.consultant_id`;

function toSummary(r: InvoiceRow, today: string): InvoiceSummary {
  return {
    id: r.id,
    kind: r.kind,
    number: r.number,
    status: r.status,
    client: { id: r.client_id, name: r.client },
    mission: { id: r.mission_id, label: r.mission },
    consultant: r.consultant,
    month: r.month,
    totalHt: r.total_ht,
    totalTtc: r.total_ttc,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    paidOn: r.paid_on,
    creditedInvoiceId: r.credited_invoice_id,
    overdue: r.kind === 'FACTURE' && (r.status === 'EMISE' || r.status === 'ENVOYEE') && !!r.due_date && r.due_date < today,
  };
}

export async function listInvoices(ctx: InvoiceCtx, filter: { month?: string } = {}): Promise<InvoiceSummary[]> {
  const { results } = await ctx.db
    .prepare(`${SELECT} ${filter.month ? 'WHERE i.month = ?' : ''} ORDER BY COALESCE(i.issue_date, i.created_at) DESC, i.number DESC`)
    .bind(...(filter.month ? [filter.month] : []))
    .all<InvoiceRow>();
  return results.map((r) => toSummary(r, ctx.today));
}

async function requireRow(db: D1Database, id: string): Promise<InvoiceRow> {
  const r = await db.prepare(`${SELECT} WHERE i.id = ?`).bind(id).first<InvoiceRow>();
  if (!r) throw fail(404, 'Facture introuvable');
  return r;
}

interface Party {
  seller: InvoicePdfData['seller'];
  buyer: InvoicePdfData['buyer'];
  missing: string[];
}

/** Vendeur (Orkidea) et client tels qu'ils figureront sur la facture, avec les mentions obligatoires manquantes. */
async function parties(db: D1Database, clientId: string, settings: InvoiceSettings): Promise<Party> {
  const company = await loadCompany(db);
  const client = await db
    .prepare('SELECT name, siret, address, postal_code AS postalCode, city, vat_number AS vatNumber FROM clients WHERE id = ?')
    .bind(clientId)
    .first<{ name: string; siret: string | null; address: string | null; postalCode: string | null; city: string | null; vatNumber: string | null }>();
  const join = (...parts: Array<string | null>) => parts.filter((p) => p && p.trim()).join(', ');
  const sellerAddress = join(company.address, [company.postalCode, company.city].filter(Boolean).join(' '));
  const buyerAddress = join(client?.address ?? null, [client?.postalCode, client?.city].filter(Boolean).join(' '));
  const missing: string[] = [];
  if (!company.siret) missing.push('SIRET d’Orkidea (Paramètres › Société)');
  if (!sellerAddress) missing.push('Adresse d’Orkidea (Paramètres › Société)');
  if (!company.vatNumber) missing.push('N° de TVA d’Orkidea (Paramètres › Société)');
  if (!settings.iban) missing.push('IBAN (Paramètres › Facturation)');
  if (!client?.siret) missing.push('SIRET du client (fiche client)');
  if (!buyerAddress || !client?.postalCode || !client?.city) missing.push('Adresse complète du client (fiche client)');
  return {
    seller: {
      name: company.legalName,
      legalForm: company.legalForm,
      capital: company.capital,
      address: sellerAddress,
      siret: company.siret,
      rcs: company.rcs,
      vatNumber: company.vatNumber,
      iban: settings.iban,
      bic: settings.bic,
    },
    buyer: { name: client?.name ?? '', address: buyerAddress, siren: (client?.siret ?? '').slice(0, 9), vatNumber: client?.vatNumber ?? '' },
    missing,
  };
}

export async function getInvoice(ctx: InvoiceCtx, id: string): Promise<InvoiceDetail> {
  const r = await requireRow(ctx.db, id);
  const relatedRow = r.credited_invoice_id
    ? await ctx.db.prepare('SELECT id, number, kind FROM invoices WHERE id = ?').bind(r.credited_invoice_id).first<{ id: string; number: string | null; kind: InvoiceKind }>()
    : await ctx.db
        .prepare(`SELECT id, number, kind FROM invoices WHERE credited_invoice_id = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(id)
        .first<{ id: string; number: string | null; kind: InvoiceKind }>();
  const { results: events } = await ctx.db
    .prepare(
      `SELECT e.action, COALESCE(u.name, e.actor) AS actor, e.comment, e.created_at AS createdAt
       FROM invoice_events e LEFT JOIN users u ON u.id = e.actor WHERE e.invoice_id = ? ORDER BY e.created_at DESC, e.rowid DESC`,
    )
    .bind(id)
    .all<InvoiceEvent>();
  const missing = r.status === 'BROUILLON' ? (await parties(ctx.db, r.client_id, await loadInvoiceSettings(ctx.db))).missing : [];
  return {
    ...toSummary(r, ctx.today),
    lines: JSON.parse(r.lines_json) as InvoiceLine[],
    vatRate: r.vat_rate,
    totalVat: r.total_vat,
    purchaseOrder: r.purchase_order,
    notes: r.notes,
    pdfSha256: r.pdf_sha256,
    sentAt: r.sent_at,
    updatedAt: r.updated_at,
    related: relatedRow ?? null,
    missing,
    events,
  };
}

// ---------------------------------------------------------------- Écriture

function eventStmt(db: D1Database, invoiceId: string, action: InvoiceEvent['action'], actor: string, comment: string | null = null): D1PreparedStatement {
  return db
    .prepare('INSERT INTO invoice_events (id, invoice_id, action, actor, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(newId(), invoiceId, action, actor, comment, nowIso());
}

/** Brouillon de facture depuis le CRA validé (une seule facture par mission et par mois, hors factures annulées par avoir). */
export async function createInvoice(ctx: InvoiceCtx, userId: string, missionId: string, month: string): Promise<string> {
  const m = await missionBilling(ctx.db, missionId);
  const billed = await ctx.db.prepare(`SELECT 1 AS ok FROM missions m WHERE m.id = ?1 AND ${ALREADY_BILLED}`).bind(missionId, month).first();
  if (billed) throw fail(409, 'Une facture existe déjà pour cette mission et ce mois (créez un avoir pour la remplacer)');
  const { lines, problems } = await computeLines(ctx, m, month);
  if (problems.length) throw fail(400, 'Informations manquantes pour calculer la facture', { details: problems });
  if (!lines.length) throw fail(400, 'Rien à facturer pour cette mission ce mois-ci');
  const settings = await loadInvoiceSettings(ctx.db);
  const totals = invoiceTotals(lines, settings.vatRate);
  const id = newId();
  const now = nowIso();
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO invoices (id, kind, status, client_id, mission_id, month, lines_json, vat_rate, total_ht, total_vat, total_ttc, purchase_order, created_at, created_by, updated_at)
         VALUES (?, 'FACTURE', 'BROUILLON', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, m.client_id, m.id, month, JSON.stringify(lines), settings.vatRate, totals.ht, totals.vat, totals.ttc, m.purchase_order, now, userId, now),
    eventStmt(ctx.db, id, 'CREATION', userId),
  ]);
  return id;
}

/** Modification d'un brouillon : lignes, notes, bon de commande (contrôle de concurrence). */
export async function updateDraft(
  ctx: InvoiceCtx,
  userId: string,
  id: string,
  patch: { lines?: InvoiceLine[]; notes?: string | null; purchaseOrder?: string | null; baseUpdatedAt: string },
): Promise<void> {
  const r = await requireRow(ctx.db, id);
  if (r.status !== 'BROUILLON') throw fail(409, 'Seul un brouillon peut être modifié');
  const lines = patch.lines ?? (JSON.parse(r.lines_json) as InvoiceLine[]);
  if (r.kind === 'FACTURE' && lines.some((l) => l.quantity < 0)) throw fail(400, 'Quantités négatives : utilisez un avoir');
  const totals = invoiceTotals(lines, r.vat_rate);
  const now = nowIso();
  const [res] = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE invoices SET lines_json = ?, total_ht = ?, total_vat = ?, total_ttc = ?, notes = ?, purchase_order = ?, updated_at = ?
         WHERE id = ? AND status = 'BROUILLON' AND updated_at = ?`,
      )
      .bind(
        JSON.stringify(lines),
        totals.ht,
        totals.vat,
        totals.ttc,
        patch.notes === undefined ? r.notes : patch.notes,
        patch.purchaseOrder === undefined ? r.purchase_order : patch.purchaseOrder,
        now,
        id,
        patch.baseUpdatedAt,
      ),
    ctx.db.prepare(`INSERT INTO invoice_events (id, invoice_id, action, actor, created_at) SELECT ?, ?, 'MODIFICATION', ?, ? WHERE changes() > 0`).bind(newId(), id, userId, now),
  ]);
  if (!res.meta.changes) throw fail(409, 'La facture a été modifiée entre-temps. Rechargez la page.');
}

export async function deleteDraft(ctx: InvoiceCtx, id: string): Promise<void> {
  const r = await requireRow(ctx.db, id);
  if (r.status !== 'BROUILLON') throw fail(409, 'Une facture émise ne peut pas être supprimée : créez un avoir');
  await ctx.db.prepare(`DELETE FROM invoices WHERE id = ? AND status = 'BROUILLON'`).bind(id).run();
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Émission : numéro chronologique continu par année (FA-2026-0001 / AV-2026-0001), date d'émission et échéance, vendeur
 * et client figés, PDF dans R2 avec son empreinte. Refusée s'il manque une mention obligatoire.
 */
export async function issueInvoice(ctx: InvoiceCtx, bucket: R2Bucket, userId: string, id: string, baseUpdatedAt: string): Promise<InvoiceDetail> {
  const r = await requireRow(ctx.db, id);
  if (r.status !== 'BROUILLON') throw fail(409, 'Cette facture a déjà été émise');
  if (r.updated_at !== baseUpdatedAt) throw fail(409, 'La facture a été modifiée entre-temps. Rechargez la page.');
  const lines = JSON.parse(r.lines_json) as InvoiceLine[];
  if (!lines.length) throw fail(400, 'La facture ne comporte aucune ligne');
  const settings = await loadInvoiceSettings(ctx.db);
  const p = await parties(ctx.db, r.client_id, settings);
  if (p.missing.length) throw fail(400, 'Mentions obligatoires manquantes', { details: p.missing });
  const m = await missionBilling(ctx.db, r.mission_id);
  const credited = r.credited_invoice_id ? await ctx.db.prepare('SELECT number FROM invoices WHERE id = ?').bind(r.credited_invoice_id).first<{ number: string }>() : null;
  const year = Number(ctx.today.slice(0, 4));
  const prefix = r.kind === 'AVOIR' ? settings.creditPrefix : settings.prefix;
  const head = `${prefix}-${year}-`;
  const dueDate = r.kind === 'AVOIR' ? ctx.today : addDays(ctx.today, m.payment_terms_days ?? settings.defaultPaymentDays);
  const totals = { ht: r.total_ht, vat: r.total_vat, ttc: r.total_ttc };

  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await ctx.db
      .prepare(`SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS n FROM invoices WHERE number LIKE ? || '%'`)
      .bind(head.length + 1, head)
      .first<{ n: number | null }>();
    const number = invoiceNumber(prefix, year, (last?.n ?? 0) + 1);
    const data: InvoicePdfData = {
      kind: r.kind,
      number,
      issueDate: ctx.today,
      dueDate,
      month: r.month,
      seller: p.seller,
      buyer: p.buyer,
      mission: r.mission,
      consultant: r.consultant,
      purchaseOrder: r.purchase_order,
      creditedNumber: credited?.number ?? null,
      lines,
      vatRate: r.vat_rate,
      totals,
      vatOnDebits: settings.vatOnDebits,
      latePenalty: settings.latePenalty,
      notes: r.notes,
    };
    const pdf = await renderInvoicePdf(data);
    const hash = await sha256(pdf);
    const key = `factures/${id}/${number}.pdf`;
    await bucket.put(key, pdf, { httpMetadata: { contentType: 'application/pdf' }, sha256: hash, customMetadata: { number } });
    try {
      const now = nowIso();
      const [res] = await ctx.db.batch([
        ctx.db
          .prepare(
            `UPDATE invoices SET status = 'EMISE', number = ?, issue_date = ?, due_date = ?, data_json = ?, pdf_key = ?, pdf_sha256 = ?, updated_at = ?
             WHERE id = ? AND status = 'BROUILLON' AND updated_at = ?`,
          )
          .bind(number, ctx.today, dueDate, JSON.stringify(data), key, hash, now, id, baseUpdatedAt),
        ctx.db
          .prepare(`INSERT INTO invoice_events (id, invoice_id, action, actor, comment, created_at) SELECT ?, ?, 'EMISSION', ?, ?, ? WHERE changes() > 0`)
          .bind(newId(), id, userId, number, now),
      ]);
      if (!res.meta.changes) {
        await bucket.delete(key);
        throw fail(409, 'La facture a changé entre-temps. Rechargez la page.');
      }
      return getInvoice(ctx, id);
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        await bucket.delete(key);
        continue;
      }
      throw err;
    }
  }
  throw fail(503, 'Numérotation momentanément indisponible, réessayez');
}

export async function markSent(ctx: InvoiceCtx, userId: string, id: string): Promise<void> {
  const r = await requireRow(ctx.db, id);
  if (r.status !== 'EMISE') throw fail(409, r.status === 'BROUILLON' ? 'Émettez la facture avant de l’envoyer' : 'Cette facture a déjà été envoyée ou payée');
  const now = nowIso();
  await ctx.db.batch([
    ctx.db.prepare(`UPDATE invoices SET status = 'ENVOYEE', sent_at = ?, updated_at = ? WHERE id = ? AND status = 'EMISE'`).bind(now, now, id),
    eventStmt(ctx.db, id, 'ENVOI', userId),
  ]);
}

export async function markPaid(ctx: InvoiceCtx, userId: string, id: string, paidOn: string): Promise<void> {
  const r = await requireRow(ctx.db, id);
  if (r.kind !== 'FACTURE' || (r.status !== 'EMISE' && r.status !== 'ENVOYEE')) throw fail(409, 'Seule une facture émise ou envoyée peut être marquée payée');
  if (r.issue_date && paidOn < r.issue_date) throw fail(400, 'La date de paiement est antérieure à l’émission');
  if (paidOn > ctx.today) throw fail(400, 'La date de paiement ne peut pas être dans le futur');
  const now = nowIso();
  await ctx.db.batch([
    ctx.db.prepare(`UPDATE invoices SET status = 'PAYEE', paid_on = ?, sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?`).bind(paidOn, now, now, id),
    eventStmt(ctx.db, id, 'PAIEMENT', userId, `Payée le ${paidOn.split('-').reverse().join('/')}`),
  ]);
}

/** Avoir d'annulation totale d'une facture émise (brouillon à émettre ; la mission redevient facturable une fois l'avoir émis). */
export async function createCreditNote(ctx: InvoiceCtx, userId: string, id: string): Promise<string> {
  const r = await requireRow(ctx.db, id);
  if (r.kind !== 'FACTURE' || r.status === 'BROUILLON') throw fail(409, 'Un avoir se crée sur une facture émise');
  const existing = await ctx.db.prepare('SELECT id FROM invoices WHERE credited_invoice_id = ?').bind(id).first<{ id: string }>();
  if (existing) throw fail(409, 'Un avoir existe déjà pour cette facture');
  const lines = creditLines(JSON.parse(r.lines_json) as InvoiceLine[]);
  const totals = invoiceTotals(lines, r.vat_rate);
  const creditId = newId();
  const now = nowIso();
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO invoices (id, kind, status, client_id, mission_id, month, credited_invoice_id, lines_json, vat_rate, total_ht, total_vat, total_ttc,
                               purchase_order, created_at, created_by, updated_at)
         VALUES (?, 'AVOIR', 'BROUILLON', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(creditId, r.client_id, r.mission_id, r.month, id, JSON.stringify(lines), r.vat_rate, totals.ht, totals.vat, totals.ttc, r.purchase_order, now, userId, now),
    eventStmt(ctx.db, creditId, 'CREATION', userId, `Avoir de la facture ${r.number}`),
    eventStmt(ctx.db, id, 'AVOIR', userId, 'Avoir créé'),
  ]);
  return creditId;
}

/** PDF d'une facture émise (R2, régénéré à l'identique depuis les données figées s'il manque). */
export async function invoicePdf(ctx: InvoiceCtx, bucket: R2Bucket, id: string): Promise<{ body: ReadableStream | Uint8Array; filename: string }> {
  const r = await requireRow(ctx.db, id);
  if (!r.number || !r.pdf_key) throw fail(409, 'Le PDF est disponible une fois la facture émise');
  const object = await bucket.get(r.pdf_key);
  if (object) return { body: object.body, filename: `${r.number}.pdf` };
  const pdf = await renderInvoicePdf(JSON.parse(r.data_json) as InvoicePdfData);
  await bucket.put(r.pdf_key, pdf, { httpMetadata: { contentType: 'application/pdf' } });
  return { body: pdf, filename: `${r.number}.pdf` };
}

/** Journal des ventes (CSV Excel français) des factures et avoirs émis sur une année. */
export async function salesJournalCsv(ctx: InvoiceCtx, year: string): Promise<string> {
  const { results } = await ctx.db
    .prepare(`${SELECT} WHERE i.number IS NOT NULL AND substr(i.issue_date, 1, 4) = ? ORDER BY i.issue_date, i.number`)
    .bind(year)
    .all<InvoiceRow>();
  const cell = (v: string | number | null) => {
    if (v === null) return '';
    const s = typeof v === 'number' ? (v / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, useGrouping: false }) : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');
  const header = ['Date', 'Numéro', 'Type', 'Client', 'Mission', 'Période', 'HT', 'TVA', 'TTC', 'Échéance', 'Statut', 'Payée le'];
  const lines = results.map((r) =>
    [fr(r.issue_date), r.number, r.kind === 'AVOIR' ? 'Avoir' : 'Facture', r.client, r.mission, r.month, r.total_ht, r.total_vat, r.total_ttc, fr(r.due_date), r.status, fr(r.paid_on)]
      .map((v) => cell(v as string | number | null))
      .join(';'),
  );
  return '﻿' + [header.join(';'), ...lines].join('\r\n') + '\r\n';
}
