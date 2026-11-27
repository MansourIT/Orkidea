import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { DEFAULT_COMPANY } from '@shared/company';
import type { Client, Mission } from '@shared/types';
import { APP_ICONS } from '../../ui/icons';
import { ContractReadiness } from './contract-readiness';
import { ClientDrawer } from './client-drawer';
import { MissionForm } from './mission-form';

const tick = () => new Promise((r) => setTimeout(r));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
const type = (el: HTMLElement, id: string, value: string) => {
  const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

const CLIENT: Client = {
  id: 'c1', name: 'Client Alpha', siret: null, address: null, postalCode: null, city: 'Paris',
  representativeName: null, representativeRole: null, contractEmail: null,
};
const MISSION: Mission = {
  id: 'm1', consultantId: 'u-jd', consultant: 'Jean Dupont', clientId: 'c1', client: 'Client Alpha', label: 'Projet Alpha', startDate: '2026-01-01', endDate: null,
  tjm: 550, clientValidation: false, validatorName: null, validatorEmail: null, active: true, weekendPolicy: null, holidayPolicy: null, workedHolidays: null, holidayRegion: null,
  purpose: null, location: null, terms: null, paymentTermsDays: null,
  activities: [{ id: 'a1', label: 'Développement', code: 'DEV', color: '#3B82F6', active: true }],
};

describe('Données des contrats', () => {
  let http: HttpTestingController;
  const close = vi.fn();

  function setup(data: Client | null = null) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS), { provide: DIALOG_DATA, useValue: data }, { provide: DialogRef, useValue: { close } }],
    });
    http = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
    http.verify();
    close.mockReset();
  });

  it('fiche client : email contrôlé, champs vides envoyés à null', async () => {
    setup(CLIENT);
    const f = TestBed.createComponent(ClientDrawer);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLInputElement>('#cl-city')!.value).toBe('Paris');
    type(el, 'cl-email', 'pas-un-email');
    button(el, 'Enregistrer').click();
    await f.whenStable();
    expect(el.textContent).toContain('Email invalide.');
    http.expectNone({ method: 'PATCH' });

    type(el, 'cl-email', 'contrats@alpha.fr');
    type(el, 'cl-rep', 'Sophie Bernard');
    button(el, 'Enregistrer').click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/admin/clients/c1' });
    expect(req.request.body).toEqual({
      name: 'Client Alpha', siret: null, address: null, postalCode: null, city: 'Paris',
      representativeName: 'Sophie Bernard', representativeRole: null, contractEmail: 'contrats@alpha.fr',
    });
    req.flush({ ...CLIENT, ...req.request.body });
    await tick();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('formulaire de mission : section contrat de prestation, délai de paiement plafonné', async () => {
    setup();
    const f = TestBed.createComponent(MissionForm);
    f.componentRef.setInput('mission', MISSION);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const form = f.componentInstance['form'];
    form.patchValue({ purpose: '  Refonte du paiement ', location: 'Paris', paymentTermsDays: 90 });
    button(el, 'Enregistrer').click();
    await f.whenStable();
    http.expectNone('/api/admin/missions/m1');
    form.patchValue({ paymentTermsDays: 45 });
    button(el, 'Enregistrer').click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/admin/missions/m1' });
    expect(req.request.body).toMatchObject({ purpose: 'Refonte du paiement', location: 'Paris', terms: null, paymentTermsDays: 45 });
    req.flush(MISSION);
  });

  it('onglet Contrats : données manquantes par société, client et mission', async () => {
    setup();
    const f = TestBed.createComponent(ContractReadiness);
    await f.whenStable();
    http.expectOne('/api/admin/company').flush(DEFAULT_COMPANY);
    http.expectOne('/api/admin/clients').flush([CLIENT]);
    http.expectOne('/api/admin/missions').flush([MISSION, { ...MISSION, id: 'm2', label: 'Ancienne', active: false }]);
    http.expectOne('/api/admin/users').flush([{ id: 'u-jd', name: 'Jean Dupont', email: 'jd@x.fr', role: 'consultant', active: true, qualification: null }]);
    await tick();
    await f.whenStable();
    const text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Orkidea : Paramètres');
    expect(text).toContain('Garantie financière');
    expect(text).toContain('Client : Client Alpha');
    expect(text).toContain('SIRET, adresse, code postal, représentant, fonction');
    expect(text).toContain('objet, lieu, délai de paiement, qualification de Jean Dupont');
    expect(text).not.toContain('Ancienne');
  });
});
