import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, Router, type RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { User } from '@shared/types';
import { Api } from './api';
import { authInterceptor } from './auth.interceptor';
import { AuthStore, homeFor } from './auth.store';
import { adminGuard, authGuard, guestGuard } from './guards';
import { HttpClient } from '@angular/common/http';

const JD: User = { id: 'u-jd', email: 'jean.dupont@example.com', name: 'Jean Dupont', role: 'consultant' };
const ADMIN: User = { ...JD, id: 'u-admin', role: 'admin' };

describe('authentification', () => {
  let http: HttpTestingController;
  let store: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
  });

  afterEach(() => http.verify());

  const run = (guard: typeof authGuard) =>
    TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)) as Promise<boolean | UrlTree>;

  const urlOf = (r: boolean | UrlTree) => (r instanceof UrlTree ? TestBed.inject(Router).serializeUrl(r) : r);

  it('charge /api/auth/me une seule fois', async () => {
    const a = store.ensureLoaded();
    const b = store.ensureLoaded();
    http.expectOne('/api/auth/me').flush(JD);
    expect(await a).toEqual(JD);
    expect(await b).toEqual(JD);
    expect(store.isAdmin()).toBe(false);
  });

  it('authGuard : non connecté → /login', async () => {
    const result = run(authGuard);
    http.expectOne('/api/auth/me').flush({ error: 'Non authentifié' }, { status: 401, statusText: 'Unauthorized' });
    expect(urlOf(await result)).toBe('/login');
  });

  it('adminGuard : consultant → /, admin → accès', async () => {
    store.set(JD);
    expect(urlOf(await run(adminGuard))).toBe('/');
    store.set(ADMIN);
    expect(await run(adminGuard)).toBe(true);
  });

  it('guestGuard : déjà connecté → /', async () => {
    store.set(JD);
    expect(urlOf(await run(guestGuard))).toBe('/');
  });

  it('une réponse 401 en cours d’utilisation déconnecte et renvoie vers /login', async () => {
    store.set(JD);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const req = firstValueFrom(TestBed.inject(HttpClient).get('/api/timesheets/2026-11')).catch(() => null);
    http.expectOne('/api/timesheets/2026-11').flush({ error: 'Session expirée' }, { status: 401, statusText: 'Unauthorized' });
    await req;
    expect(store.user()).toBeNull();
    expect(nav).toHaveBeenCalledWith(['/login']);
  });

  it('déconnexion', async () => {
    store.set(JD);
    const done = store.logout();
    http.expectOne({ method: 'POST', url: '/api/auth/logout' }).flush({ ok: true });
    await done;
    expect(store.user()).toBeNull();
  });

  it('page d’accueil selon le rôle', () => {
    expect(homeFor(ADMIN)).toBe('/admin');
    expect(homeFor(JD)).toBe('/');
    expect(TestBed.inject(Api).pdfUrl('2026-11')).toBe('/api/timesheets/2026-11/pdf');
  });
});
