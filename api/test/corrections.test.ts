// Tests des corrections de la revue (B*, I*, C*) et des nouvelles fonctionnalités (paramétrage, admin).
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminTimesheetBoard, Activity, ApiError, ClientConfig, Mission, Timesheet, TimesheetEvent, TimesheetSummary } from '../../shared/types';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings';
import { sendMail } from '../src/core/mail';
import { purgeExpired } from '../src/cron';
import { ADMIN, CONSULTANT, MONTH, WEEK1, call, captureMails, json, login, loginToken, save, validationToken } from './helpers';

afterEach(() => vi.restoreAllMocks());

const beta = (dates: string[]) => dates.map((date) => ({ date, activityId: 'a-beta-dev', quantity: 1 as const }));
const alpha = (dates: string[]) => dates.map((date) => ({ date, activityId: 'a-alpha-dev', quantity: 1 as const }));

async function putSettings(patch: { calendar?: Partial<AppSettings['calendar']>; submission?: Partial<AppSettings['submission']> }) {
  const admin = await login(ADMIN);
  const body: AppSettings = {
    calendar: { ...DEFAULT_SETTINGS.calendar, ...patch.calendar },
    submission: { ...DEFAULT_SETTINGS.submission, ...patch.submission },
  };
  const res = await call('/api/admin/settings', { method: 'PUT', cookie: admin, body });
  expect(res.status).toBe(200);
  return admin;
}

async function submit(cookie: string, month = MONTH) {
  return call(`/api/timesheets/${month}/submit`, { method: 'POST', cookie });
}

async function timesheetId(month = MONTH): Promise<string> {
  const row = await env.DB.prepare(`SELECT id FROM timesheets WHERE consultant_id = 'u-jd' AND month = ?`).bind(month).first<{ id: string }>();
  return row!.id;
}

