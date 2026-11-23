import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideIcons } from '@ng-icons/core';
import { APP_ICONS } from '../../ui/icons';
import { CalendarGrid } from './calendar-grid';
import { TimesheetStore } from './timesheet.store';
import { ACTIVITIES, CONFIG, MONTH, timesheet } from './test-data';

describe('CalendarGrid', () => {
  let store: TimesheetStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [TimesheetStore, provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS)] });
    store = TestBed.inject(TimesheetStore);
    const http = TestBed.inject(HttpTestingController);
    const done = store.load(MONTH);
    http.expectOne('/api/config').flush(CONFIG);
    http.expectOne((r) => r.url === '/api/activities').flush(ACTIVITIES);
    http.expectOne(`/api/timesheets/${MONTH}`).flush(
      timesheet({ entries: [{ date: '2026-11-03', activityId: 'a-alpha-dev', quantity: 0.5 }, { date: '2026-11-03', activityId: 'abs-cp', quantity: 0.5 }] }),
    );
    await done;
  });

  async function render() {
    const f = TestBed.createComponent(CalendarGrid);
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement };
  }

  const cell = (el: HTMLElement, date: string) => el.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!;

  it('affiche 30 jours avec libellés accessibles et deux demi-journées en deux couleurs', async () => {
    const { el } = await render();
    expect(el.querySelectorAll('[data-date]')).toHaveLength(30);
    const c = cell(el, '2026-11-03');
    expect(c.getAttribute('aria-label')).toBe('mardi 3 novembre : Projet Alpha Développement, une demi-journée ; Congés payés, une demi-journée');
    expect(c.textContent).toContain('1 j');
    expect(c.style.background).toContain('linear-gradient');
    expect(cell(el, '2026-11-11').getAttribute('title')).toBe('Férié : Armistice 1918');
    // Un seul jour focusable (tabindex roving) : aujourd'hui.
    expect(el.querySelectorAll('[data-date][tabindex="0"]')).toHaveLength(1);
    expect(cell(el, '2026-11-27').getAttribute('tabindex')).toBe('0');
  });

  it('clavier : flèches + Entrée appliquent le pinceau', async () => {
    store.select('a-alpha-dev');
    const { f, el } = await render();
    cell(el, '2026-11-27').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await f.whenStable();
    await new Promise((r) => queueMicrotask(() => r(null)));
    expect(document.activeElement?.getAttribute('data-date') ?? cell(el, '2026-11-26').getAttribute('tabindex')).toBeTruthy();
    cell(el, '2026-11-26').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.byDate().get('2026-11-26')?.[0]).toMatchObject({ activityId: 'a-alpha-dev', quantity: 1 });
  });

  it('pinceau : jours refusés marqués aria-disabled', async () => {
    store.select('a-alpha-dev');
    const { el } = await render();
    expect(cell(el, '2026-11-07').getAttribute('aria-disabled')).toBe('true');
    expect(cell(el, '2026-11-09').getAttribute('aria-disabled')).toBeNull();
  });

  it('sans pinceau : clic → popover de détail avec suppression ligne par ligne', async () => {
    const { f, el } = await render();
    cell(el, '2026-11-03').click();
    await f.whenStable();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Congés payés');
    dialog.querySelector<HTMLButtonElement>('button[aria-label="Retirer Congés payés"]')!.click();
    expect(store.byDate().get('2026-11-03')?.map((e) => e.activityId)).toEqual(['a-alpha-dev']);
  });
});
