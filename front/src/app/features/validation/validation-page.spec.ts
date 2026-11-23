import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideIcons } from '@ng-icons/core';
import type { PublicValidationView } from '@shared/types';
import { APP_ICONS } from '../../ui/icons';
import { ValidationPage } from './validation-page';

const TOKEN = 'jeton-valideur-0123456789';
const URL = `/api/public/validations/${TOKEN}`;
const VIEW: PublicValidationView = {
  consultant: 'Jean Dupont',
  month: '2026-11',
  mission: 'Projet Alpha',
  client: 'Client Alpha',
  status: 'EN_ATTENTE',
  expired: false,
  comment: null,
  totalDays: 1.5,
  entries: [
    { date: '2026-11-02', activity: 'Développement', quantity: 1 },
    { date: '2026-11-03', activity: 'Réunion', quantity: 0.5 },
  ],
};

const tick = () => new Promise((r) => setTimeout(r));

describe('ValidationPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS)] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(response: { body: object; status?: number }) {
    const f = TestBed.createComponent(ValidationPage);
    f.componentRef.setInput('token', TOKEN);
    f.detectChanges();
    const req = http.expectOne(URL);
    if (response.status) req.flush(response.body, { status: response.status, statusText: 'Erreur' });
    else req.flush(response.body);
    await tick();
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  it('affiche consultant, mois, mission, client, jours et total', async () => {
    const { el } = await render({ body: VIEW });
    expect(el.querySelector('h1')?.textContent).toContain('CRA de Jean Dupont – Novembre 2026');
    expect(el.textContent).toContain('Client Alpha');
    const rows = el.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent?.replace(/\s+/g, ' ')).toContain('lundi 02/11/2026');
    expect(rows[0].textContent).toContain('lun.');
    expect(rows[1].textContent).toContain('½');
    expect(el.querySelector('tfoot')?.textContent).toContain('1,5 j');
  });

  it('validation avec commentaire facultatif', async () => {
    const { f, el } = await render({ body: VIEW });
    button(el, 'Valider le CRA').click();
    const req = http.expectOne({ method: 'POST', url: URL });
    expect(req.request.body).toEqual({ decision: 'VALIDE', comment: null });
    req.flush({ ok: true, status: 'VALIDE' });
    await tick();
    await f.whenStable();
    expect(el.textContent).toContain('Merci, le CRA est validé');
  });

  it('rejet : motif obligatoire', async () => {
    const { f, el } = await render({ body: VIEW });
    button(el, 'Rejeter').click();
    await f.whenStable();
    button(el, 'Confirmer le rejet').click();
    await f.whenStable();
    expect(el.textContent).toContain('Indiquez le motif du rejet');
    http.expectNone({ method: 'POST', url: URL });

    const motif = el.querySelector<HTMLTextAreaElement>('#motif')!;
    motif.value = 'Le 3 n’a pas été travaillé';
    motif.dispatchEvent(new Event('input'));
    button(el, 'Confirmer le rejet').click();
    const req = http.expectOne({ method: 'POST', url: URL });
    expect(req.request.body).toEqual({ decision: 'REJETE', comment: 'Le 3 n’a pas été travaillé' });
    req.flush({ ok: true, status: 'REJETE' });
    await tick();
    await f.whenStable();
    expect(el.textContent).toContain('Le CRA a été rejeté');
  });

  it('demande déjà traitée : décision et commentaire, sans boutons', async () => {
    const { el } = await render({ body: { ...VIEW, status: 'REJETE', comment: 'Erreur le 3' } });
    expect(el.textContent).toContain('Demande déjà traitée : CRA rejeté');
    expect(el.textContent).toContain('Erreur le 3');
    expect(button(el, 'Valider le CRA')).toBeUndefined();
  });

  it('lien expiré : pas de boutons', async () => {
    const { el } = await render({ body: { ...VIEW, expired: true } });
    expect(el.textContent).toContain('n’est plus valable');
    expect(button(el, 'Valider le CRA')).toBeUndefined();
  });

  it('lien remplacé ou invalide : message dédié', async () => {
    const { el } = await render({ body: { error: '…', code: 'LIEN_REMPLACE' }, status: 404 });
    expect(el.querySelector('h1')?.textContent).toBe('Lien remplacé');
    expect(el.textContent).toContain('nouvelle version');
  });

  it('décision refusée par le serveur (déjà traitée entre-temps)', async () => {
    const { f, el } = await render({ body: VIEW });
    button(el, 'Valider le CRA').click();
    http.expectOne({ method: 'POST', url: URL }).flush({ error: '…', code: 'DEJA_TRAITE' }, { status: 409, statusText: 'Conflict' });
    await tick();
    await f.whenStable();
    expect(el.querySelector('h1')?.textContent).toBe('Demande déjà traitée');
  });
});
