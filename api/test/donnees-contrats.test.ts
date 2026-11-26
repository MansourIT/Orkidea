import { describe, expect, it } from 'vitest';
import type { AdminUser, ApiError, Client, Mission } from '../../shared/types';
import { DEFAULT_COMPANY, type CompanySettings } from '../../shared/company';
import { ADMIN, CONSULTANT, call, json, login } from './helpers';

describe('Données des contrats de prestation', () => {
  it('identité d’Orkidea : valeurs par défaut, enregistrement et contrôles', async () => {
    const admin = await login(ADMIN);
    expect(await json<CompanySettings>(await call('/api/admin/company', { cookie: admin }))).toEqual(DEFAULT_COMPANY);

    const company: CompanySettings = {
      ...DEFAULT_COMPANY,
      capital: '1 000 €',
      siret: '98765432100019',
      rcs: 'Paris 987 654 321',
      vatNumber: 'FR12987654321',
      address: '1 avenue des Orchidées',
      postalCode: '75008',
      city: 'Paris',
      representativeName: 'Camille Bernard',
      financialGuarantee: 'Garantie financière n° 123 souscrite auprès de la banque X',
    };
    expect((await call('/api/admin/company', { method: 'PUT', cookie: admin, body: company })).status).toBe(200);
    expect(await json<CompanySettings>(await call('/api/admin/company', { cookie: admin }))).toEqual(company);

    const bad = await call('/api/admin/company', { method: 'PUT', cookie: admin, body: { ...company, siret: '123', vatNumber: 'X', contractNumberPrefix: 'cs' } });
    expect(bad.status).toBe(400);
    expect((await json<ApiError>(bad)).details?.join(' ')).toMatch(/SIRET.*TVA.*Préfixe/s);
  });

  it('identité d’Orkidea : réservée à l’administration', async () => {
    const consultant = await login(CONSULTANT);
    expect((await call('/api/admin/company', { cookie: consultant })).status).toBe(403);
  });

  it('client : coordonnées et signataire, création et modification partielle', async () => {
    const admin = await login(ADMIN);
    const created = await json<{ id: string }>(
      await call('/api/admin/clients', {
        method: 'POST',
        cookie: admin,
        body: { name: 'Initech', address: '3 quai Ouest', postalCode: '69002', city: 'Lyon', representativeName: 'Bill L.', contractEmail: 'achats@initech.example' },
      }),
    );
    const patched = await call(`/api/admin/clients/${created.id}`, { method: 'PATCH', cookie: admin, body: { representativeRole: 'Directeur', city: '' } });
    expect(patched.status).toBe(200);
    const list = await json<Client[]>(await call('/api/admin/clients', { cookie: admin }));
    expect(list.find((c) => c.id === created.id)).toEqual({
      id: created.id,
      name: 'Initech',
      siret: null,
      address: '3 quai Ouest',
      postalCode: '69002',
      city: null,
      representativeName: 'Bill L.',
      representativeRole: 'Directeur',
      contractEmail: 'achats@initech.example',
    });
    expect(list.find((c) => c.id === 'c-alpha')?.representativeName).toBe('Sophie Bernard');

    const bad = await call(`/api/admin/clients/${created.id}`, { method: 'PATCH', cookie: admin, body: { contractEmail: 'pas-un-email' } });
    expect(bad.status).toBe(400);
  });

  it('mission : objet, lieu, modalités et délai de paiement', async () => {
    const admin = await login(ADMIN);
    const missions = await json<Mission[]>(await call('/api/admin/missions', { cookie: admin }));
    expect(missions.find((m) => m.id === 'm-alpha')).toMatchObject({ purpose: 'Refonte de la plateforme de paiement', paymentTermsDays: 30 });

    const res = await call('/api/admin/missions/m-beta', { method: 'PATCH', cookie: admin, body: { purpose: 'Audit sécurité', location: 'Nantes', paymentTermsDays: 45 } });
    expect(res.status).toBe(200);
    expect(await json<Mission>(res)).toMatchObject({ purpose: 'Audit sécurité', location: 'Nantes', terms: null, paymentTermsDays: 45, label: 'Projet Beta' });

    const tooLong = await call('/api/admin/missions/m-beta', { method: 'PATCH', cookie: admin, body: { paymentTermsDays: 90 } });
    expect(tooLong.status).toBe(400);
    expect((await json<ApiError>(tooLong)).details?.join(' ')).toMatch(/60 jours/);

    const created = await call('/api/admin/missions', {
      method: 'POST',
      cookie: admin,
      body: { consultantId: 'u-jd', clientId: 'c-beta', label: 'Projet Delta', startDate: '2026-12-01', purpose: 'Migration cloud', paymentTermsDays: 30 },
    });
    expect(created.status).toBe(201);
    const { id } = await json<{ id: string }>(created);
    const delta = (await json<Mission[]>(await call('/api/admin/missions', { cookie: admin }))).find((m) => m.id === id);
    expect(delta).toMatchObject({ purpose: 'Migration cloud', location: null, paymentTermsDays: 30 });
  });

  it('consultant : qualification', async () => {
    const admin = await login(ADMIN);
    const res = await call('/api/admin/users/u-jd', { method: 'PATCH', cookie: admin, body: { qualification: 'Expert DevOps' } });
    expect(res.status).toBe(200);
    expect(await json<AdminUser>(res)).toMatchObject({ id: 'u-jd', name: 'Jean Dupont', active: true, qualification: 'Expert DevOps' });
    await call('/api/admin/users', { method: 'POST', cookie: admin, body: { email: 'new@example.com', name: 'Nouvelle', qualification: 'Data engineer' } });
    const users = await json<AdminUser[]>(await call('/api/admin/users', { cookie: admin }));
    expect(users.find((u) => u.email === 'new@example.com')?.qualification).toBe('Data engineer');
    expect(users.find((u) => u.id === 'u-admin')?.qualification).toBeNull();
  });
});
