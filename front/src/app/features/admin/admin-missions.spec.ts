import { Dialog } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import type { Mission } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { todayInParis } from '@shared/dates';
import { APP_ICONS } from '../../ui/icons';
import { AdminMissions, daysToEnd } from './admin-missions';
import { MissionForm } from './mission-form';

const tick = () => new Promise((r) => setTimeout(r));
const today = todayInParis();
const inDays = (n: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

const mission = (p: Partial<Mission>): Mission => ({
  id: 'm', consultantId: 'u-jd', consultant: 'Jean Dupont', clientId: 'c1', client: 'Client Alpha', label: 'Mission', startDate: '2026-01-01', endDate: null,
  tjm: 500, clientValidation: false, validatorName: null, validatorEmail: null, active: true, weekendPolicy: null, holidayPolicy: null, workedHolidays: null, holidayRegion: null,
  activities: [{ id: 'a', label: 'Développement', color: '#3B82F6', active: true }], ...p,
});

const MISSIONS: Mission[] = [
  mission({ id: 'm1', label: 'Projet Alpha', clientValidation: true, validatorName: 'Marie Martin', validatorEmail: 'marie@alpha.fr', endDate: inDays(5) }),
  mission({ id: 'm2', label: 'Projet Beta', consultantId: 'u-pb', consultant: 'Paul Bernard', clientId: 'c2', client: 'Client Beta', weekendPolicy: 'AUTORISE', endDate: inDays(-3) }),
  mission({ id: 'm3', label: 'Projet Gamma', clientId: 'c2', client: 'Client Beta' }),
  mission({ id: 'm4', label: 'Projet Ancien', active: false }),
];

describe('Admin : missions', () => {
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
    const f = TestBed.createComponent(AdminMissions);
    f.detectChanges();
    http.expectOne('/api/admin/missions').flush(MISSIONS);
    http.expectOne('/api/admin/users').flush([
      { id: 'u-jd', name: 'Jean Dupont', email: 'jd@x.fr', role: 'consultant', active: true },
      { id: 'u-pb', name: 'Paul Bernard', email: 'pb@x.fr', role: 'consultant', active: true },
    ]);
    http.expectOne('/api/admin/clients').flush([{ id: 'c1', name: 'Client Alpha', siret: null }, { id: 'c2', name: 'Client Beta', siret: null }]);
    http.expectOne('/api/admin/settings').flush(DEFAULT_SETTINGS);
    await tick();
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement };
  }
  const labels = (el: HTMLElement) => [...el.querySelectorAll('tbody tr td:first-child p:first-child')].map((p) => p.textContent!.trim());

  it('jours avant la fin de mission', () => {
    expect(daysToEnd(mission({ endDate: inDays(5) }), today)).toBe(5);
    expect(daysToEnd(mission({ endDate: inDays(-3) }), today)).toBe(-3);
    expect(daysToEnd(mission({}), today)).toBeNull();
  });

  it('compteurs, missions actives par défaut, badges de fin et règles propres', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('3Missions actives');
    expect(el.textContent).toContain('1Avec validation client');
    expect(el.textContent).toContain('2Fin sous 30 jours');
    expect(labels(el)).toEqual(['Projet Alpha', 'Projet Beta', 'Projet Gamma']);
    expect(el.textContent).toContain('Se termine dans 5 j');
    expect(el.textContent).toContain('Terminée – à désactiver ?');
    expect(el.textContent).toContain('week-ends autorisés');
    expect(el.textContent).toContain('Marie Martin');
  });

  it('filtres : recherche, client, consultant, désactivées, compteur « fin »', async () => {
    const { f, el } = await render();
    const search = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'gamma';
    search.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(labels(el)).toEqual(['Projet Gamma']);
    search.value = '';
    search.dispatchEvent(new Event('input'));

    const client = el.querySelector<HTMLSelectElement>('select[aria-label="Filtrer par client"]')!;
    client.value = 'c2';
    client.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(labels(el)).toEqual(['Projet Beta', 'Projet Gamma']);
    client.value = '';
    client.dispatchEvent(new Event('change'));

    [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Fin sous 30 jours'))!.click();
    await f.whenStable();
    expect(labels(el)).toEqual(['Projet Alpha', 'Projet Beta']);
    [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Fin sous 30 jours'))!.click();

    [...el.querySelectorAll('label')].find((l) => l.textContent!.includes('Désactivées'))!.querySelector('input')!.click();
    await f.whenStable();
    expect(labels(el)).toEqual(['Projet Ancien']);
  });

  it('clic sur une mission : panneau latéral avec le formulaire en sections', async () => {
    const { f, el } = await render();
    (el.querySelector('tbody tr') as HTMLElement).click();
    await f.whenStable();
    const drawer = document.querySelector('aside[role="dialog"]') as HTMLElement;
    expect(drawer.querySelector('h2')!.textContent).toContain('Projet Alpha');
    for (const s of ['Contrat', 'Validation client', 'Activités', 'Jours non ouvrés']) expect(drawer.textContent).toContain(s);
    expect(drawer.textContent).toContain('Résultat pour cette mission : week-ends interdits, jours fériés interdits, calendrier Métropole.');
  });

  it('formulaire : couleur de la palette et règles effectives envoyées', async () => {
    const f = TestBed.createComponent(MissionForm);
    f.componentRef.setInput('consultants', [{ id: 'u-jd', name: 'Jean Dupont', email: 'jd@x.fr', role: 'consultant', active: true }]);
    f.componentRef.setInput('clients', [{ id: 'c1', name: 'Client Alpha', siret: null }]);
    f.componentRef.setInput('settings', DEFAULT_SETTINGS);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    f.componentInstance['form'].patchValue({ consultantId: 'u-jd', clientId: 'c1', label: 'Projet Delta', startDate: '2026-12-01' });
    el.querySelector<HTMLButtonElement>('button[aria-label="Couleur #22C55E"]')!.click();
    [...el.querySelectorAll('label')].find((l) => l.textContent!.trim() === 'Autorisés')!.querySelector('input')!.click();
    await f.whenStable();
    expect(el.textContent).toContain('Résultat pour cette mission : week-ends saisissables');
    [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Créer la mission'))!.click();
    const req = http.expectOne({ method: 'POST', url: '/api/admin/missions' });
    expect(req.request.body).toMatchObject({ label: 'Projet Delta', color: '#22C55E', weekendPolicy: 'AUTORISE', holidayPolicy: null });
    req.flush({ id: 'm9' });
  });
});
