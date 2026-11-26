import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPANY, type CompanySettings } from '../../shared/company';
import { DEMO_TEMPLATE } from '../../shared/contrats/modele-demo';
import type { ApiError, ContractDetail, ContractSummary } from '../../shared/types';
import { ADMIN, CONSULTANT, call, json, login } from './helpers';

const COMPANY: CompanySettings = {
  ...DEFAULT_COMPANY,
  capital: '1 000 €',
  siret: '98765432100019',
  rcs: 'Paris 987 654 321',
  address: '1 avenue des Orchidées',
  postalCode: '75008',
  city: 'Paris',
  representativeName: 'Camille Bernard',
  financialGuarantee: 'Garantie n° 123, Banque X',
};

async function setup(admin: string, opts: { company?: boolean } = {}): Promise<string> {
  if (opts.company !== false) expect((await call('/api/admin/company', { method: 'PUT', cookie: admin, body: COMPANY })).status).toBe(200);
  const { id } = await json<{ id: string }>(await call('/api/admin/contract-templates', { method: 'POST', cookie: admin, body: { name: 'Régie', body: DEMO_TEMPLATE } }));
  expect((await call(`/api/admin/contract-templates/${id}/publish`, { method: 'POST', cookie: admin })).status).toBe(200);
  return id;
}

async function draft(admin: string, templateId: string, missionId = 'm-alpha'): Promise<ContractDetail> {
  const res = await call('/api/admin/contracts', { method: 'POST', cookie: admin, body: { missionId, templateId } });
  expect(res.status).toBe(201);
  const { id } = await json<{ id: string }>(res);
  return json<ContractDetail>(await call(`/api/admin/contracts/${id}`, { cookie: admin }));
}

const issue = (admin: string, c: ContractDetail) => call(`/api/admin/contracts/${c.id}/issue`, { method: 'POST', cookie: admin, body: { baseUpdatedAt: c.updatedAt } });

