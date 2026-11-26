import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import type { AdminUser } from '@shared/types';
import { Api, apiError } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { Confirm } from '../../ui/confirm-dialog';

/** Utilisateurs : consultants et administrateurs (création, rôle, activation). */
@Component({
  selector: 'app-admin-users',
  imports: [ReactiveFormsModule, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="create()" class="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end" aria-label="Nouvel utilisateur">
      <div><label for="u-name" class="label">Nom</label><input id="u-name" class="input" formControlName="name" autocomplete="off" /></div>
      <div><label for="u-email" class="label">Email</label><input id="u-email" type="email" class="input" formControlName="email" autocomplete="off" /></div>
      <div>
        <label for="u-role" class="label">Rôle</label>
        <select id="u-role" class="input" formControlName="role"><option value="consultant">Consultant</option><option value="admin">Admin</option></select>
      </div>
      <button type="submit" class="btn-primary" [disabled]="busy()"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Ajouter</button>
      @if (submitted() && form.invalid) { <p class="text-sm text-red-700 sm:col-span-4">Nom et email valide requis.</p> }
    </form>

    @if (error()) { <div class="alert-error mt-4" role="alert">{{ error() }}</div> }

    <div class="card mt-4 overflow-x-auto">
      <table class="w-full min-w-[48rem] text-sm">
        <thead class="bg-slate-50 text-left text-xs text-ink-soft">
          <tr><th scope="col" class="px-4 py-3 font-medium">Nom</th><th scope="col" class="px-4 py-3 font-medium">Email</th><th scope="col" class="px-4 py-3 font-medium">Qualification</th><th scope="col" class="px-4 py-3 font-medium">Rôle</th><th scope="col" class="px-4 py-3 font-medium">Statut</th><th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr class="border-t border-slate-100" [class.opacity-60]="!u.active">
              <td class="px-4 py-3 font-medium text-ink">{{ u.name }}</td>
              <td class="px-4 py-3 text-ink-soft">{{ u.email }}</td>
              <td class="px-4 py-3">
                <button type="button" class="group inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-slate-100" (click)="editQualification(u)" [attr.aria-label]="'Qualification de ' + u.name + ' : ' + (u.qualification ?? 'non renseignée')">
                  @if (u.qualification) { <span>{{ u.qualification }}</span> } @else { <span class="text-ink-soft">À renseigner</span> }
                  <ng-icon name="lucidePencil" size="12" class="text-ink-soft opacity-0 group-hover:opacity-100" aria-hidden="true" />
                </button>
              </td>
              <td class="px-4 py-3">
                <select class="input w-36 py-1" [value]="u.role" (change)="update(u, { role: $any($event.target).value })" [disabled]="u.id === me()" [attr.aria-label]="'Rôle de ' + u.name">
                  <option value="consultant">Consultant</option><option value="admin">Admin</option>
                </select>
              </td>
              <td class="px-4 py-3">{{ u.active ? 'Actif' : 'Désactivé' }}</td>
              <td class="px-4 py-3 text-right">
                @if (u.id !== me()) {
                  <button type="button" class="btn-ghost px-3 py-1.5 text-xs" (click)="update(u, { active: !u.active })">{{ u.active ? 'Désactiver' : 'Réactiver' }}</button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminUsers implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly confirm = inject(Confirm);
  protected readonly me = () => this.auth.user()?.id;
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    role: ['consultant' as 'consultant' | 'admin'],
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.users.set(await this.api.users());
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  async create(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const v = this.form.getRawValue();
      await this.api.createUser({ ...v, email: v.email.trim(), name: v.name.trim() });
      this.form.reset();
      this.submitted.set(false);
      await this.load();
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }

  /** Qualification reprise dans les contrats de prestation (ex. « Architecte logiciel »). */
  async editQualification(u: AdminUser): Promise<void> {
    const value = await this.confirm.prompt({
      title: 'Qualification',
      message: `${u.name} — mention reprise dans les contrats de prestation.`,
      confirmLabel: 'Enregistrer',
      input: { label: 'Qualification', required: false, initial: u.qualification ?? '', multiline: false },
    });
    if (value === null || value === undefined || value.trim() === (u.qualification ?? '')) return;
    await this.update(u, { qualification: value.trim() || null });
  }

  async update(u: AdminUser, patch: Partial<Pick<AdminUser, 'role' | 'active' | 'qualification'>>): Promise<void> {
    this.error.set(null);
    try {
      await this.api.updateUser(u.id, patch);
      await this.load();
    } catch (err) {
      this.error.set(apiError(err).error);
      await this.load();
    }
  }
}
