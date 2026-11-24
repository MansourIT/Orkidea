import { Dialog } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import type { Mission } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { APP_ICONS } from '../../ui/icons';
import { AdminPage } from './admin-page';
import { MissionForm } from './mission-form';

const tick = () => new Promise((r) => setTimeout(r));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

describe('Administration', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS)] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
    http.verify();
  });

  it('formulaire de mission : valideur obligatoire si validation client, surcharges envoyées', async () => {
    const f = TestBed.createComponent(MissionForm);
    f.componentRef.setInput('consultants', [{ id: 'u-jd', name: 'Jean Dupont', email: 'jd@x.fr', role: 'consultant', active: true }]);
    f.componentRef.setInput('clients', [{ id: 'c1', name: 'Client Alpha', siret: null }]);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const form = f.componentInstance['form'];
    form.patchValue({ consultantId: 'u-jd', clientId: 'c1', label: 'Projet Delta', startDate: '2026-12-01', clientValidation: true, weekendPolicy: 'AUTORISE' });
    await f.whenStable();
    button(el, 'Créer la mission').click();
    await f.whenStable();
    expect(el.textContent).toContain('Nom du valideur obligatoire');
    expect(el.textContent).toContain('Email du valideur obligatoire');
    http.expectNone('/api/admin/missions');

    form.patchValue({ validatorName: 'Marie Martin', validatorEmail: 'marie@client.fr' });
    f.componentInstance.addNew('Audit');
    f.componentInstance.addNew('Audit');
    button(el, 'Créer la mission').click();
    const req = http.expectOne({ method: 'POST', url: '/api/admin/missions' });
    expect(req.request.body).toMatchObject({
      consultantId: 'u-jd',
      clientId: 'c1',
      label: 'Projet Delta',
      clientValidation: true,
      validatorEmail: 'marie@client.fr',
      weekendPolicy: 'AUTORISE',
      holidayPolicy: null,
      workedHolidays: null,
      activities: ['Audit'],
    });
    req.flush({ id: 'm1' });
  });

  it('formulaire de mission (modification) : dates incohérentes refusées', async () => {
    const m: Mission = {
      id: 'm1', consultantId: 'u-jd', consultant: 'Jean Dupont', clientId: 'c1', client: 'Client Alpha', label: 'Projet Alpha', startDate: '2026-01-01', endDate: null,
      tjm: 550, clientValidation: false, validatorName: null, validatorEmail: null, active: true, weekendPolicy: null, holidayPolicy: null, workedHolidays: ['lundi-pentecote'], holidayRegion: null,
      activities: [{ id: 'a1', label: 'Développement', color: '#3B82F6', active: true }],
    };
    const f = TestBed.createComponent(MissionForm);
    f.componentRef.setInput('mission', m);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect((el.querySelector('#m-label') as HTMLInputElement).value).toBe('Projet Alpha');
    expect(el.textContent).toContain('Lundi de Pentecôte');
    f.componentInstance['form'].patchValue({ endDate: '2025-12-01' });
    button(el, 'Enregistrer').click();
    await f.whenStable();
    expect(el.textContent).toContain('La date de fin doit être postérieure');
    http.expectNone('/api/admin/missions/m1');
  });

  it('onglets : ?onglet=parametres affiche les paramètres', async () => {
    const f = TestBed.createComponent(AdminPage);
    f.componentRef.setInput('onglet', 'parametres');
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('[aria-selected="true"]')?.textContent).toContain('Paramètres');
    http.expectOne('/api/admin/settings').flush(DEFAULT_SETTINGS);
  });
});