describe('Contrats de prestation', () => {
  it('réservé à l’administration', async () => {
    const consultant = await login(CONSULTANT);
    expect((await call('/api/admin/contracts', { cookie: consultant })).status).toBe(403);
  });

  it('brouillon : texte du modèle publié, données en direct, émission bloquée tant qu’il manque des données', async () => {
    const admin = await login(ADMIN);
    const templateId = await setup(admin, { company: false });
    const c = await draft(admin, templateId);
    expect(c).toMatchObject({ status: 'BROUILLON', number: null, body: DEMO_TEMPLATE, templateBody: DEMO_TEMPLATE, mission: { id: 'm-alpha' }, template: { version: 1 } });
    expect(c.data['client.raison_sociale']).toBe('Client Alpha');
    expect(c.missing).toContain('societe.garantie_financiere');
    expect(c.events.map((e) => e.action)).toEqual(['CREATION']);

    const res = await issue(admin, c);
    expect(res.status).toBe(400);
    expect((await json<ApiError>(res)).details).toContain('societe.siret');

    // Fiche société complétée : le brouillon reprend les nouvelles valeurs sans être régénéré.
    await call('/api/admin/company', { method: 'PUT', cookie: admin, body: COMPANY });
    const after = await json<ContractDetail>(await call(`/api/admin/contracts/${c.id}`, { cookie: admin }));
    expect(after.missing).toEqual([]);
    expect(after.data['societe.siret']).toBe('98765432100019');
  });

  it('modèle non publié ou archivé : pas de contrat', async () => {
    const admin = await login(ADMIN);
    const { id } = await json<{ id: string }>(await call('/api/admin/contract-templates', { method: 'POST', cookie: admin, body: { name: 'Brouillon seul', body: 'x' } }));
    expect((await call('/api/admin/contracts', { method: 'POST', cookie: admin, body: { missionId: 'm-alpha', templateId: id } })).status).toBe(409);
  });

  it('ajustement du texte, contrôle de concurrence, retour au modèle', async () => {
    vi.setSystemTime(new Date('2026-11-27T11:00:00Z'));
    const admin = await login(ADMIN);
    const c = await draft(admin, await setup(admin));
    const body = `${c.body}\nClause particulière : confidentialité renforcée.\n`;
    vi.setSystemTime(new Date('2026-11-27T11:01:00Z'));
    let res = await call(`/api/admin/contracts/${c.id}/body`, { method: 'PUT', cookie: admin, body: { body, baseUpdatedAt: c.updatedAt } });
    expect(res.status).toBe(200);
    const adjusted = await json<ContractDetail>(res);
    expect(adjusted.body).toBe(body);
    expect(adjusted.events.map((e) => e.action)).toEqual(['MODIFICATION', 'CREATION']);
    res = await call(`/api/admin/contracts/${c.id}/body`, { method: 'PUT', cookie: admin, body: { body: 'écrasement', baseUpdatedAt: c.updatedAt } });
    expect(res.status).toBe(409);
    vi.setSystemTime(new Date('2026-11-27T11:02:00Z'));
    const reset = await json<ContractDetail>(await call(`/api/admin/contracts/${c.id}/reset`, { method: 'POST', cookie: admin }));
    expect(reset.body).toBe(DEMO_TEMPLATE);
  });

  it('émission : numéros CS-2026-001 puis 002, données figées, PDF dans R2 avec empreinte, texte gelé', async () => {
    const admin = await login(ADMIN);
    const templateId = await setup(admin);
    const c1 = await draft(admin, templateId);
    const c2 = await draft(admin, templateId, 'm-beta');
    const res1 = await issue(admin, c1);
    expect(res1.status).toBe(200);
    const issued = await json<ContractDetail>(res1);
    expect(issued).toMatchObject({ status: 'EMIS', number: 'CS-2026-001', missing: [] });
    expect(issued.data['contrat.numero']).toBe('CS-2026-001');
    expect(issued.data['contrat.date']).toBe('27 novembre 2026');
    expect(issued.events[0]).toMatchObject({ action: 'EMISSION', actor: 'Admin Orkidea', comment: 'CS-2026-001' });
    expect(issued.pdfSha256).toMatch(/^[0-9a-f]{64}$/);

    // Mission Beta sans objet ni lieu : complétée puis émise avec le numéro suivant.
    expect((await issue(admin, c2)).status).toBe(400);
    await call('/api/admin/missions/m-beta', { method: 'PATCH', cookie: admin, body: { purpose: 'Audit', location: 'Nantes', paymentTermsDays: 45 } });
    await call('/api/admin/clients/c-beta', {
      method: 'PATCH',
      cookie: admin,
      body: { siret: '22222222222222', address: '2 rue B', postalCode: '44000', city: 'Nantes', representativeName: 'Paul B.', representativeRole: 'Gérant' },
    });
    expect((await json<ContractDetail>(await issue(admin, c2))).number).toBe('CS-2026-002');

    // Les données de la mission changent : le contrat émis garde les siennes.
    await call('/api/admin/missions/m-alpha', { method: 'PATCH', cookie: admin, body: { tjm: 999 } });
    const frozen = await json<ContractDetail>(await call(`/api/admin/contracts/${c1.id}`, { cookie: admin }));
    expect(frozen.data['mission.tjm']).toBe('550');

    // PDF : fichier R2 identique à l'empreinte enregistrée.
    const pdf = await call(`/api/admin/contracts/${c1.id}/pdf`, { cookie: admin });
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toContain('CS-2026-001.pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(digest).toBe(issued.pdfSha256);
    const object = await env.CONTRACTS.head(`contrats/${c1.id}/CS-2026-001.pdf`);
    expect(object?.size).toBe(bytes.length);

    // PDF absent de R2 : régénéré à l'identique.
    await env.CONTRACTS.delete(`contrats/${c1.id}/CS-2026-001.pdf`);
    const again = new Uint8Array(await (await call(`/api/admin/contracts/${c1.id}/pdf`, { cookie: admin })).arrayBuffer());
    expect(again).toEqual(bytes);

    // Texte gelé, double émission refusée.
    expect((await call(`/api/admin/contracts/${c1.id}/body`, { method: 'PUT', cookie: admin, body: { body: 'x', baseUpdatedAt: issued.updatedAt } })).status).toBe(409);
    expect((await issue(admin, issued)).status).toBe(409);

    const list = await json<ContractSummary[]>(await call('/api/admin/contracts?missionId=m-alpha', { cookie: admin }));
    expect(list.map((x) => x.number)).toEqual(['CS-2026-001']);
  });

  it('erreur dans le texte ajusté : émission refusée ; aperçu PDF du brouillon ; annulation avec motif', async () => {
    const admin = await login(ADMIN);
    const c = await draft(admin, await setup(admin));
    const draftPdf = await call(`/api/admin/contracts/${c.id}/draft.pdf`, { cookie: admin });
    expect(draftPdf.headers.get('content-type')).toBe('application/pdf');
    expect((await call(`/api/admin/contracts/${c.id}/pdf`, { cookie: admin })).status).toBe(409);

    vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
    const bad = await json<ContractDetail>(await call(`/api/admin/contracts/${c.id}/body`, { method: 'PUT', cookie: admin, body: { body: `${c.body}\n{{mission.lieux}}`, baseUpdatedAt: c.updatedAt } }));
    const res = await issue(admin, bad);
    expect(res.status).toBe(400);
    expect((await json<ApiError>(res)).details?.[0]).toMatch(/Variable inconnue « mission.lieux »/);

    expect((await call(`/api/admin/contracts/${c.id}/cancel`, { method: 'POST', cookie: admin, body: { reason: ' ' } })).status).toBe(400);
    const cancelled = await json<ContractDetail>(await call(`/api/admin/contracts/${c.id}/cancel`, { method: 'POST', cookie: admin, body: { reason: 'Mission reportée' } }));
    expect(cancelled).toMatchObject({ status: 'ANNULE', cancelReason: 'Mission reportée' });
    expect((await call(`/api/admin/contracts/${c.id}/cancel`, { method: 'POST', cookie: admin, body: { reason: 'x' } })).status).toBe(409);
  });
});

describe('Suivi des contrats : envoi et signature', () => {
  const signed = new TextEncoder().encode('%PDF-1.7\n% contrat signé scanné\n%%EOF');
  const upload = (admin: string, id: string, signedOn: string, data = signed, type = 'application/pdf') =>
    call(`/api/admin/contracts/${id}/signed?signedOn=${signedOn}`, { method: 'PUT', cookie: admin, raw: { data, type } });

  it('émis → envoyé → signé avec dépôt du PDF ; remplacement tracé', async () => {
    const admin = await login(ADMIN);
    const c = await draft(admin, await setup(admin));
    expect((await call(`/api/admin/contracts/${c.id}/sent`, { method: 'POST', cookie: admin })).status).toBe(409);
    const issued = await json<ContractDetail>(await issue(admin, c));

    const sent = await json<ContractDetail>(await call(`/api/admin/contracts/${issued.id}/sent`, { method: 'POST', cookie: admin, body: { comment: 'Envoyé à Sophie Bernard' } }));
    expect(sent).toMatchObject({ status: 'ENVOYE' });
    expect(sent.sentAt).not.toBeNull();
    expect(sent.events[0]).toMatchObject({ action: 'ENVOI', comment: 'Envoyé à Sophie Bernard' });
    expect((await call(`/api/admin/contracts/${issued.id}/sent`, { method: 'POST', cookie: admin })).status).toBe(409);

    // Contrôles du dépôt : type, contenu, dates.
    expect((await upload(admin, issued.id, '2026-11-27', signed, 'image/png')).status).toBe(415);
    expect((await upload(admin, issued.id, '2026-11-27', new TextEncoder().encode('pas un pdf'))).status).toBe(400);
    expect((await upload(admin, issued.id, '2026-11-26')).status).toBe(400); // avant l'émission
    expect((await upload(admin, issued.id, '2026-11-28')).status).toBe(400); // dans le futur
    expect((await call(`/api/admin/contracts/${issued.id}/signed.pdf`, { cookie: admin })).status).toBe(404);

    const res = await upload(admin, issued.id, '2026-11-27');
    expect(res.status).toBe(200);
    const s = await json<ContractDetail>(res);
    expect(s).toMatchObject({ status: 'SIGNE', signedOn: '2026-11-27' });
    expect(s.signedPdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.events[0]).toMatchObject({ action: 'SIGNATURE', comment: 'Signé le 27/11/2026' });
    const file = await call(`/api/admin/contracts/${issued.id}/signed.pdf`, { cookie: admin });
    expect(file.headers.get('content-disposition')).toContain('CS-2026-001-signe.pdf');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(signed);

    // Signé : plus d'annulation ; remplacement du fichier possible.
    expect((await call(`/api/admin/contracts/${issued.id}/cancel`, { method: 'POST', cookie: admin, body: { reason: 'x' } })).status).toBe(409);
    const replaced = await json<ContractDetail>(await upload(admin, issued.id, '2026-11-27', new TextEncoder().encode('%PDF-1.7 v2')));
    expect(replaced.events[0].comment).toMatch(/remplacé/);

    const list = await json<ContractSummary[]>(await call('/api/admin/contracts', { cookie: admin }));
    expect(list[0]).toMatchObject({ status: 'SIGNE', signedOn: '2026-11-27' });
  });

  it('signature directe d’un contrat émis (sans passer par « envoyé ») ; brouillon refusé', async () => {
    const admin = await login(ADMIN);
    const templateId = await setup(admin);
    const c = await draft(admin, templateId);
    expect((await upload(admin, c.id, '2026-11-27')).status).toBe(409);
    await issue(admin, c);
    const s = await json<ContractDetail>(await upload(admin, c.id, '2026-11-27'));
    expect(s.status).toBe('SIGNE');
    expect(s.sentAt).not.toBeNull();
  });
});
