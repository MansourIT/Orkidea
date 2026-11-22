// Reprise automatisée du scénario validé manuellement (section 5 du cahier des charges).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Timesheet } from '../../shared/types';
import { ADMIN, CONSULTANT, MONTH, WEEK1, call, captureMails, json, login, save, validationToken } from './helpers';

afterEach(() => vi.restoreAllMocks());

const alphaWeek: Entry[] = WEEK1.map((date) => ({ date, activityId: 'a-alpha-dev', quantity: 1 }));

/** Saisie Alpha + soumission ; retourne le cookie et le lien de validation envoyé au client. */
async function submitAlpha() {
  const cookie = await login(CONSULTANT);
  expect((await save(cookie, alphaWeek)).status).toBe(200);
  const mails = captureMails();
  const res = await call(`/api/timesheets/${MONTH}/submit`, { method: 'POST', cookie });
  expect(res.status).toBe(200);
  const ts = await json<Timesheet>(res);
  const mail = mails.find((m) => m.to === 'marie.martin@client-alpha.example');
  expect(mail).toBeDefined();
  return { cookie, ts, link: mail!.links[0] };
}

describe('Accès et authentification', () => {
  it('health est public', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('refuse une requête non authentifiée (401)', async () => {
    expect((await call(`/api/timesheets/${MONTH}`)).status).toBe(401);
    expect((await call('/api/auth/me')).status).toBe(401);
  });

  it('répond pareil que le compte existe ou non (pas d’énumération)', async () => {
    const mails = captureMails();
    const known = await call('/api/auth/login', { method: 'POST', body: { email: CONSULTANT } });
    const unknown = await call('/api/auth/login', { method: 'POST', body: { email: 'inconnu@example.com' } });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    expect(mails.map((m) => m.to)).toEqual([CONSULTANT]);
  });

  it('refuse un email mal formé (400)', async () => {
    expect((await call('/api/auth/login', { method: 'POST', body: { email: 'pas-un-email' } })).status).toBe(400);
  });

  it('connecte par lien magique et refuse sa réutilisation', async () => {
    const mails = captureMails();
    await call('/api/auth/login', { method: 'POST', body: { email: CONSULTANT } });
    const url = new URL(mails[0].links[0]);
    const first = await call(url.pathname + url.search);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('/');
    const cookieHeader = first.headers.get('set-cookie') ?? '';
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/SameSite=Lax/i);

    const again = await call(url.pathname + url.search);
    expect(again.status).toBe(302);
    expect(again.headers.get('location')).toBe('/login?erreur=lien');

    const me = await call('/api/auth/me', { cookie: cookieHeader.split(';')[0] });
    expect(await me.json()).toMatchObject({ email: CONSULTANT, role: 'consultant' });
  });

  it('déconnexion : la session n’est plus valable', async () => {
    const cookie = await login(CONSULTANT);
    expect((await call('/api/auth/logout', { method: 'POST', cookie })).status).toBe(200);
    expect((await call('/api/auth/me', { cookie })).status).toBe(401);
  });

  it('refuse une écriture depuis une origine étrangère (403)', async () => {
    const cookie = await login(CONSULTANT);
    const res = await call(`/api/timesheets/${MONTH}`, { method: 'PUT', cookie, origin: 'https://evil.example', body: { entries: [] } });
    expect(res.status).toBe(403);
  });

  it('refuse une route admin à un consultant (403)', async () => {
    const cookie = await login(CONSULTANT);
    expect((await call(`/api/admin/timesheets?month=${MONTH}`, { cookie })).status).toBe(403);
  });
});

