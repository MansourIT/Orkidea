import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Timesheet } from '@shared/types';
import { TableView } from './table-view';
import { TimesheetStore } from './timesheet.store';
import { ACTIVITIES, CONFIG, MONTH, timesheet } from './test-data';

describe('TableView', () => {
  let store: TimesheetStore;

  async function setup(ts: Timesheet = timesheet()) {
    TestBed.configureTestingModule({ providers: [TimesheetStore, provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(TimesheetStore);
    const http = TestBed.inject(HttpTestingController);
    const done = store.load(MONTH);
    http.expectOne('/api/config').flush(CONFIG);
    http.expectOne((r) => r.url === '/api/activities').flush(ACTIVITIES);
    http.expectOne(`/api/timesheets/${MONTH}`).flush(ts);
    await done;
    const f = TestBed.createComponent(TableView);
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement };
  }

  /** Cellule (ligne d'activité, jour du mois). */
  const cell = (el: HTMLElement, row: number, day: number) => el.querySelector<HTMLButtonElement>(`[data-cell="${row}:${day - 1}"]`)!;

  it('lignes = activités, colonnes = jours avec initiale, totaux', async () => {
    const { el } = await setup(timesheet({ entries: [{ date: '2026-11-02', activityId: 'a-alpha-dev', quantity: 1 }, { date: '2026-11-03', activityId: 'a-alpha-dev', quantity: 0.5 }] }));
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
    const headers = [...el.querySelectorAll('thead th')].map((th) => th.textContent?.replace(/\s+/g, ''));
    expect(headers[1]).toBe('1D'); // dimanche 1er
    expect(headers[2]).toBe('2L');
    expect(cell(el, 0, 2).textContent?.trim()).toBe('1');
    expect(cell(el, 0, 3).textContent?.trim()).toBe('½');
    expect(el.querySelector('tbody tr td:last-child')?.textContent?.trim()).toBe('1,5 j');
    expect(el.querySelector('tfoot td:last-child')?.textContent?.trim()).toBe('1,5 j');
  });

  it('clic : vide → ½ → 1 → vide, partagé avec le calendrier', async () => {
    const { f, el } = await setup();
    const c = cell(el, 0, 4);
    for (const expected of [0.5, 1, 0]) {
      c.click();
      await f.whenStable();
      expect(store.quantityAt('2026-11-04', 'a-alpha-dev')).toBe(expected);
    }
    cell(el, 0, 4).click();
    expect(store.byDate().get('2026-11-04')).toEqual([{ date: '2026-11-04', activityId: 'a-alpha-dev', quantity: 0.5 }]);
    expect(store.dirty()).toBe(true);
  });

  it('clavier : 1, 5, 0 et flèches', async () => {
    const { f, el } = await setup();
    const key = (target: HTMLElement, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key(cell(el, 1, 5), '1');
    key(cell(el, 2, 5), '5');
    await f.whenStable();
    expect(store.quantityAt('2026-11-05', 'a-beta-doc')).toBe(1);
    expect(store.quantityAt('2026-11-05', 'abs-cp')).toBe(0.5);
    key(cell(el, 1, 5), '0');
    expect(store.quantityAt('2026-11-05', 'a-beta-doc')).toBe(0);
    key(cell(el, 0, 5), 'ArrowRight');
    await f.whenStable();
    expect(cell(el, 0, 6).getAttribute('tabindex')).toBe('0');
  });

  it('total du jour en rouge au-delà de 1 jour, avec alerte', async () => {
    const { f, el } = await setup(timesheet({ entries: [{ date: '2026-11-06', activityId: 'a-alpha-dev', quantity: 1 }] }));
    cell(el, 1, 6).click(); // + ½ Beta → 1,5
    await f.whenStable();
    const foot = el.querySelectorAll('tfoot td')[5];
    expect(foot.className).toContain('text-red-600');
    expect(store.overLimitDays()).toEqual(['2026-11-06']);
    expect(el.textContent).toContain('Plus d’une journée saisie le 6');
  });

  it('jours refusés non modifiables (week-end pour Alpha, autorisé pour Beta)', async () => {
    const { f, el } = await setup();
    expect(cell(el, 0, 7).getAttribute('aria-disabled')).toBe('true');
    cell(el, 0, 7).click();
    await f.whenStable();
    expect(store.quantityAt('2026-11-07', 'a-alpha-dev')).toBe(0);
    expect(store.notice()?.tone).toBe('erreur');
    expect(cell(el, 1, 7).getAttribute('aria-disabled')).toBeNull();
    cell(el, 1, 7).click();
    expect(store.quantityAt('2026-11-07', 'a-beta-doc')).toBe(0.5);
  });

  it('lecture seule hors brouillon', async () => {
    const { el } = await setup(timesheet({ status: 'CLOTURE' }));
    cell(el, 0, 2).click();
    expect(store.entries()).toEqual([]);
    expect(el.querySelector('table')?.getAttribute('aria-readonly')).toBe('true');
  });
});
