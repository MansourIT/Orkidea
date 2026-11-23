import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { addMonths, monthOf, todayInParis } from '@shared/dates';
import type { TimesheetSummary } from '@shared/types';
import { AuthStore } from '../../core/auth.store';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { APP_ICONS } from '../../ui/icons';
import { DashboardPage } from './dashboard-page';

const tick = () => new Promise((r) => setTimeout(r));

describe('DashboardPage', () => {
  it('liste les 12 derniers mois, met en avant le mois en cours et les CRA à reprendre', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS)] });
    TestBed.inject(AuthStore).set({ id: 'u-jd', email: 'jean.dupont@example.com', name: 'Jean Dupont', role: 'consultant' });
    const cur = monthOf(todayInParis());
    const list: TimesheetSummary[] = Array.from({ length: 12 }, (_, i) => ({
      month: addMonths(cur, -i),
      status: i === 0 ? 'BROUILLON' : i === 1 ? 'REJETE' : i === 2 || i === 6 ? 'NON_COMMENCE' : 'CLOTURE',
      workedDays: i === 0 ? 12.5 : 20,
      absenceDays: i === 0 ? 1 : 0,
      workingDays: 20,
      submittedAt: i > 2 ? '2026-01-02T10:00:00Z' : null,
    }));
    const f = TestBed.createComponent(DashboardPage);
    f.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/timesheets').flush(list);
    http.expectOne('/api/config').flush({ settings: DEFAULT_SETTINGS, today: `${cur}-15` });
    await tick();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Bonjour Jean');
    const cards = el.querySelectorAll('ul li a');
    expect(cards).toHaveLength(12);
    expect(cards[0].textContent).toContain('Mois en cours');
    expect(cards[0].textContent).toContain('12,5 j');
    expect(cards[0].getAttribute('href')).toBe(`/saisie/${cur}`);
    expect(el.querySelector('.alert-warning')?.textContent).toContain('(rejeté)');
    const alert = el.querySelector('.alert-warning')?.textContent ?? '';
    expect(alert.match(/\d{4}/g)).toHaveLength(2); // M-1 (rejeté) et M-2 ; M-6 est trop ancien pour être modifié
  });
});