describe('Saisie', () => {
  it('crée le brouillon à la première lecture', async () => {
    const cookie = await login(CONSULTANT);
    const ts = await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { cookie }));
    expect(ts).toMatchObject({ month: MONTH, status: 'BROUILLON', entries: [], workingDays: 20 });
  });

  it('liste les activités du consultant (missions + absences)', async () => {
    const cookie = await login(CONSULTANT);
    const acts = await json<Array<{ id: string }>>(await call('/api/activities', { cookie }));
    const ids = acts.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['a-alpha-dev', 'a-beta-doc', 'abs-cp', 'abs-rtt']));
    expect(acts[0]).not.toHaveProperty('missionStart');
  });

  it('enregistre l’ordre des activités', async () => {
    const cookie = await login(CONSULTANT);
    const res = await call('/api/activities/order', { method: 'PUT', cookie, body: { ids: ['abs-cp', 'a-beta-doc', 'inconnue'] } });
    expect(res.status).toBe(200);
    const acts = await json<Array<{ id: string }>>(await call('/api/activities', { cookie }));
    expect(acts.slice(0, 2).map((a) => a.id)).toEqual(['abs-cp', 'a-beta-doc']);
  });

  it('rejette une saisie invalide avec la liste des erreurs (422)', async () => {
    const cookie = await login(CONSULTANT);
    const res = await save(cookie, [
      { date: '2026-12-01', activityId: 'a-alpha-dev', quantity: 1 },
      { date: '2026-11-03', activityId: 'a-alpha-dev', quantity: 1 },
      { date: '2026-11-03', activityId: 'a-beta-dev', quantity: 0.5 },
    ]);
    expect(res.status).toBe(422);
    const body = await json<{ details: string[] }>(res);
    expect(body.details).toEqual(['Date hors du mois : 2026-12-01', "Plus d'une journée saisie le 2026-11-03"]);
  });

  it('accepte deux demi-journées sur une même date', async () => {
    const cookie = await login(CONSULTANT);
    const res = await save(
      cookie,
      [
        { date: '2026-11-03', activityId: 'a-alpha-dev', quantity: 0.5 },
        { date: '2026-11-03', activityId: 'abs-cp', quantity: 0.5 },
      ],
      'Mi-temps',
    );
    expect(res.status).toBe(200);
    const ts = await json<Timesheet>(res);
    expect(ts.entries).toHaveLength(2);
    expect(ts.comment).toBe('Mi-temps');
  });

  it('refuse la soumission d’un CRA vide (422)', async () => {
    const cookie = await login(CONSULTANT);
    await call(`/api/timesheets/${MONTH}`, { cookie });
    expect((await call(`/api/timesheets/${MONTH}/submit`, { method: 'POST', cookie })).status).toBe(422);
  });
});

