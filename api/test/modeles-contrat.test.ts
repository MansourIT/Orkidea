import { describe, expect, it, vi } from 'vitest';
import type { ApiError, ContractTemplateDetail, ContractTemplateSummary } from '../../shared/types';
import { ADMIN, CONSULTANT, call, json, login } from './helpers';

const BASE = '/api/admin/contract-templates';

async function create(admin: string, body = '# Contrat\n\n{{client.raison_sociale}}', name = 'Régie'): Promise<string> {
  const res = await call(BASE, { method: 'POST', cookie: admin, body: { name, body } });
  expect(res.status).toBe(201);
  return (await json<{ id: string }>(res)).id;
}

describe('Modèles de contrat', () => {
  it('réservé à l’administration', async () => {
    const consultant = await login(CONSULTANT);
    expect((await call(BASE, { cookie: consultant })).status).toBe(403);
    expect((await call(BASE)).status).toBe(401);
  });

  it('cycle : brouillon v1 → publication → brouillon v2 → publication ; anciennes versions conservées', async () => {
    const admin = await login(ADMIN);
    const id = await create(admin);
    let t = await json<ContractTemplateDetail>(await call(`${BASE}/${id}`, { cookie: admin }));
    expect(t).toMatchObject({ name: 'Régie', published: null, draft: { version: 1 }, contractsCount: 0, publishedBody: null });
    expect(t.versions).toMatchObject([{ version: 1, status: 'BROUILLON', updatedBy: 'Admin Orkidea' }]);

    // Enregistrement du brouillon avec contrôle de concurrence (horodatage du brouillon chargé).
    vi.setSystemTime(new Date('2026-11-27T10:05:00Z'));
    let res = await call(`${BASE}/${id}/draft`, { method: 'PUT', cookie: admin, body: { body: 'v1 modifiée {{mission.tjm}}', baseUpdatedAt: t.draft!.updatedAt } });
    expect(res.status).toBe(200);
    const stale = await call(`${BASE}/${id}/draft`, { method: 'PUT', cookie: admin, body: { body: 'écrasement', baseUpdatedAt: t.draft!.updatedAt } });
    expect(stale.status).toBe(409);
    t = await json<ContractTemplateDetail>(res);
    expect(t.draftBody).toBe('v1 modifiée {{mission.tjm}}');

    expect((await call(`${BASE}/${id}/publish`, { method: 'POST', cookie: admin })).status).toBe(200);
    t = await json<ContractTemplateDetail>(await call(`${BASE}/${id}`, { cookie: admin }));
    expect(t).toMatchObject({ published: { version: 1 }, draft: null, draftBody: null, publishedBody: 'v1 modifiée {{mission.tjm}}' });
    expect((await call(`${BASE}/${id}/publish`, { method: 'POST', cookie: admin })).status).toBe(409);

    // Une version publiée n'est jamais modifiée : l'enregistrement crée la v2.
    res = await call(`${BASE}/${id}/draft`, { method: 'PUT', cookie: admin, body: { body: 'v2', baseUpdatedAt: null } });
    t = await json<ContractTemplateDetail>(res);
    expect(t).toMatchObject({ published: { version: 1 }, draft: { version: 2 }, draftBody: 'v2', publishedBody: 'v1 modifiée {{mission.tjm}}' });
    expect(t.versions.map((v) => `${v.version}:${v.status}`)).toEqual(['2:BROUILLON', '1:PUBLIEE']);
    expect((await json<{ body: string }>(await call(`${BASE}/${id}/versions/1`, { cookie: admin }))).body).toBe('v1 modifiée {{mission.tjm}}');
    expect((await call(`${BASE}/${id}/versions/9`, { cookie: admin })).status).toBe(404);

    // Abandon du brouillon v2, puis nouvelle v2 publiée.
    expect((await call(`${BASE}/${id}/draft`, { method: 'DELETE', cookie: admin })).status).toBe(200);
    await call(`${BASE}/${id}/draft`, { method: 'PUT', cookie: admin, body: { body: 'v2 bis', baseUpdatedAt: null } });
    await call(`${BASE}/${id}/publish`, { method: 'POST', cookie: admin });
    const list = await json<ContractTemplateSummary[]>(await call(BASE, { cookie: admin }));
    expect(list).toMatchObject([{ id, published: { version: 2 }, draft: null }]);
  });

  it('publication refusée si le modèle contient des erreurs, détail ligne par ligne', async () => {
    const admin = await login(ADMIN);
    const id = await create(admin, 'OK\n{{mission.lieux}}\n{{#si mission.validation_client}}');
    const res = await call(`${BASE}/${id}/publish`, { method: 'POST', cookie: admin });
    expect(res.status).toBe(400);
    const err = await json<ApiError>(res);
    expect(err.details).toEqual(['Ligne 2 : Variable inconnue « mission.lieux ». Vouliez-vous dire « mission.lieu » ?', 'Ligne 3 : Bloc {{#si mission.validation_client}} jamais fermé par {{/si}}']);
  });

  it('brouillon jamais publié : ne peut pas être abandonné ; modèle archivé : non modifiable', async () => {
    const admin = await login(ADMIN);
    const id = await create(admin);
    expect((await call(`${BASE}/${id}/draft`, { method: 'DELETE', cookie: admin })).status).toBe(409);
    const res = await call(`${BASE}/${id}`, { method: 'PATCH', cookie: admin, body: { name: 'Forfait', description: 'Livrables', archived: true } });
    expect(await json<ContractTemplateDetail>(res)).toMatchObject({ name: 'Forfait', description: 'Livrables', archived: true });
    expect((await call(`${BASE}/${id}/draft`, { method: 'PUT', cookie: admin, body: { body: 'x', baseUpdatedAt: null } })).status).toBe(409);
    expect((await call(`${BASE}/${id}`, { cookie: admin, method: 'GET' })).status).toBe(200);
    expect((await call(`${BASE}/inconnu`, { cookie: admin })).status).toBe(404);
  });

  it('validation : nom obligatoire', async () => {
    const admin = await login(ADMIN);
    expect((await call(BASE, { method: 'POST', cookie: admin, body: { name: ' ', body: '' } })).status).toBe(400);
  });
});
