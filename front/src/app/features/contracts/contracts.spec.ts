import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { DEMO_TEMPLATE } from '@shared/contrats';
import { APP_ICONS } from '../../ui/icons';
import { NewTemplateDialog } from './new-template-dialog';
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
});
