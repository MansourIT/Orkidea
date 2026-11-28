import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPANY } from '../../shared/company';
import { DEFAULT_INVOICE_SETTINGS } from '../../shared/factures';
import type { ApiError, BillableItem, InvoiceDetail, InvoiceSummary, Timesheet } from '../../shared/types';
import { ADMIN, CONSULTANT, MONTH, call, json, login } from './helpers';

const BASE = '/api/admin/invoices';

/** CRA de novembre validé : 3 jours sur Beta (sans validation client) + 1 astreinte avec intervention de nuit. */
async function validatedBetaTimesheet(admin: string): Promise<void> {
  await call('/api/admin/missions/m-beta', {
    method: 'PATCH',
    cookie: admin,
    body: { onCall: true, onCallDailyRate: 80, onCallHourlyRate: 60, onCallNightPct: 50, onCallWeekendPct: 100, purchaseOrder: 'PO-2026-42', paymentTermsDays: 45 },
  });
  const cookie = await login(CONSULTANT);
  const save = await call(`/api/timesheets/${MONTH}`, {
    method: 'PUT',
    cookie,
    body: {
      entries: ['2026-11-02', '2026-11-03', '2026-11-04'].map((date) => ({ date, activityId: 'a-beta-dev', quantity: 1 })),
      onCall: [{ date: '2026-11-07', missionId: 'm-beta' }],
      interventions: [{ date: '2026-11-07', missionId: 'm-beta', start: '23:00', end: '01:00', reason: null }],
    },
  });
  expect(save.status).toBe(200);
  const submitted = await json<Timesheet>(await call(`/api/timesheets/${MONTH}/submit`, { method: 'POST', cookie }));
  expect(submitted.status).toBe('VALIDE');
}