describe('Cycle de validation', () => {
  it('soumission avec mission à validation client → SOUMIS, puis modification refusée (409)', async () => {
    const { cookie, ts } = await submitAlpha();
    expect(ts.status).toBe('SOUMIS');
    expect(ts.validations).toEqual([expect.objectContaining({ missionLabel: 'Projet Alpha', status: 'EN_ATTENTE' })]);
    expect((await save(cookie, alphaWeek)).status).toBe(409);
  });

  it('le valideur ne voit que les jours de sa mission', async () => {
    const cookie = await login(CONSULTANT);
    await save(cookie, [
      ...alphaWeek,
      { date: '2026-11-09', activityId: 'a-beta-dev', quantity: 1 },
      { date: '2026-11-10', activityId: 'abs-maladie', quantity: 1 },
    ]);
    const mails = captureMails();
    await call(`/api/timesheets/${MONTH}/submit`, { method: 'POST', cookie });
    const token = validationToken(mails[0].links[0]);
    const view = await json<{ entries: Array<{ date: string }>; totalDays: number; mission: string }>(
      await call(`/api/public/validations/${encodeURIComponent(token)}`),
    );
    expect(view.mission).toBe('Projet Alpha');
    expect(view.totalDays).toBe(5);
    expect(view.entries.map((e) => e.date)).toEqual(WEEK1);
  });

  it('rejet sans motif refusé, avec motif → REJETE et consultant notifié', async () => {
    const { cookie, link } = await submitAlpha();
    const path = `/api/public/validations/${encodeURIComponent(validationToken(link))}`;
    expect((await call(path, { method: 'POST', body: { decision: 'REJETE' } })).status).toBe(400);

    const mails = captureMails();
    const res = await call(path, { method: 'POST', body: { decision: 'REJETE', comment: 'Le 4 était férié chez nous' } });
    expect(res.status).toBe(200);
    expect(mails.map((m) => m.to)).toContain(CONSULTANT);

    const ts = await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { cookie }));
    expect(ts.status).toBe('REJETE');
    expect(ts.validations[0]).toMatchObject({ status: 'REJETE', comment: 'Le 4 était férié chez nous' });
    // REJETE est de nouveau modifiable
    expect((await save(cookie, alphaWeek.slice(0, 4))).status).toBe(200);
  });

  it('nouvelle soumission → ancien lien en 404, nouveau lien validé → VALIDE', async () => {
    const { cookie, link: oldLink } = await submitAlpha();
    const oldPath = `/api/public/validations/${encodeURIComponent(validationToken(oldLink))}`;
    await call(oldPath, { method: 'POST', body: { decision: 'REJETE', comment: 'Erreur' } });

    const mails = captureMails();
    expect((await call(`/api/timesheets/${MONTH}/submit`, { method: 'POST', cookie })).status).toBe(200);
    const newPath = `/api/public/validations/${encodeURIComponent(validationToken(mails[0].links[0]))}`;

    expect((await call(oldPath)).status).toBe(404);
    expect((await call(oldPath, { method: 'POST', body: { decision: 'VALIDE' } })).status).toBe(409);

    expect((await call(newPath, { method: 'POST', body: { decision: 'VALIDE' } })).status).toBe(200);
    const ts = await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { cookie }));
    expect(ts.status).toBe('VALIDE');
    // Une décision déjà prise ne peut pas être rejouée
    expect((await call(newPath, { method: 'POST', body: { decision: 'REJETE', comment: 'x' } })).status).toBe(409);
  });

  it('CRA sans mission à validation client → VALIDE directement', async () => {
    const cookie = await login(CONSULTANT);
    await save(cookie, WEEK1.map((date) => ({ date, activityId: 'a-beta-dev', quantity: 1 })));
    const mails = captureMails();
    const ts = await json<Timesheet>(await call(`/api/timesheets/${MONTH}/submit`, { method: 'POST', cookie }));
    expect(ts.status).toBe('VALIDE');
    expect(ts.validations).toEqual([]);
    expect(mails).toHaveLength(0);
  });

  it('admin : tableau de bord, clôture d’un CRA validé, réouverture', async () => {
    const consultant = await login(CONSULTANT);
    await save(consultant, WEEK1.map((date) => ({ date, activityId: 'a-beta-dev', quantity: 1 })));
    await call(`/api/timesheets/${MONTH}/submit`, { method: 'POST', cookie: consultant });

    const adminCookie = await login(ADMIN);
    const board = await json<{ workingDays: number; rows: Array<{ id: string; status: string; workedDays: number }> }>(
      await call(`/api/admin/timesheets?month=${MONTH}`, { cookie: adminCookie }),
    );
    expect(board.workingDays).toBe(20);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]).toMatchObject({ status: 'VALIDE', workedDays: 5 });

    const id = board.rows[0].id;
    expect((await call(`/api/admin/timesheets/${id}/close`, { method: 'POST', cookie: adminCookie })).status).toBe(200);
    expect((await call(`/api/admin/timesheets/${id}/close`, { method: 'POST', cookie: adminCookie })).status).toBe(409);
    let ts = await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { cookie: consultant }));
    expect(ts.status).toBe('CLOTURE');

    expect((await call(`/api/admin/timesheets/${id}/reopen`, { method: 'POST', cookie: adminCookie })).status).toBe(200);
    ts = await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { cookie: consultant }));
    expect(ts.status).toBe('BROUILLON');
  });

  it('génère le PDF du CRA', async () => {
    const cookie = await login(CONSULTANT);
    await save(cookie, [...alphaWeek, { date: '2026-11-09', activityId: 'abs-cp', quantity: 0.5 }], 'RAS');
    const res = await call(`/api/timesheets/${MONTH}/pdf`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('CRA-2026-11-Jean_Dupont.pdf');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe('Admin : référentiels', () => {
  it('crée un client, une mission avec validation client et ses activités', async () => {
    const cookie = await login(ADMIN);
    const noValidator = await call('/api/admin/missions', {
      method: 'POST',
      cookie,
      body: { consultantId: 'u-jd', clientId: 'c-beta', label: 'X', startDate: '2026-11-01', clientValidation: true },
    });
    expect(noValidator.status).toBe(400);

    const client = await json<{ id: string }>(await call('/api/admin/clients', { method: 'POST', cookie, body: { name: 'Client Delta' } }));
    const res = await call('/api/admin/missions', {
      method: 'POST',
      cookie,
      body: {
        consultantId: 'u-jd',
        clientId: client.id,
        label: 'Projet Delta',
        startDate: '2026-11-01',
        clientValidation: true,
        validatorEmail: 'valideur@delta.example',
        activities: ['Audit', 'Conseil'],
        color: '#10B981',
      },
    });
    expect(res.status).toBe(201);
    const jd = await login(CONSULTANT);
    const acts = await json<Array<{ missionLabel: string | null; label: string }>>(await call('/api/activities', { cookie: jd }));
    expect(acts.filter((a) => a.missionLabel === 'Projet Delta').map((a) => a.label).sort()).toEqual(['Audit', 'Conseil']);
  });
});
