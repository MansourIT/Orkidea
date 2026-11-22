import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { AuthStore } from '../core/auth.store';
import { APP_ICONS } from '../ui/icons';
import { Shell } from './shell';

describe('Shell', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIcons(APP_ICONS)] });
  });

  it('affiche les initiales et masque l’administration pour un consultant', async () => {
    TestBed.inject(AuthStore).set({ id: 'u-jd', email: 'jean.dupont@example.com', name: 'Jean Dupont', role: 'consultant' });
    const f = TestBed.createComponent(Shell);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('button[aria-label="Menu de Jean Dupont"]')?.textContent?.trim()).toBe('JD');
    expect(el.textContent).toContain('Tableau de bord');
    expect(el.textContent).not.toContain('Administration');
    expect(el.querySelector('img[alt="Orkidea"]')?.getAttribute('src')).toBe('assets/logo.svg');
  });

  it('affiche le lien Administration pour un admin', async () => {
    TestBed.inject(AuthStore).set({ id: 'u-admin', email: 'contact@orkidea.fr', name: 'Admin Orkidea', role: 'admin' });
    const f = TestBed.createComponent(Shell);
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Administration');
  });
});