describe('Connexion (B4, B5, I2, I5, C8)', () => {
  it('B5 : ouvrir le lien (GET, antivirus) ne consomme pas le jeton', async () => {
    const mails = captureMails();
    await call('/api/auth/login', { method: 'POST', body: { email: CONSULTANT } });
    const token = loginToken(mails[0].links[0]);
    const prefetch = await call(`/api/auth/callback?token=${encodeURIComponent(token)}`);
    expect(prefetch.status).toBe(302);
    expect(prefetch.headers.get('location')).toBe(`/connexion?token=${encodeURIComponent(token)}`);
    expect((await call('/api/auth/callback', { method: 'POST', body: { token } })).status).toBe(200);
  });

  it('I2 : deux utilisations simultanées du lien → une seule session', async () => {
    const mails = captureMails();
    await call('/api/auth/login', { method: 'POST', body: { email: CONSULTANT } });
    const token = loginToken(mails[0].links[0]);
    const results = await Promise.all([1, 2, 3].map(() => call('/api/auth/callback', { method: 'POST', body: { token } })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    const n = await env.DB.prepare('SELECT count(*) AS n FROM sessions').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('I5 : au-delà de 3 liens en attente, plus d’email (réponse identique)', async () => {
    const mails = captureMails();
    for (let i = 0; i < 5; i++) {
      const res = await call('/api/auth/login', { method: 'POST', body: { email: CONSULTANT } });
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(mails).toHaveLength(3);
  });

  it('I5 : limitation de débit par IP (429)', async () => {
    captureMails();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call('/api/auth/login', { method: 'POST', ip: '203.0.113.7', body: { email: 'x@example.com' } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('I13 : espaces autour de l’email tolérés', async () => {
    const mails = captureMails();
    expect((await call('/api/auth/login', { method: 'POST', body: { email: `  ${CONSULTANT} ` } })).status).toBe(200);
    expect(mails.map((m) => m.to)).toEqual([CONSULTANT]);
  });

  it('C8 : en HTTPS, cookie __Host- Secure', async () => {
    const mails = captureMails();
    await call('/api/auth/login', { method: 'POST', body: { email: CONSULTANT } });
    const res = await call('/api/auth/callback', {
      method: 'POST',
      base: 'https://app.example',
      origin: 'https://app.example',
      body: { token: loginToken(mails[0].links[0]) },
    });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^__Host-ork_session=/);
    expect(cookie).toMatch(/Secure/);
    const me = await call('/api/auth/me', { base: 'https://app.example', cookie: cookie.split(';')[0] });
    expect(me.status).toBe(200);
  });

  it('B4 : sans clé Brevo hors mode dev, l’envoi échoue au lieu d’écrire le lien dans les logs', async () => {
    const log = vi.spyOn(console, 'log');
    await expect(sendMail({ ...env, MAIL_DEV_LOG: undefined, BREVO_API_KEY: undefined }, { to: 'a@b.fr', subject: 's', html: 'secret' })).rejects.toThrow(
      /BREVO_API_KEY/,
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('C1 : le nom est échappé dans l’email de connexion', async () => {
    await env.DB.prepare(`UPDATE users SET name = '<b>Jean</b>' WHERE id = 'u-jd'`).run();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await call('/api/auth/login', { method: 'POST', body: { email: CONSULTANT } });
    expect(String(spy.mock.calls[0][0])).toContain('&lt;b&gt;Jean&lt;/b&gt;');
  });

  it('refuse un JSON mal formé (400, pas 500)', async () => {
    const res = await env.DB.prepare('SELECT 1').first();
    expect(res).toBeTruthy();
    const req = new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oups' });
    const { app } = await import('../src/index');
    const r = await app.fetch(req, env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
    expect(r.status).toBe(400);
  });

  it('refuse un Sec-Fetch-Site cross-site', async () => {
    const cookie = await login(CONSULTANT);
    const { app } = await import('../src/index');
    const req = new Request(`http://localhost/api/timesheets/${MONTH}`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ entries: [] }),
    });
    const r = await app.fetch(req, env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
    expect(r.status).toBe(403);
  });
});

describe('Calendrier paramétrable (I1)', () => {
  it('refuse par défaut les week-ends et fériés côté serveur', async () => {
    const cookie = await login(CONSULTANT);
    const res = await save(cookie, [...beta(['2026-11-07']), ...beta(['2026-11-11'])]);
    expect(res.status).toBe(422);
    expect((await json<ApiError>(res)).details).toEqual([
      'Le 07/11/2026 est un week-end : saisie non autorisée pour Projet Beta · Développement',
      'Le 11/11/2026 est férié (Armistice 1918) : saisie non autorisée pour Projet Beta · Développement',
    ]);
  });

  it('la mission peut autoriser les week-ends ; les absences restent interdites', async () => {
    const admin = await login(ADMIN);
    expect((await call('/api/admin/missions/m-beta', { method: 'PATCH', cookie: admin, body: { weekendPolicy: 'AUTORISE' } })).status).toBe(200);
    const cookie = await login(CONSULTANT);
    expect((await save(cookie, beta(['2026-11-07']))).status).toBe(200);
    expect((await save(cookie, alpha(['2026-11-07']))).status).toBe(422);
    const abs = await save(cookie, [{ date: '2026-11-08', activityId: 'abs-cp', quantity: 1 }]);
    expect((await json<ApiError>(abs)).details?.[0]).toContain('week-end');
    const acts = await json<Activity[]>(await call('/api/activities', { cookie }));
    expect(acts.find((a) => a.id === 'a-beta-dev')?.rules.weekend).toBe('AUTORISE');
    expect(acts.find((a) => a.id === 'a-alpha-dev')?.rules.weekend).toBe('INTERDIT');
  });

  it('jour férié travaillé par exception (paramétrage global)', async () => {
    await putSettings({ calendar: { workedHolidays: ['armistice'] } });
    const cookie = await login(CONSULTANT);
    expect((await save(cookie, beta(['2026-11-11']))).status).toBe(200);
  });

  it('région Alsace-Moselle : 26 décembre férié', async () => {
    vi.setSystemTime(new Date('2026-12-29T10:00:00Z'));
    const admin = await login(ADMIN);
    await call('/api/admin/missions/m-beta', { method: 'PATCH', cookie: admin, body: { holidayRegion: 'alsace-moselle' } });
    const cookie = await login(CONSULTANT);
    const res = await call('/api/timesheets/2026-12', { method: 'PUT', cookie, body: { entries: beta(['2026-12-26', '2026-12-28']).slice(1) } });
    expect(res.status).toBe(200);
    const bad = await call('/api/timesheets/2026-12', { method: 'PUT', cookie, body: { entries: [{ date: '2026-12-28', activityId: 'a-beta-dev', quantity: 1 }, { date: '2026-12-25', activityId: 'a-beta-dev', quantity: 1 }] } });
    expect((await json<ApiError>(bad)).details).toEqual(['Le 25/12/2026 est férié (Noël) : saisie non autorisée pour Projet Beta · Développement']);
  });
});

describe('Soumission paramétrable', () => {
  it('fermée avant les 3 derniers jours ouvrés (défaut), avec la date d’ouverture', async () => {
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    const cookie = await login(CONSULTANT);
    await save(cookie, beta(WEEK1));
    const ts = await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { cookie }));
    expect(ts.submissionOpensOn).toBe('2026-11-26');
    expect(ts.submissionBlockedReason).toBe('La soumission de novembre 2026 ouvre le 26/11/2026');
    const res = await submit(cookie);
    expect(res.status).toBe(422);
    expect((await json<ApiError>(res)).error).toBe('La soumission de novembre 2026 ouvre le 26/11/2026');
  });

  it('ouverture « TOUJOURS » : soumission possible dès le début du mois', async () => {
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
    await putSettings({ submission: { opening: 'TOUJOURS' } });
    const cookie = await login(CONSULTANT);
    await save(cookie, beta(['2026-11-02']));
    expect((await submit(cookie)).status).toBe(200);
  });

  it('mois futur refusé par défaut', async () => {
    const cookie = await login(CONSULTANT);
    await call('/api/timesheets/2026-12', { method: 'PUT', cookie, body: { entries: beta(['2026-12-01']) } });
    const res = await submit(cookie, '2026-12');
    expect((await json<ApiError>(res)).error).toBe('Impossible de soumettre un mois futur (décembre 2026)');
  });

  it('complétude BLOQUER : liste des jours ouvrés manquants', async () => {
    await putSettings({ submission: { completeness: 'BLOQUER' } });
    const cookie = await login(CONSULTANT);
    await save(cookie, beta(WEEK1));
    const res = await submit(cookie);
    expect(res.status).toBe(422);
    const body = await json<ApiError>(res);
    expect(body.code).toBe('JOURS_MANQUANTS');
    expect(body.error).toBe('15 jour(s) ouvré(s) non renseigné(s)');
    expect(body.details?.[0]).toBe('09/11/2026');
  });

  it('mois trop ancien (au-delà de 3 mois) non modifiable', async () => {
    const cookie = await login(CONSULTANT);
    const res = await call('/api/timesheets/2026-07', { method: 'PUT', cookie, body: { entries: beta(['2026-07-01']) } });
    expect(res.status).toBe(409);
    expect((await call('/api/timesheets/2026-08', { method: 'PUT', cookie, body: { entries: beta(['2026-08-03']) } })).status).toBe(200);
  });

  it('I12 : mois hors période refusé (400)', async () => {
    const cookie = await login(CONSULTANT);
    expect((await call('/api/timesheets/2029-01', { cookie })).status).toBe(400);
    expect((await call('/api/timesheets/2020-01', { cookie })).status).toBe(400);
  });

  it('les règles de saisie sont recontrôlées à la soumission', async () => {
    const cookie = await login(CONSULTANT);
    await save(cookie, beta(WEEK1));
    const admin = await login(ADMIN);
    await call('/api/admin/missions/m-beta', { method: 'PATCH', cookie: admin, body: { endDate: '2026-11-03' } });
    const res = await submit(cookie);
    expect(res.status).toBe(422);
    expect((await json<ApiError>(res)).details).toContain('Le 2026-11-04 est en dehors des dates de la mission Projet Beta');
  });
});

describe('Saisie (I4, I10)', () => {
  it('I10 : comment null efface le commentaire, absent le conserve', async () => {
    const cookie = await login(CONSULTANT);
    await save(cookie, [], 'Note');
    expect((await json<Timesheet>(await save(cookie, []))).comment).toBe('Note');
    expect((await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { method: 'PUT', cookie, body: { entries: [], comment: null } }))).comment).toBeNull();
  });

  it('I4 : activité désactivée conservée dans le CRA du mois (archived)', async () => {
    const cookie = await login(CONSULTANT);
    await save(cookie, beta(['2026-11-02']));
    const admin = await login(ADMIN);
    expect((await call('/api/admin/activities/a-beta-dev', { method: 'PATCH', cookie: admin, body: { active: false } })).status).toBe(200);
    expect((await json<Activity[]>(await call('/api/activities', { cookie }))).some((a) => a.id === 'a-beta-dev')).toBe(false);
    const withMonth = await json<Activity[]>(await call(`/api/activities?month=${MONTH}`, { cookie }));
    expect(withMonth.find((a) => a.id === 'a-beta-dev')).toMatchObject({ archived: true, label: 'Développement', missionLabel: 'Projet Beta' });
    // Le brouillon reste enregistrable avec la ligne existante.
    expect((await save(cookie, [...beta(['2026-11-02']), ...alpha(['2026-11-03'])])).status).toBe(200);
    expect((await call(`/api/timesheets/${MONTH}/pdf`, { cookie })).status).toBe(200);
  });

  it('valide le format des lignes (400)', async () => {
    const cookie = await login(CONSULTANT);
    const res = await call(`/api/timesheets/${MONTH}`, { method: 'PUT', cookie, body: { entries: [{ date: '2026-11-02', activityId: 'a-beta-dev', quantity: 0.3 }] } });
    expect(res.status).toBe(400);
    expect((await json<ApiError>(res)).details?.[0]).toMatch(/^entries\.0\.quantity/);
  });

  it('tableau de bord consultant : 12 derniers mois sans créer de brouillon', async () => {
    const cookie = await login(CONSULTANT);
    await save(cookie, [...beta(WEEK1), { date: '2026-11-09', activityId: 'abs-rtt', quantity: 0.5 }]);
    const list = await json<TimesheetSummary[]>(await call('/api/timesheets', { cookie }));
    expect(list).toHaveLength(12);
    expect(list[0]).toMatchObject({ month: '2026-11', status: 'BROUILLON', workedDays: 5, absenceDays: 0.5, workingDays: 20 });
    expect(list[11]).toMatchObject({ month: '2025-12', status: 'NON_COMMENCE' });
    const n = await env.DB.prepare('SELECT count(*) AS n FROM timesheets').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('configuration exposée au front', async () => {
    const cookie = await login(CONSULTANT);
    const cfg = await json<ClientConfig>(await call('/api/config', { cookie }));
    expect(cfg.today).toBe('2026-11-27');
    expect(cfg.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('Validation client (I3, C6)', () => {
  async function submitAlpha() {
    const cookie = await login(CONSULTANT);
    await save(cookie, alpha(WEEK1));
    const mails = captureMails();
    await submit(cookie);
    return { cookie, token: validationToken(mails[0].links[0]) };
  }

  it('C6 : lien remplacé → 404 avec code LIEN_REMPLACE ; lien inconnu → LIEN_INVALIDE', async () => {
    const { cookie, token } = await submitAlpha();
    await call(`/api/public/validations/${token}`, { method: 'POST', body: { decision: 'REJETE', comment: 'non' } });
    await submit(cookie);
    expect(await json<ApiError>(await call(`/api/public/validations/${token}`))).toMatchObject({ code: 'LIEN_REMPLACE' });
    expect(await json<ApiError>(await call('/api/public/validations/inconnu-inconnu'))).toMatchObject({ code: 'LIEN_INVALIDE' });
  });

  it('I3 : deux décisions simultanées → une seule prise en compte', async () => {
    const { token } = await submitAlpha();
    const path = `/api/public/validations/${token}`;
    const [a, b] = await Promise.all([
      call(path, { method: 'POST', body: { decision: 'VALIDE' } }),
      call(path, { method: 'POST', body: { decision: 'REJETE', comment: 'conflit' } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const events = await env.DB.prepare(`SELECT count(*) AS n FROM timesheet_events WHERE action IN ('VALIDATION_CLIENT', 'REJET_CLIENT')`).first<{ n: number }>();
    expect(events?.n).toBe(1);
  });

  it('lien expiré → 410', async () => {
    const { token } = await submitAlpha();
    vi.setSystemTime(new Date('2027-01-05T10:00:00Z'));
    const res = await call(`/api/public/validations/${token}`, { method: 'POST', body: { decision: 'VALIDE' } });
    expect(res.status).toBe(410);
    expect((await json<{ expired: boolean }>(await call(`/api/public/validations/${token}`))).expired).toBe(true);
  });
});

describe('Admin (I6, I7, I8, I9)', () => {
  it('I7 : historique complet soumission → validation client → clôture → réouverture', async () => {
    const cookie = await login(CONSULTANT);
    await save(cookie, alpha(WEEK1));
    const mails = captureMails();
    await submit(cookie);
    await call(`/api/public/validations/${validationToken(mails[0].links[0])}`, { method: 'POST', body: { decision: 'VALIDE', comment: 'OK' } });
    const id = await timesheetId();
    const admin = await login(ADMIN);
    await call(`/api/admin/timesheets/${id}/close`, { method: 'POST', cookie: admin });
    await call(`/api/admin/timesheets/${id}/reopen`, { method: 'POST', cookie: admin, body: { comment: 'Erreur de saisie' } });
    const events = await json<TimesheetEvent[]>(await call(`/api/admin/timesheets/${id}/events`, { cookie: admin }));
    expect(events.map((e) => [e.action, e.fromStatus, e.toStatus])).toEqual([
      ['SOUMISSION', 'BROUILLON', 'SOUMIS'],
      ['VALIDATION_CLIENT', 'SOUMIS', null],
      ['VALIDATION', 'SOUMIS', 'VALIDE'],
      ['CLOTURE', 'VALIDE', 'CLOTURE'],
      ['REOUVERTURE', 'CLOTURE', 'BROUILLON'],
    ]);
    expect(events[1]).toMatchObject({ actorType: 'client', actor: 'marie.martin@client-alpha.example', comment: 'Projet Alpha : OK' });
    expect(events[4].comment).toBe('Erreur de saisie');
    // Après réouverture, les anciennes validations ne sont plus affichées.
    expect((await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { cookie }))).validations).toEqual([]);
  });

  it('I6 : réouverture contrôlée (404 inconnu, 409 déjà en brouillon)', async () => {
    const cookie = await login(CONSULTANT);
    await call(`/api/timesheets/${MONTH}`, { cookie });
    const admin = await login(ADMIN);
    expect((await call('/api/admin/timesheets/inconnu/reopen', { method: 'POST', cookie: admin })).status).toBe(404);
    expect((await call(`/api/admin/timesheets/${await timesheetId()}/reopen`, { method: 'POST', cookie: admin })).status).toBe(409);
  });

  it('I8 : relance du valideur (nouveau lien, ancien invalidé) et PDF admin', async () => {
    const cookie = await login(CONSULTANT);
    await save(cookie, alpha(WEEK1));
    let mails = captureMails();
    await submit(cookie);
    const oldToken = validationToken(mails[0].links[0]);
    const admin = await login(ADMIN);
    const id = await timesheetId();
    mails = captureMails();
    const res = await call(`/api/admin/timesheets/${id}/resend`, { method: 'POST', cookie: admin });
    expect(await res.json()).toEqual({ ok: true, sent: 1 });
    const newToken = validationToken(mails[0].links[0]);
    expect((await call(`/api/public/validations/${oldToken}`)).status).toBe(404);
    expect((await call(`/api/public/validations/${newToken}`)).status).toBe(200);

    const pdf = await call(`/api/admin/timesheets/${id}/pdf`, { cookie: admin });
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
  });

  it('tableau de bord : date limite et retards', async () => {
    vi.setSystemTime(new Date('2026-12-07T10:00:00Z'));
    const admin = await login(ADMIN);
    const board = await json<AdminTimesheetBoard>(await call(`/api/admin/timesheets?month=${MONTH}`, { cookie: admin }));
    expect(board.deadline).toBe('2026-12-03');
    expect(board.rows[0]).toMatchObject({ consultant: 'Jean Dupont', status: 'NON_COMMENCE', late: true });
  });

  it('I9 : utilisateurs (doublon 409, désactivation coupe les sessions, pas d’auto-rétrogradation)', async () => {
    const admin = await login(ADMIN);
    expect((await call('/api/admin/users', { method: 'POST', cookie: admin, body: { email: 'JEAN.DUPONT@example.com', name: 'Doublon' } })).status).toBe(409);
    const jd = await login(CONSULTANT);
    expect((await call('/api/admin/users/u-jd', { method: 'PATCH', cookie: admin, body: { active: false } })).status).toBe(200);
    expect((await call('/api/auth/me', { cookie: jd })).status).toBe(401);
    expect((await call('/api/admin/users/u-admin', { method: 'PATCH', cookie: admin, body: { role: 'consultant' } })).status).toBe(409);
  });

  it('I9 : mission (dates incohérentes, valideur obligatoire, client inconnu)', async () => {
    const admin = await login(ADMIN);
    const base = { consultantId: 'u-jd', clientId: 'c-beta', label: 'Z', startDate: '2026-11-10' };
    const bad = async (body: object) => json<ApiError>(await call('/api/admin/missions', { method: 'POST', cookie: admin, body }));
    expect((await bad({ ...base, endDate: '2026-11-01' })).error).toBe('La date de fin doit être postérieure à la date de début');
    expect((await bad({ ...base, clientValidation: true })).error).toMatch(/valideur/);
    expect((await bad({ ...base, clientId: 'nope' })).error).toBe('Client introuvable');
    expect((await bad({ ...base, color: 'rouge' })).details?.[0]).toMatch(/^color/);
    expect((await call('/api/admin/missions/m-beta', { method: 'PATCH', cookie: admin, body: { clientValidation: true } })).status).toBe(400);
  });

  it('C3 : missions en camelCase avec activités et surcharges', async () => {
    const admin = await login(ADMIN);
    const created = await json<{ id: string }>(
      await call('/api/admin/missions', {
        method: 'POST',
        cookie: admin,
        body: { consultantId: 'u-jd', clientId: 'c-gamma', label: 'Projet Delta', startDate: '2026-11-01', weekendPolicy: 'AUTORISE', workedHolidays: ['lundi-pentecote'], activities: ['Audit'] },
      }),
    );
    const updated = await json<Mission>(
      await call(`/api/admin/missions/${created.id}`, { method: 'PATCH', cookie: admin, body: { addActivities: ['Conseil'], tjm: 650 } }),
    );
    expect(updated).toMatchObject({ label: 'Projet Delta', client: 'Client Gamma', clientValidation: false, weekendPolicy: 'AUTORISE', workedHolidays: ['lundi-pentecote'], tjm: 650 });
    expect(updated.activities.map((a) => a.label).sort()).toEqual(['Audit', 'Conseil']);
  });

  it('paramétrage : lecture, écriture, validation', async () => {
    const admin = await login(ADMIN);
    expect(await json(await call('/api/admin/settings', { cookie: admin }))).toEqual(DEFAULT_SETTINGS);
    const res = await call('/api/admin/settings', { method: 'PUT', cookie: admin, body: { ...DEFAULT_SETTINGS, submission: { ...DEFAULT_SETTINGS.submission, opensDays: 99 } } });
    expect(res.status).toBe(400);
  });
});

describe('Exploitation', () => {
  it('I14 : purge des sessions et liens expirés', async () => {
    await login(CONSULTANT);
    vi.setSystemTime(new Date('2027-01-15T10:00:00Z'));
    expect(await purgeExpired(env)).toEqual({ sessions: 1, loginTokens: 1 });
  });

  it('documentation OpenAPI', async () => {
    const doc = await json<{ paths: Record<string, unknown> }>(await call('/api/openapi.json'));
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/api/timesheets/{month}', '/api/admin/missions/{id}', '/api/auth/login']));
  });
});
