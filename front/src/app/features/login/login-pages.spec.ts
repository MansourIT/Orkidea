import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { APP_ICONS } from '../../ui/icons';
import { AuthStore } from '../../core/auth.store';
import { CallbackPage } from './callback-page';
import { LoginPage } from './login-page';

const flush = () => new Promise((r) => setTimeout(r));

describe('pages de connexion', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS)],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('login : email invalide → message, aucun appel', async () => {
    const f = TestBed.createComponent(LoginPage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#email')!;
    input.value = 'pas-un-email';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await f.whenStable();
    expect(el.textContent).toContain('Saisissez une adresse email valide');
    http.expectNone('/api/auth/login');
  });

  it('login : envoi puis message neutre', async () => {
    const f = TestBed.createComponent(LoginPage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#email')!;
    input.value = ' jean.dupont@example.com ';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({ email: 'jean.dupont@example.com' });
    req.flush({ ok: true });
    await flush();
    await f.whenStable();
    expect(el.textContent).toContain('Si un compte existe, un lien vous a été envoyé');
  });

  it('login : ?erreur=lien affiche « Lien invalide ou expiré »', async () => {
    const f = TestBed.createComponent(LoginPage);
    f.componentRef.setInput('erreur', 'lien');
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Lien invalide ou expiré');
  });

  it('login : erreur serveur (429) affichée', async () => {
    const f = TestBed.createComponent(LoginPage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#email')!;
    input.value = 'a@b.fr';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    http.expectOne('/api/auth/login').flush({ error: 'Trop de tentatives, réessayez dans une minute' }, { status: 429, statusText: 'Too Many' });
    await flush();
    await f.whenStable();
    expect(el.textContent).toContain('Trop de tentatives');
  });

  it('connexion : jeton confirmé en POST puis redirection selon le rôle', async () => {
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const f = TestBed.createComponent(CallbackPage);
    f.componentRef.setInput('token', 'jeton-de-test-123');
    await f.whenStable();
    const req = http.expectOne({ method: 'POST', url: '/api/auth/callback' });
    expect(req.request.body).toEqual({ token: 'jeton-de-test-123' });
    req.flush({ id: 'u-admin', email: 'contact@orkidea.fr', name: 'Admin', role: 'admin' });
    await flush();
    expect(TestBed.inject(AuthStore).isAdmin()).toBe(true);
    expect(nav).toHaveBeenCalledWith('/admin', { replaceUrl: true });
  });

  it('connexion : jeton refusé → message et lien vers /login', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const f = TestBed.createComponent(CallbackPage);
    f.componentRef.setInput('token', 'jeton-utilise-0000');
    await f.whenStable();
    http.expectOne('/api/auth/callback').flush({ error: 'Lien invalide ou expiré', code: 'LIEN_INVALIDE' }, { status: 400, statusText: 'Bad' });
    await flush();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Lien invalide ou expiré');
    expect(el.querySelector('a[href="/login"]')).not.toBeNull();
  });
});
