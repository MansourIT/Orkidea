import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Logo } from '../../layout/logo';

/** Carte centrée des écrans publics de connexion. */
@Component({
  selector: 'app-auth-card',
  imports: [Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-dvh items-center justify-center px-4 py-12">
      <div class="card w-full max-w-md p-8">
        <div class="mb-8 flex flex-col items-center gap-2 text-center">
          <app-logo [height]="40" />
          <p class="text-sm text-ink-soft">Espace consultant · comptes rendus d’activité</p>
        </div>
        <ng-content />
      </div>
    </div>
  `,
})
export class AuthCard {}
