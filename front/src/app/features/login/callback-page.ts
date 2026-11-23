import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { Api } from '../../core/api';
import { AuthStore, homeFor } from '../../core/auth.store';
import { AuthCard } from './auth-card';

/**
 * Arrivée depuis le lien de l'email (/connexion?token=…) : le jeton est confirmé en POST.
 * Un simple GET (antivirus de messagerie qui pré-ouvre les liens) ne consomme donc pas le jeton.
 */
@Component({
  selector: 'app-callback-page',
  imports: [RouterLink, NgIcon, AuthCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-card>
      @if (failed()) {
        <div class="alert-error" role="alert">
          <ng-icon name="lucideCircleAlert" size="18" aria-hidden="true" />
          <span>Lien invalide ou expiré. Chaque lien ne sert qu’une fois et reste valable 15 minutes.</span>
        </div>
        <a routerLink="/login" class="btn-primary mt-6 w-full">Demander un nouveau lien</a>
      } @else {
        <p class="flex items-center justify-center gap-2 text-ink-soft" role="status">
          <ng-icon name="lucideLoaderCircle" size="20" class="animate-spin" aria-hidden="true" />
          Connexion en cours…
        </p>
      }
    </app-auth-card>
  `,
})
export class CallbackPage implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly token = input<string>();
  protected readonly failed = signal(false);

  async ngOnInit(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.failed.set(true);
      return;
    }
    try {
      const user = this.auth.set(await this.api.confirmLogin(token));
      await this.router.navigateByUrl(homeFor(user), { replaceUrl: true });
    } catch {
      this.failed.set(true);
      // Retire le jeton (consommé ou invalide) de l'historique du navigateur.
      await this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }
}
