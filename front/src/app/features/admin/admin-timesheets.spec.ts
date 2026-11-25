import { Dialog } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import type { AdminTimesheetBoard, AdminTimesheetDetail, AdminTimesheetRow } from '@shared/types';
import { monthOf, todayInParis } from '@shared/dates';
import { Confirm } from '../../ui/confirm-dialog';
import { APP_ICONS } from '../../ui/icons';
import { AdminTimesheets } from './admin-timesheets';
import { ACTIVITIES, timesheet } from '../timesheet/test-data';

const tick = () => new Promise((r) => setTimeout(r));
const month = monthOf(todayInParis());
const row = (p: Partial<AdminTimesheetRow>): AdminTimesheetRow => ({
  consultantId: 'u', consultant: 'X', consultantEmail: 'x@example.com', id: null, status: 'NON_COMMENCE', submittedAt: null, validatedAt: null, workedDays: 0, absenceDays: 0, late: false, ...p,
});
const BOARD: AdminTimesheetBoard = {
  month,
  workingDays: 20,
  deadline: '2026-12-03',
  rows: [
    row({ consultantId: 'u-jd', consultant: 'Jean Dupont', consultantEmail: 'jean.dupont@example.com', id: 't1', status: 'VALIDE', submittedAt: '2026-11-27T10:00:00Z', workedDays: 19, absenceDays: 1 }),
    row({ consultantId: 'u-ml', consultant: 'Marie Lefèvre', consultantEmail: 'marie.lefevre@example.com', late: true }),
    row({ consultantId: 'u-pb', consultant: 'Paul Bernard', consultantEmail: 'paul.bernard@example.com', id: 't3', status: 'SOUMIS', workedDays: 20 }),
    row({ consultantId: 'u-ag', consultant: 'Anne Girard', consultantEmail: 'anne.girard@example.com', id: 't4', status: 'VALIDE', workedDays: 20 }),
  ],
};

describe('Admin : CRA du mois', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS)] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
    http.verify();
  });

  async function render() {
    const f = TestBed.createComponent(AdminTimesheets);
    f.detectChanges();
    http.expectOne((r) => r.url === '/api/admin/timesheets' && r.params.get('month') === month).flush(BOARD);
    await tick();
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement };
  }
  const names = (el: HTMLElement) => [...el.querySelectorAll('tbody tr td:first-child p:first-child')].map((p) => p.textContent!.trim());
  const kpi = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Filtrer par statut"] button')].find((b) => b.textContent!.includes(label))!;

  it('compteurs par statut, filtre au clic, recherche', async () => {
    const { f, el } = await render();
    expect(kpi(el, 'À saisir').textContent).toContain('1');
    expect(kpi(el, 'Validés').textContent).toContain('2');
    expect(kpi(el, 'En retard').textContent).toContain('1');
    expect(names(el)).toHaveLength(4);

    kpi(el, 'Validés').click();
    await f.whenStable();
    expect(names(el)).toEqual(['Jean Dupont', 'Anne Girard']);
    expect(kpi(el, 'Validés').getAttribute('aria-pressed')).toBe('true');

    const search = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'anne';
    search.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(names(el)).toEqual(['Anne Girard']);

    kpi(el, 'Validés').click();
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(names(el)).toHaveLength(4);
    expect(el.textContent).toContain('date limite de soumission : jeudi 03/12/2026');
    expect(el.querySelector<HTMLAnchorElement>('a[download]')!.getAttribute('href')).toBe(`/api/admin/timesheets/export?month=${month}`);
  });

  it('clôture groupée des validés après confirmation', async () => {
    const { f, el } = await render();
    vi.spyOn(TestBed.inject(Confirm), 'ask').mockResolvedValue(true);
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Clôturer les validés'))!;
    expect(button.textContent).toContain('(2)');
    button.click();
    await tick();
    http.expectOne((r) => r.method === 'POST' && r.url === '/api/admin/timesheets/close-validated' && r.params.get('month') === month).flush({ closed: 2 });
    await tick();
    http.expectOne((r) => r.url === '/api/admin/timesheets').flush(BOARD);
    await tick();
    await f.whenStable();
    expect(el.textContent).toContain('2 CRA clôturés.');
  });

  it('clic sur une ligne : panneau de détail avec calendrier, répartition et historique', async () => {
    const { f, el } = await render();
    (el.querySelector('tbody tr') as HTMLElement).click();
    await f.whenStable();
    const detail: AdminTimesheetDetail = {
      id: 't1',
      consultant: { id: 'u-jd', name: 'Jean Dupont', email: 'jean.dupont@example.com' },
      timesheet: timesheet({
        month,
        status: 'VALIDE',
        comment: 'RAS',
        entries: [
          { date: `${month}-02`, activityId: 'a-alpha-dev', quantity: 1 },
          { date: `${month}-03`, activityId: 'a-alpha-dev', quantity: 0.5 },
          { date: `${month}-03`, activityId: 'abs-cp', quantity: 0.5 },
        ],
        validations: [{ missionId: 'm-alpha', missionLabel: 'Projet Alpha', clientName: 'Client Alpha', status: 'VALIDE', comment: 'OK', decidedAt: '2026-11-28T09:00:00Z' }],
      }),
      activities: ACTIVITIES,
    };
    http.expectOne('/api/admin/timesheets/t1/detail').flush(detail);
    http.expectOne('/api/admin/timesheets/t1/events').flush([
      { action: 'SOUMISSION', actorType: 'consultant', actor: 'u-jd', fromStatus: 'BROUILLON', toStatus: 'SOUMIS', comment: null, createdAt: '2026-11-27T10:00:00Z' },
    ]);
    await tick();
    await f.whenStable();
    const drawer = document.querySelector('aside[role="dialog"]') as HTMLElement;
    expect(drawer.textContent).toContain('Jean Dupont');
    expect(drawer.textContent).toContain('1,5 j'); // travaillés
    expect(drawer.textContent).toContain('Projet Alpha · Développement');
    expect(drawer.textContent).toContain('« OK »');
    expect(drawer.textContent).toContain('RAS');
    expect(drawer.textContent).toContain('Soumission');
    expect(drawer.querySelectorAll('[role="listitem"]').length).toBeGreaterThanOrEqual(28);
    expect([...drawer.querySelectorAll('button')].some((b) => b.textContent!.includes('Clôturer'))).toBe(true);
  });
});
