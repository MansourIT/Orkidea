import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminTimesheetBoard, AdminTimesheetDetail, TimesheetEvent } from '../../shared/types';
import { ADMIN, CONSULTANT, MONTH, WEEK1, call, captureMails, json, login, save, validationToken } from './helpers';

afterEach(() => vi.restoreAllMocks());

/** CRA de Jean : 5 j Alpha + ½ j Beta + ½ j congés le 9, soumis puis validé par le client. */
async function validatedTimesheet(): Promise<string> {
  const cookie = await login(CONSULTANT);
  await save(cookie, [
    ...WEEK1.map((date) => ({ date, activityId: 'a-alpha-dev', quantity: 1 as const })),
    { date: '2026-11-09', activityId: 'a-beta-doc', quantity: 0.5 },
    { date: '2026-11-09', activityId: 'abs-cp', quantity: 0.5 },
  ]);
  const mails = captureMails();
  await call(`/api/timesheets/${MONTH}/submit`, { method: 'POST', cookie });
  await call(`/api/public/validations/${validationToken(mails[0].links[0])}`, { method: 'POST', body: { decision: 'VALIDE' } });
  const row = await env.DB.prepare(`SELECT id FROM timesheets WHERE consultant_id = 'u-jd' AND month = ?`).bind(MONTH).first<{ id: string }>();
  return row!.id;
}

describe('Admin : CRA du mois', () => {
  it('tableau de bord : email du consultant', async () => {
    const admin = await login(ADMIN);
    const board = await json<AdminTimesheetBoard>(await call(`/api/admin/timesheets?month=${MONTH}`, { cookie: admin }));
    expect(board.rows[0]).toMatchObject({ consultant: 'Jean Dupont', consultantEmail: CONSULTANT });
  });

  it('détail : saisies, validations et activités du consultant', async () => {
    const id = await validatedTimesheet();
    const admin = await login(ADMIN);
    const d = await json<AdminTimesheetDetail>(await call(`/api/admin/timesheets/${id}/detail`, { cookie: admin }));
    expect(d.consultant).toEqual({ id: 'u-jd', name: 'Jean Dupont', email: CONSULTANT });
    expect(d.timesheet).toMatchObject({ month: MONTH, status: 'VALIDE', workingDays: 20 });
    expect(d.timesheet.entries).toHaveLength(7);
    expect(d.timesheet.validations[0]).toMatchObject({ missionLabel: 'Projet Alpha', status: 'VALIDE' });
    expect(d.activities.map((a) => a.id)).toEqual(expect.arrayContaining(['a-alpha-dev', 'a-beta-doc', 'abs-cp']));
    expect((await call('/api/admin/timesheets/inconnu/detail', { cookie: admin })).status).toBe(404);
  });

  it('export CSV : une ligne par consultant et activité, format Excel français', async () => {
    await validatedTimesheet();
    await env.DB.prepare(`INSERT INTO users (id, email, name, role) VALUES ('u-ml', 'marie.lefevre@example.com', 'Marie Lefèvre', 'consultant')`).run();
    const admin = await login(ADMIN);
    const res = await call(`/api/admin/timesheets/export?month=${MONTH}`, { cookie: admin });
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toContain('CRA-2026-11.csv');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 : accents corrects à l'ouverture dans Excel
    const lines = new TextDecoder().decode(bytes).trim().split('\r\n');
    expect(lines[0]).toBe('Mois;Consultant;Email;Statut;Soumis le;Type;Mission;Client;Activité;Jours;TJM (€ HT);Montant indicatif (€ HT);Interventions (h);dont nuit (h);dont week-end (h);dont férié (h)');
    expect(lines).toContain('2026-11;Jean Dupont;jean.dupont@example.com;Validé;27/11/2026;Travail;Projet Alpha;Client Alpha;Développement;5;550;2750;;;;');
    expect(lines).toContain('2026-11;Jean Dupont;jean.dupont@example.com;Validé;27/11/2026;Travail;Projet Beta;Client Beta;Documentation;0,5;500;250;;;;');
    expect(lines).toContain('2026-11;Jean Dupont;jean.dupont@example.com;Validé;27/11/2026;Absence;;;Congés payés;0,5;;;;;;');
    expect(lines).toContain('2026-11;Marie Lefèvre;marie.lefevre@example.com;Non commencé;;;;;;0;;;;;;');
  });

  it('clôture groupée des CRA validés, tracée dans l’historique', async () => {
    const id = await validatedTimesheet();
    const admin = await login(ADMIN);
    expect(await json(await call(`/api/admin/timesheets/close-validated?month=${MONTH}`, { method: 'POST', cookie: admin }))).toEqual({ closed: 1 });
    expect(await json(await call(`/api/admin/timesheets/close-validated?month=${MONTH}`, { method: 'POST', cookie: admin }))).toEqual({ closed: 0 });
    const events = await json<TimesheetEvent[]>(await call(`/api/admin/timesheets/${id}/events`, { cookie: admin }));
    expect(events.filter((e) => e.action === 'CLOTURE')).toEqual([expect.objectContaining({ comment: 'Clôture groupée du mois', toStatus: 'CLOTURE' })]);
  });

  it('routes réservées à l’admin', async () => {
    const cookie = await login(CONSULTANT);
    expect((await call(`/api/admin/timesheets/export?month=${MONTH}`, { cookie })).status).toBe(403);
    expect((await call(`/api/admin/timesheets/close-validated?month=${MONTH}`, { method: 'POST', cookie })).status).toBe(403);
  });
});
