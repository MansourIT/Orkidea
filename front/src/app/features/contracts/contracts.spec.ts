import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { DEMO_TEMPLATE } from '@shared/contrats';
import { APP_ICONS } from '../../ui/icons';
import { NewTemplateDialog } from './new-template-dialog';
import { SignedUploadDialog } from './signed-upload-dialog';
import { highlightSource } from './template-source';

describe('Modèles de contrat (front)', () => {
  it('coloration : variables connues, inconnues, blocs, numéro d’article, texte échappé', () => {
    const html = highlightSource('## Article {{n}}\n{{client.siret}} {{client.sirett}} {{#si mission.validation_client}} <b>');
    expect(html).toContain('<span class="tok-heading">## Article <span class="tok-special">{{n}}</span></span>');
    expect(html).toContain('<span class="tok-var">{{client.siret}}</span>');
    expect(html).toContain('<span class="tok-bad">{{client.sirett}}</span>');
    expect(html).toContain('<span class="tok-block">{{#si mission.validation_client}}</span>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('nouveau modèle : nom obligatoire, départ depuis la démonstration', async () => {
    const close = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS), { provide: DIALOG_DATA, useValue: {} }, { provide: DialogRef, useValue: { close } }],
    });
    const http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(NewTemplateDialog);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const submit = () => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Créer et ouvrir'))!.click();
    submit();
    await f.whenStable();
    expect(el.textContent).toContain('Donnez un nom au modèle.');
    http.expectNone({ method: 'POST' });
    const name = el.querySelector<HTMLInputElement>('#tpl-name')!;
    name.value = 'Régie';
    name.dispatchEvent(new Event('input'));
    submit();
    const req = http.expectOne({ method: 'POST', url: '/api/admin/contract-templates' });
    expect(req.request.body).toEqual({ name: 'Régie', body: DEMO_TEMPLATE });
    req.flush({ id: 't1' });
    await new Promise((r) => setTimeout(r));
    expect(close).toHaveBeenCalledWith('t1');
    http.verify();
  });

  it('dépôt du PDF signé : fichier obligatoire, type contrôlé, date envoyée en paramètre', async () => {
    const close = vi.fn();
    const contract = {
      id: 'k1', number: 'CS-2026-001', status: 'ENVOYE', mission: { id: 'm', label: 'Alpha' }, client: 'Client Alpha', consultant: 'Jean Dupont',
      template: { id: 't', name: 'Régie', version: 1 }, createdAt: '2026-11-20T10:00:00Z', issuedAt: '2026-11-20T10:00:00Z', sentAt: null, signedOn: null, updatedAt: '2026-11-20T10:00:00Z',
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS), { provide: DIALOG_DATA, useValue: { contract } }, { provide: DialogRef, useValue: { close } }],
    });
    const http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(SignedUploadDialog);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const submit = () => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Marquer signé'))!.click();
    submit();
    await f.whenStable();
    expect(el.textContent).toContain('Choisissez le PDF signé.');
    f.componentInstance.pick(new File(['x'], 'photo.png', { type: 'image/png' }));
    await f.whenStable();
    expect(el.textContent).toContain('Choisissez un fichier PDF.');
    f.componentInstance.pick(new File(['%PDF-1.7'], 'signe.pdf', { type: 'application/pdf' }));
    const date = el.querySelector<HTMLInputElement>('#signe-date')!;
    date.value = '2026-11-25';
    date.dispatchEvent(new Event('input'));
    submit();
    const req = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/admin/contracts/k1/signed');
    expect(req.request.params.get('signedOn')).toBe('2026-11-25');
    expect(req.request.headers.get('content-type')).toBe('application/pdf');
    req.flush({ ...contract, status: 'SIGNE' });
    await new Promise((r) => setTimeout(r));
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ status: 'SIGNE' }));
    http.verify();
  });
});
