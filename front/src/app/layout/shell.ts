import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { AuthStore } from '../core/auth.store';
import { initials } from '../core/format';
import { Logo } from './logo';

/** Mise en page des écrans connectés : barre supérieure + contenu. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIcon, CdkMenuTrigger, CdkMenu, CdkMenuItem, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <a routerLink="/" class="flex items-center gap-3" aria-label="Orkidea CRA – accueil">
          <app-logo [height]="30" />
          <span class="hidden text-lg font-bold text-ink sm:inline">CRA</span>
        </a>

        <nav class="ml-auto flex items-center gap-1" aria-label="Navigation principale">
          <a routerLink="/tableau-de-bord" routerLinkActive="text-orchid bg-orchid-50" class="btn-ghost">
            <ng-icon name="lucideCalendar" size="18" aria-hidden="true" />
            <span class="hidden sm:inline">Tableau de bord</span>
          </a>
          @if (auth.isAdmin()) {
            <a routerLink="/admin" routerLinkActive="text-orchid bg-orchid-50" class="btn-ghost">
              <ng-icon name="lucideShield" size="18" aria-hidden="true" />
              <span class="hidden sm:inline">Administration</span>
            </a>
          }
        </nav>

        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-full bg-orchid text-sm font-semibold text-white hover:bg-orchid-600"
          [cdkMenuTriggerFor]="userMenu"
          [attr.aria-label]="'Menu de ' + (auth.user()?.name ?? 'l’utilisateur')"
        >
          {{ userInitials() }}
        </button>
      </div>
    </header>

    <ng-template #userMenu>
      <div cdkMenu class="mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
        <div class="px-3 py-2">
          <p class="truncate text-sm font-semibold text-ink">{{ auth.user()?.name }}</p>
          <p class="truncate text-xs text-ink-soft">{{ auth.user()?.email }}</p>
        </div>
        <hr class="my-1 border-slate-100" />
        <button cdkMenuItem type="button" (cdkMenuItemTriggered)="logout()" class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-slate-100 focus:bg-slate-100 focus:outline-none">
          <ng-icon name="lucideLogOut" size="16" aria-hidden="true" /> Déconnexion
        </button>
      </div>
    </ng-template>

    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <router-outlet />
    </main>
  `,
})
export class Shell {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly userInitials = computed(() => initials(this.auth.user()?.name ?? ''));

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
