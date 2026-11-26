import { Dialog } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { DEFAULT_COMPANY } from '@shared/company';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings';
import { Confirm } from '../../ui/confirm-dialog';
import { APP_ICONS } from '../../ui/icons';
import { AdminPage } from './admin-page';
import { AdminSettings } from './admin-settings';
import { SettingsPreview } from './settings-preview';

const tick = () => new Promise((r) => setTimeout(r));
const byText = (el: HTMLElement, sel: string, text: string) => [...el.querySelectorAll<HTMLElement>(sel)].find((b) => b.textContent?.includes(text))!;

describe('Paramètres', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS)] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
    http.verify();
  });

  async function render(settings: AppSettings = DEFAULT_SETTINGS) {
    const f = TestBed.createComponent(AdminSettings);
    f.detectChanges();
    http.expectOne('/api/admin/settings').flush(settings);
    await tick();
    await f.whenStable();
    http.expectOne('/api/admin/company').flush(DEFAULT_COMPANY);
    await tick();
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('aperçu : ouverture, date limite et mois modifiables calculés comme côté API', async () => {
    const f = TestBed.createComponent(SettingsPreview);
    f.componentRef.setInput('settings', DEFAULT_SETTINGS);
    f.componentRef.setInput('today', '2026-11-24');
    await f.whenStable();
    const text = (f.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Aperçu : Novembre 2026');
    expect(text).toContain('à partir du jeudi 26 novembre');
    expect(text).toContain('jeudi 3 décembre (3ᵉ jour ouvré du mois suivant)');
    expect(text).toContain('de août 2026 à novembre 2026');
    // Toussaint (dimanche 1er) et 11 novembre : non saisissables ; 26 → 30 : soumission ouverte.
    const cells = [...(f.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[title]')];
    expect(cells.find((c) => c.textContent?.trim() === '11')!.title).toContain('Armistice 1918 · non saisissable');
    expect(cells.find((c) => c.textContent?.trim() === '26')!.title).toBe('soumission ouverte');

    f.componentRef.setInput('settings', { ...DEFAULT_SETTINGS, submission: { ...DEFAULT_SETTINGS.submission, opening: 'TOUJOURS', completeness: 'BLOQUER' } });
    await f.whenStable();
    const after = (f.nativeElement as HTMLElement).textContent!;
    expect(after).toContain('dès le 1er du mois');
    expect(after).toContain('la soumission est bloquée');
  });

  it('jours fériés de l’année avec leur date ; Alsace-Moselle ajoute deux jours', async () => {
    const { f, el } = await render();
    f.componentInstance['year'].set(2026);
    await f.whenStable();
    const rows = () => [...el.querySelectorAll('li:has([role="switch"])')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows()).toHaveLength(11);
    expect(rows().find((r) => r.includes('Lundi de Pentecôte'))).toContain('lun. 25/05');
    expect(rows().find((r) => r.includes('Toussaint'))).toContain('week-end');
    byText(el, 'label', 'Alsace-Moselle').querySelector('input')!.click();
    await f.whenStable();
    expect(rows()).toHaveLength(13);
    expect(rows().some((r) => r.includes('Vendredi saint') && r.includes('ven. 03/04'))).toBe(true);
  });

  it('barre d’enregistrement : apparaît au changement, Annuler revient à l’état enregistré', async () => {
    const { f, el } = await render();
    expect(el.textContent).not.toContain('Modifications non enregistrées');
    el.querySelector<HTMLButtonElement>('button[aria-label="Travaillé : Lundi de Pentecôte"]')!.click();
    await f.whenStable();
    expect(el.textContent).toContain('Modifications non enregistrées');
    expect(el.textContent).toContain('fériés interdits sauf 1 travaillé');
    byText(el, 'button', 'Annuler').click();
    await f.whenStable();
    expect(el.textContent).not.toContain('Modifications non enregistrées');
    expect(el.querySelector('button[aria-label="Travaillé : Lundi de Pentecôte"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('enregistrement des choix (cartes, segments, compteurs, interrupteur)', async () => {
    const { f, el } = await render();
    byText(el, 'label', 'Dès le 1er du mois').querySelector('input')!.click();
    byText(el, 'label', 'Bloquer').querySelector('input')!.click();
    el.querySelector<HTMLButtonElement>('button[aria-label="Augmenter : Mois passés modifiables"]')!.click();
    el.querySelector<HTMLButtonElement>('button[aria-label="Autoriser la soumission des mois futurs"]')!.click();
    el.querySelector<HTMLButtonElement>('button[aria-label="Travaillé : Lundi de Pentecôte"]')!.click();
    await f.whenStable();
    byText(el, 'button', 'Enregistrer').click();
    const req = http.expectOne({ method: 'PUT', url: '/api/admin/settings' });
    expect(req.request.body).toEqual({
      calendar: { ...DEFAULT_SETTINGS.calendar, workedHolidays: ['lundi-pentecote'] },
      submission: { ...DEFAULT_SETTINGS.submission, opening: 'TOUJOURS', completeness: 'BLOQUER', pastMonthsLimit: 4, futureMonths: true },
    });
    req.flush(req.request.body);
    await tick();
    await f.whenStable();
    expect(el.textContent).toContain('Enregistré à');
    expect(el.textContent).not.toContain('Modifications non enregistrées');
  });

  it('valeurs par défaut : appliquées au brouillon après confirmation, sans enregistrer', async () => {
    const custom: AppSettings = { ...DEFAULT_SETTINGS, calendar: { ...DEFAULT_SETTINGS.calendar, weekendPolicy: 'AUTORISE' } };
    const { f, el } = await render(custom);
    vi.spyOn(TestBed.inject(Confirm), 'ask').mockResolvedValue(true);
    byText(el, 'button', 'Valeurs par défaut').click();
    await tick();
    await f.whenStable();
    expect(el.textContent).toContain('Samedis et dimanches grisés');
    expect(el.textContent).toContain('Modifications non enregistrées');
    http.expectNone({ method: 'PUT' });
  });

  it('changer d’onglet avec des paramètres non enregistrés : confirmation', async () => {
    const f = TestBed.createComponent(AdminPage);
    f.componentRef.setInput('onglet', 'parametres');
    await f.whenStable();
    http.expectOne('/api/admin/settings').flush(DEFAULT_SETTINGS);
    await tick();
    await f.whenStable();
    http.expectOne('/api/admin/company').flush(DEFAULT_COMPANY);
    await tick();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('button[aria-label="Autoriser la soumission des mois futurs"]')!.click();
    await f.whenStable();
    const ask = vi.spyOn(TestBed.inject(Confirm), 'ask').mockResolvedValue(false);
    await f.componentInstance.select('missions');
    expect(ask).toHaveBeenCalled();
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toContain('Paramètres');
  });

  it('fiche société : contrôle du SIRET, exemple de numéro, enregistrement séparé', async () => {
    const { f, el } = await render();
    expect(el.textContent).toContain('CS-');
    const type = async (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`#co-${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await f.whenStable();
    };
    await type('siret', '123');
    expect(el.textContent).toContain('14 chiffres, sans espace');
    const save = () => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Enregistrer la fiche société'))!;
    expect(save().disabled).toBe(true);
    await type('siret', '98765432100019');
    await type('contractNumberPrefix', 'orc');
    expect(el.textContent).toContain('ORC-');
    expect(f.componentInstance.hasUnsavedChanges()).toBe(true);
    save().click();
    const req = http.expectOne({ method: 'PUT', url: '/api/admin/company' });
    expect(req.request.body).toMatchObject({ siret: '98765432100019', contractNumberPrefix: 'ORC', legalName: 'Orkidea' });
    req.flush(req.request.body);
    await tick();
    await f.whenStable();
    expect(f.componentInstance.hasUnsavedChanges()).toBe(false);
    http.expectNone({ method: 'PUT', url: '/api/admin/settings' });
  });
});
