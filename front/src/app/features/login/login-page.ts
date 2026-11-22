import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { Api, apiError } from '../../core/api';
import { AuthCard } from './auth-card';

type State = 'saisie' | 'envoi' | 'envoye';

/** Demande de lien de connexion par email. */
@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, NgIcon, AuthCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-card>
      <h1 class="mb-6 text-center text-xl font-bold">Connexion</h1>

      @if (erreur() === 'lien' && state() !== 'envoye') {
        <div class="alert-error mb-4" role="alert">
          <ng-icon name="lucideCircleAlert" size="18" aria-hidden="true" />
          <span>Lien invalide ou expiré. Demandez un nouveau lien ci-dessous.</span>
        </div>
      }

      @if (state() === 'envoye') {
        <div class="alert-success" role="status">
          <ng-icon name="lucideMail" size="18" aria-hidden="true" />
          <div>
            <p class="font-medium">Si un compte existe, un lien vous a été envoyé.</p>
            <p class="mt-1 text-emerald-800">Il est valable 15 minutes. Pensez à vérifier vos courriers indésirables.</p>
          </div>
        </div>
        <button type="button" class="btn-ghost mt-4 w-full" (click)="state.set('saisie')">Utiliser une autre adresse</button>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <label for="email" class="label">Adresse email</label>
          <input
            id="email"
            type="email"
            class="input"
            formControlName="email"
            autocomplete="email"
            placeholder="prenom.nom@exemple.fr"
            [attr.aria-invalid]="showError() ? 'true' : null"
            aria-describedby="email-erreur"
          />
          <p id="email-erreur" class="mt-1 min-h-5 text-sm text-red-700">
            @if (showError()) { Saisissez une adresse email valide. }
            @if (serverError()) { {{ serverError() }} }
          </p>
          <button type="submit" class="btn-primary mt-2 w-full" [disabled]="state() === 'envoi'">
            @if (state() === 'envoi') {
              <ng-icon name="lucideLoaderCircle" size="18" class="animate-spin" aria-hidden="true" />
            } @else {
              <ng-icon name="lucideMail" size="18" aria-hidden="true" />
            }
            Recevoir mon lien de connexion
          </button>
        </form>
      }
    </app-auth-card>
  `,
})
export class LoginPage {
  private readonly api = inject(Api);

  /** ?erreur=lien (lien invalide ou expiré). */
  readonly erreur = input<string>();

  protected readonly state = signal<State>('saisie');
  protected readonly serverError = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected showError(): boolean {
    return this.submitted() && this.form.controls.email.invalid;
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    this.serverError.set(null);
    if (this.form.invalid) return;
    this.state.set('envoi');
    try {
      await this.api.requestLogin(this.form.getRawValue().email.trim());
      this.state.set('envoye');
    } catch (err) {
      this.serverError.set(apiError(err).error);
      this.state.set('saisie');
    }
  }
}