async function completeSellerAndClient(admin: string): Promise<void> {
  await call('/api/admin/company', {
    method: 'PUT',
    cookie: admin,
    body: { ...DEFAULT_COMPANY, capital: '1 000 €', siret: '98765432100019', rcs: 'Paris', vatNumber: 'FR12987654321', address: '1 avenue des Orchidées', postalCode: '75008', city: 'Paris' },
  });
  await call(`${BASE}/settings`, { method: 'PUT', cookie: admin, body: { ...DEFAULT_INVOICE_SETTINGS, iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP' } });
  await call('/api/admin/clients/c-beta', {
    method: 'PATCH',
    cookie: admin,
    body: { siret: '22222222200015', address: '2 rue B', postalCode: '44000', city: 'Nantes', vatNumber: 'fr22222222222' },
  });
}

describe('Facturation', () => {
  it('réservé à l’administration', async () => {
    const consultant = await login(CONSULTANT);
    expect((await call(BASE, { cookie: consultant })).status).toBe(403);
  });

  it('paramètres : valeurs par défaut, IBAN normalisé, contrôles', async () => {
    const admin = await login(ADMIN);
    expect(await json(await call(`${BASE}/settings`, { cookie: admin }))).toEqual(DEFAULT_INVOICE_SETTINGS);
    const saved = await json<{ iban: string }>(await call(`${BASE}/settings`, { method: 'PUT', cookie: admin, body: { ...DEFAULT_INVOICE_SETTINGS, iban: 'fr76 3000 6000 0112 3456 7890 189' } }));
    expect(saved.iban).toBe('FR7630006000011234567890189');
    const bad = await call(`${BASE}/settings`, { method: 'PUT', cookie: admin, body: { ...DEFAULT_INVOICE_SETTINGS, iban: 'XX', creditPrefix: 'FA' } });
    expect(bad.status).toBe(400);
  });

  it('à facturer → brouillon calculé → émission (mentions contrôlées) → envoyée → payée', async () => {
    const admin = await login(ADMIN);
    await validatedBetaTimesheet(admin);

    const billable = await json<BillableItem[]>(await call(`${BASE}/billable?month=${MONTH}`, { cookie: admin }));
    expect(billable).toHaveLength(1);
    expect(billable[0]).toMatchObject({ missionId: 'm-beta', days: 3, onCallDays: 1, interventionMinutes: 120, problems: [] });
    // 3 × 500 + 80 + 2 h × 60 + nuit 2 h × 30 + week-end 2 h × 60 = 1 880 € HT
    expect(billable[0].totalHt).toBe(188000);

    const { id } = await json<{ id: string }>(await call(BASE, { method: 'POST', cookie: admin, body: { missionId: 'm-beta', month: MONTH } }));
    let inv = await json<InvoiceDetail>(await call(`${BASE}/${id}`, { cookie: admin }));
    expect(inv).toMatchObject({ kind: 'FACTURE', status: 'BROUILLON', number: null, totalHt: 188000, totalVat: 37600, totalTtc: 225600, purchaseOrder: 'PO-2026-42' });
    expect(inv.missing).toContain('SIRET d’Orkidea (Paramètres › Société)');
    expect((await call(BASE, { method: 'POST', cookie: admin, body: { missionId: 'm-beta', month: MONTH } })).status).toBe(409);
    expect(await json<BillableItem[]>(await call(`${BASE}/billable?month=${MONTH}`, { cookie: admin }))).toEqual([]);

    // Ajustement d'une ligne dans le brouillon.
    const lines = [...inv.lines, { description: 'Frais de déplacement', quantity: 1, unit: 'forfait' as const, unitPrice: 12000 }];
    inv = await json<InvoiceDetail>(await call(`${BASE}/${id}`, { method: 'PATCH', cookie: admin, body: { lines, notes: 'Merci', baseUpdatedAt: inv.updatedAt } }));
    expect(inv.totalHt).toBe(200000);

    const refused = await call(`${BASE}/${id}/issue`, { method: 'POST', cookie: admin, body: { baseUpdatedAt: inv.updatedAt } });
    expect(refused.status).toBe(400);
    expect((await json<ApiError>(refused)).details).toContain('IBAN (Paramètres › Facturation)');

    await completeSellerAndClient(admin);
    const issued = await json<InvoiceDetail>(await call(`${BASE}/${id}/issue`, { method: 'POST', cookie: admin, body: { baseUpdatedAt: inv.updatedAt } }));
    expect(issued).toMatchObject({ status: 'EMISE', number: 'FA-2026-0001', issueDate: '2026-11-27', dueDate: '2027-01-11', missing: [] });
    expect(issued.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await call(`${BASE}/${id}`, { method: 'PATCH', cookie: admin, body: { notes: 'x', baseUpdatedAt: issued.updatedAt } })).status).toBe(409);
    expect((await call(`${BASE}/${id}`, { method: 'DELETE', cookie: admin })).status).toBe(409);

    const pdf = await call(`${BASE}/${id}/pdf`, { cookie: admin });
    expect(pdf.headers.get('content-disposition')).toContain('FA-2026-0001.pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(await env.CONTRACTS.head(`factures/${id}/FA-2026-0001.pdf`)).not.toBeNull();

    await call(`${BASE}/${id}/sent`, { method: 'POST', cookie: admin });
    expect((await call(`${BASE}/${id}/paid`, { method: 'POST', cookie: admin, body: { paidOn: '2026-12-01' } })).status).toBe(400); // futur
    const paid = await json<InvoiceDetail>(await call(`${BASE}/${id}/paid`, { method: 'POST', cookie: admin, body: { paidOn: '2026-11-27' } }));
    expect(paid).toMatchObject({ status: 'PAYEE', paidOn: '2026-11-27', overdue: false });
    expect(paid.events.map((e) => e.action)).toEqual(['PAIEMENT', 'ENVOI', 'EMISSION', 'MODIFICATION', 'CREATION']);

    const journal = await (await call(`${BASE}/journal?year=2026`, { cookie: admin })).text();
    expect(journal).toContain('27/11/2026;FA-2026-0001;Facture;Client Beta;Projet Beta;2026-11;2000,00;400,00;2400,00;11/01/2027;PAYEE;27/11/2026');
  });

  it('avoir : annule la facture, numérotation propre, la mission redevient facturable', async () => {
    const admin = await login(ADMIN);
    await validatedBetaTimesheet(admin);
    await completeSellerAndClient(admin);
    const { id } = await json<{ id: string }>(await call(BASE, { method: 'POST', cookie: admin, body: { missionId: 'm-beta', month: MONTH } }));
    const draft = await json<InvoiceDetail>(await call(`${BASE}/${id}`, { cookie: admin }));
    expect((await call(`${BASE}/${id}/credit-note`, { method: 'POST', cookie: admin })).status).toBe(409); // brouillon
    await call(`${BASE}/${id}/issue`, { method: 'POST', cookie: admin, body: { baseUpdatedAt: draft.updatedAt } });

    const credit = await json<{ id: string }>(await call(`${BASE}/${id}/credit-note`, { method: 'POST', cookie: admin }));
    expect((await call(`${BASE}/${id}/credit-note`, { method: 'POST', cookie: admin })).status).toBe(409);
    let note = await json<InvoiceDetail>(await call(`${BASE}/${credit.id}`, { cookie: admin }));
    expect(note).toMatchObject({ kind: 'AVOIR', status: 'BROUILLON', totalHt: -188000, related: { id, number: 'FA-2026-0001', kind: 'FACTURE' } });
    // Tant que l'avoir n'est pas émis, la mission n'est pas refacturable.
    expect(await json<BillableItem[]>(await call(`${BASE}/billable?month=${MONTH}`, { cookie: admin }))).toEqual([]);
    note = await json<InvoiceDetail>(await call(`${BASE}/${credit.id}/issue`, { method: 'POST', cookie: admin, body: { baseUpdatedAt: note.updatedAt } }));
    expect(note).toMatchObject({ number: 'AV-2026-0001', status: 'EMISE' });
    expect(await json<BillableItem[]>(await call(`${BASE}/billable?month=${MONTH}`, { cookie: admin }))).toHaveLength(1);
    const list = await json<InvoiceSummary[]>(await call(`${BASE}?month=${MONTH}`, { cookie: admin }));
    expect(list.map((i) => i.number).sort()).toEqual(['AV-2026-0001', 'FA-2026-0001']);
  });

  it('CRA non validé ou tarif manquant : pas de facture', async () => {
    const admin = await login(ADMIN);
    expect((await call(BASE, { method: 'POST', cookie: admin, body: { missionId: 'm-beta', month: MONTH } })).status).toBe(409);
    await validatedBetaTimesheet(admin);
    await call('/api/admin/missions/m-beta', { method: 'PATCH', cookie: admin, body: { onCallHourlyRate: null } });
    const res = await call(BASE, { method: 'POST', cookie: admin, body: { missionId: 'm-beta', month: MONTH } });
    expect(res.status).toBe(400);
    expect((await json<ApiError>(res)).details).toEqual(['Taux horaire des interventions d’astreinte non renseigné sur la mission']);
  });
});
