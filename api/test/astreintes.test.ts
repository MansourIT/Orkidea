import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiError, PublicValidationView, Timesheet } from '../../shared/types';
import { ADMIN, CONSULTANT, MONTH, call, captureMails, json, login, validationToken } from './helpers';

afterEach(() => vi.restoreAllMocks());

const put = (cookie: string, body: unknown) => call(`/api/timesheets/${MONTH}`, { method: 'PUT', cookie, body });

/** Astreinte ouverte sur la mission Alpha (validation client exigée). */
async function enableAlphaOnCall(): Promise<void> {
  const admin = await login(ADMIN);
  expect((await call('/api/admin/missions/m-alpha', { method: 'PATCH', cookie: admin, body: { onCall: true } })).status).toBe(200);
}

describe('Astreintes', () => {
  it('missions ouvertes à l’astreinte exposées dans le CRA ; refus sur une mission non ouverte', async () => {
    const cookie = await login(CONSULTANT);
    let ts = await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { cookie }));
    expect(ts.onCallMissions).toEqual([]);
    const refused = await put(cookie, { entries: [], onCall: [{ date: '2026-11-07', missionId: 'm-alpha' }], interventions: [] });
    expect(refused.status).toBe(422);
    expect((await json<ApiError>(refused)).details).toContain('Astreinte non prévue pour cette mission le 2026-11-07');

    await enableAlphaOnCall();
    ts = await json<Timesheet>(await call(`/api/timesheets/${MONTH}`, { cookie }));
    expect(ts.onCallMissions).toMatchObject([{ id: 'm-alpha', label: 'Projet Alpha', startDate: '2026-01-01' }]);
  });

  it('saisie : astreinte le week-end malgré les règles de la mission, interventions de nuit, conservées sans les renvoyer', async () => {
    await enableAlphaOnCall();
    const cookie = await login(CONSULTANT);
    const body = {
      entries: [{ date: '2026-11-06', activityId: 'a-alpha-dev', quantity: 1 }],
      onCall: [
        { date: '2026-11-07', missionId: 'm-alpha' },
        { date: '2026-11-08', missionId: 'm-alpha' },
      ],
      interventions: [
        { date: '2026-11-07', missionId: 'm-alpha', start: '22:30', end: '01:15', reason: 'INC-42 base indisponible' },
        { date: '2026-11-08', missionId: 'm-alpha', start: '10:00', end: '11:00', reason: null },
      ],
    };
    const res = await put(cookie, body);
    expect(res.status).toBe(200);
    const ts = await json<Timesheet>(res);
    expect(ts.onCall).toEqual(body.onCall);
    expect(ts.interventions).toEqual(body.interventions);

    // Un enregistrement sans les champs d'astreinte (ancien client) ne les efface pas.
    const again = await json<Timesheet>(await put(cookie, { entries: body.entries }));
    expect(again.interventions).toHaveLength(2);

    // Intervention sans astreinte ce jour-là, chevauchement : refusés.
    const bad = await put(cookie, {
      ...body,
      interventions: [...body.interventions, { date: '2026-11-08', missionId: 'm-alpha', start: '00:30', end: '02:00', reason: null }, { date: '2026-11-09', missionId: 'm-alpha', start: '09:00', end: '10:00', reason: null }],
    });
    expect(bad.status).toBe(422);
    expect((await json<ApiError>(bad)).details).toEqual(['Intervention du 2026-11-09 sans astreinte ce jour-là sur la mission', 'Interventions qui se chevauchent le 2026-11-08']);
  });

  it('soumission : validation client demandée même sans jour travaillé ; le valideur voit astreintes et interventions', async () => {
    await enableAlphaOnCall();
    const cookie = await login(CONSULTANT);
    await put(cookie, {
      entries: [],
      onCall: [{ date: '2026-11-07', missionId: 'm-alpha' }],
      interventions: [{ date: '2026-11-07', missionId: 'm-alpha', start: '22:30', end: '01:15', reason: 'INC-42' }],
    });
    const mails = captureMails();
    const res = await call(`/api/timesheets/${MONTH}/submit`, { method: 'POST', cookie });
    expect(res.status).toBe(200);
    expect((await json<Timesheet>(res)).status).toBe('SOUMIS');
    const link = mails.find((m) => m.to === 'marie.martin@client-alpha.example')!.links[0];
    const view = await json<PublicValidationView>(await call(`/api/public/validations/${encodeURIComponent(validationToken(link))}`));
    expect(view).toMatchObject({ onCallDays: ['2026-11-07'], interventions: [{ date: '2026-11-07', start: '22:30', end: '01:15', minutes: 165, reason: 'INC-42' }] });
  });

  it('PDF et export CSV : section et ligne d’astreinte avec heures de nuit, week-end, férié', async () => {
    await enableAlphaOnCall();
    const cookie = await login(CONSULTANT);
    await put(cookie, {
      entries: [],
      onCall: [
        { date: '2026-11-07', missionId: 'm-alpha' },
        { date: '2026-11-11', missionId: 'm-alpha' },
      ],
      interventions: [
        { date: '2026-11-07', missionId: 'm-alpha', start: '23:00', end: '01:00', reason: null },
        { date: '2026-11-11', missionId: 'm-alpha', start: '10:00', end: '11:30', reason: null },
      ],
    });
    const pdf = await call(`/api/timesheets/${MONTH}/pdf`, { cookie });
    expect(pdf.headers.get('content-type')).toBe('application/pdf');

    const admin = await login(ADMIN);
    const csv = await (await call(`/api/admin/timesheets/export?month=${MONTH}`, { cookie: admin })).text();
    const line = csv.split('\r\n').find((l) => l.includes(';Astreinte;'));
    expect(line).toBeDefined();
    // Jours = 2 ; interventions 3,5 h dont nuit 2 h, week-end 2 h (samedi), férié 1,5 h (11 novembre).
    expect(line!.split(';').slice(-7)).toEqual(['2', '', '', '3,5', '2', '2', '1,5']);
    expect(csv.split('\r\n')[0]).toContain('Interventions (h)');
  });
});
