import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Timesheet } from '@shared/types';
import { TimesheetStore } from './timesheet.store';
import { ACTIVITIES, CONFIG, MONTH, timesheet } from './test-data';

describe('TimesheetStore', () => {
  let store: TimesheetStore;
  let http: HttpTestingController;

  async function load(ts: Timesheet = timesheet()) {
    const done = store.load(MONTH);
    // La configuration n'est chargée qu'une fois (mise en cache dans le store).
    http.match('/api/config').forEach((r) => r.flush(CONFIG));
    http.expectOne((r) => r.url === '/api/activities' && r.params.get('month') === MONTH).flush(ACTIVITIES);
    http.expectOne(`/api/timesheets/${MONTH}`).flush(ts);
    await done;
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [TimesheetStore, provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(TimesheetStore);
    http = TestBed.inject(HttpTestingController);
    await load();
  });

  afterEach(() => http.verify());

  const day = (date: string) => store.byDate().get(date) ?? [];

  it('construit le mois : 30 jours, semaines Lun → Dim, fériés', () => {
    expect(store.days()).toHaveLength(30);
    expect(store.weeks()[0].slice(0, 6)).toEqual([null, null, null, null, null, null]); // 1er novembre 2026 = dimanche
    expect(store.weeks()[0][6]?.date).toBe('2026-11-01');
    expect(store.days()[10]).toMatchObject({ date: '2026-11-11', holiday: 'Armistice 1918', nonWorking: true });
    expect(store.days()[26].isToday).toBe(true);
    expect(store.subtitleDays()).toBe('0 j saisi / 20 j ouvrés');
  });

  it('pinceau 1 jour, bascule au second clic', () => {
    store.select('a-alpha-dev');
    expect(store.applyAt('2026-11-03')).toBe(true);
    expect(day('2026-11-03')).toEqual([{ date: '2026-11-03', activityId: 'a-alpha-dev', quantity: 1 }]);
    expect(store.dirty()).toBe(true);
    store.applyAt('2026-11-03');
    expect(day('2026-11-03')).toEqual([]);
    expect(store.dirty()).toBe(false);
  });

  it('Partiel : deux demi-journées sur un même jour, total ≤ 1', () => {
    store.setPartial('a-alpha-dev', true);
    store.setPartial('abs-cp', true);
    store.select('a-alpha-dev');
    store.applyAt('2026-11-04');
    store.select('abs-cp');
    store.applyAt('2026-11-04');
    expect(day('2026-11-04').map((e) => [e.activityId, e.quantity])).toEqual([
      ['a-alpha-dev', 0.5],
      ['abs-cp', 0.5],
    ]);
    store.select('a-beta-doc'); // 1 jour : remplace
    store.applyAt('2026-11-04');
    expect(day('2026-11-04')).toEqual([{ date: '2026-11-04', activityId: 'a-beta-doc', quantity: 1 }]);
  });

  it('glisser : applique à chaque jour survolé, ignore week-ends et fériés', () => {
    store.select('a-alpha-dev');
    store.beginStroke('2026-11-05');
    for (const d of ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-06']) store.continueStroke(d);
    store.endStroke();
    expect([...store.byDate().keys()]).toEqual(['2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-12']);
    expect(store.totalDays()).toBe(5);
  });

  it('glisser depuis un jour déjà saisi : le trait retire', () => {
    store.select('a-alpha-dev');
    store.beginStroke('2026-11-02');
    store.continueStroke('2026-11-03');
    store.continueStroke('2026-11-04');
    store.endStroke();
    store.beginStroke('2026-11-02');
    store.continueStroke('2026-11-03');
    store.endStroke();
    expect([...store.byDate().keys()]).toEqual(['2026-11-04']);
  });

  it('jour non saisissable : refus annoncé ; mission autorisant le week-end : accepté', () => {
    store.select('a-alpha-dev');
    expect(store.applyAt('2026-11-07')).toBe(false);
    expect(store.notice()?.text).toBe('Le 07/11/2026 est un week-end : saisie non autorisée pour Projet Alpha · Développement');
    store.select('a-beta-doc');
    expect(store.applyAt('2026-11-07')).toBe(true);
    store.select('abs-cp');
    expect(store.applyAt('2026-11-11')).toBe(false);
  });

  it('gomme et suppression ligne par ligne', () => {
    store.setPartial('a-alpha-dev', true);
    store.select('a-alpha-dev');
    store.applyAt('2026-11-16');
    store.select('a-beta-doc');
    store.setPartial('a-beta-doc', true);
    store.applyAt('2026-11-16');
    store.removeEntry('2026-11-16', 'a-alpha-dev');
    expect(day('2026-11-16').map((e) => e.activityId)).toEqual(['a-beta-doc']);
    store.select('gomme');
    store.applyAt('2026-11-16');
    expect(day('2026-11-16')).toEqual([]);
  });

  it('enregistre le brouillon (PUT) puis n’a plus de modifications en attente', async () => {
    store.select('a-alpha-dev');
    store.applyAt('2026-11-02');
    store.setComment('RAS');
    const saving = store.save();
    const req = http.expectOne({ method: 'PUT', url: `/api/timesheets/${MONTH}` });
    expect(req.request.body).toEqual({ entries: [{ date: '2026-11-02', activityId: 'a-alpha-dev', quantity: 1 }], comment: 'RAS' });
    req.flush(timesheet({ entries: req.request.body.entries, comment: 'RAS' }));
    expect(await saving).toBe(true);
    expect(store.dirty()).toBe(false);
  });

  it('erreurs 422 du serveur affichées', async () => {
    store.select('a-alpha-dev');
    store.applyAt('2026-11-02');
    const saving = store.save();
    http.expectOne(`/api/timesheets/${MONTH}`).flush({ error: 'Saisie invalide', details: ['Le 02/11/2026 …'] }, { status: 422, statusText: 'Unprocessable' });
    expect(await saving).toBe(false);
    expect(store.serverErrors()).toEqual({ message: 'Saisie invalide', details: ['Le 02/11/2026 …'] });
    expect(store.dirty()).toBe(true);
  });

  it('soumission : enregistre d’abord si nécessaire', async () => {
    store.select('a-alpha-dev');
    store.applyAt('2026-11-02');
    const submitting = store.submit();
    const put = http.expectOne({ method: 'PUT', url: `/api/timesheets/${MONTH}` });
    put.flush(timesheet({ entries: put.request.body.entries }));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r));
    http.expectOne({ method: 'POST', url: `/api/timesheets/${MONTH}/submit` }).flush(timesheet({ status: 'SOUMIS', entries: put.request.body.entries }));
    expect(await submitting).toBe(true);
    expect(store.status()).toBe('SOUMIS');
    expect(store.editable()).toBe(false);
  });

  it('lecture seule hors BROUILLON / REJETE', async () => {
    await load(timesheet({ status: 'VALIDE' }));
    store.select('a-alpha-dev');
    expect(store.selectedId()).toBeNull();
    expect(store.applyAt('2026-11-02')).toBe(false);
  });

  it('jours manquants et libellés accessibles', async () => {
    const workdays = store.days().filter((d) => !d.nonWorking && ![12, 13, 16].includes(d.day));
    await load(timesheet({ entries: workdays.map((d) => ({ date: d.date, activityId: 'a-alpha-dev', quantity: 1 })) }));
    expect(store.missingSummary()).toBe('3 jours ouvrés non renseignés : 12, 13, 16 novembre.');
    expect(store.dayLabel(store.days()[2])).toBe('mardi 3 novembre : Projet Alpha Développement, 1 jour');
    expect(store.dayLabel(store.days()[10])).toBe('mercredi 11 novembre : férié (Armistice 1918)');
    expect(store.subtitleDays()).toBe('17 j saisis / 20 j ouvrés');
  });
});
