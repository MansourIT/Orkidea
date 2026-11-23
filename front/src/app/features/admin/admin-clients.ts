import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import type { Client } from '@shared/types';
import { Api, apiError } from '../../core/api';
import { Confirm } from '../../ui/confirm-dialog';

/** Clients (création, renommage, SIRET). */
@Component({
  selector: 'app-admin-clients',
  imports: [ReactiveFormsModule, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="create()" class="card grid gap-3 p-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end" aria-label="Nouveau client">
      <div><label for="c-name" class="label">Raison sociale</label><input id="c-name" class="input" formControlName="name" autocomplete="off" /></div>
      <div><label for="c-siret" class="label">SIRET <span class="font-normal text-ink-soft">(facultatif)</span></label><input id="c-siret" class="input" formControlName="siret" inputmode="numeric" maxlength="14" /></div>
      <button type="submit" class="btn-primary" [disabled]="busy()"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Ajouter</button>
      @if (submitted() && form.invalid) { <p class="text-sm text-red-700 sm:col-span-3">Raison sociale requise ; SIRET = 14 chiffres.</p> }
    </form>

    @if (error()) { <div class="alert-error mt-4" role="alert">{{ error() }}</div> }

    <div class="card mt-4 overflow-x-auto">
      <table class="w-full min-w-[32rem] text-sm">
        <thead class="bg-slate-50 text-left text-xs text-ink-soft">
          <tr><th scope="col" class="px-4 py-3 font-medium">Client</th><th scope="col" class="px-4 py-3 font-medium">SIRET</th><th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          @for (c of clients(); track c.id) {
            <tr class="border-t border-slate-100">
              <td class="px-4 py-3 font-medium text-ink">{{ c.name }}</td>
              <td class="px-4 py-3 text-ink-soft">{{ c.siret ?? '—' }}</td>
              <td class="px-4 py-3 text-right"><button type="button" class="btn-ghost px-3 py-1.5 text-xs" (click)="rename(c)"><ng-icon name="lucidePencil" size="14" aria-hidden="true" /> Renommer</button></td>
            </tr>
          } @empty {
            <tr><td colspan="3" class="px-4 py-10 text-center text-ink-soft">Aucun client.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminClients implements OnInit {
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  protected readonly clients = signal<Client[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    siret: ['', [Validators.pattern(/^(\d{14})?$/)]],
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.clients.set(await this.api.clients());
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
      await this.api.createClient({ name: v.name.trim(), siret: v.siret || null });
      this.form.reset();
      this.submitted.set(false);
      await this.load();
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }

  async rename(c: Client): Promise<void> {
    const name = (
      await this.confirm.prompt({ title: 'Renommer le client', message: c.name, confirmLabel: 'Renommer', input: { label: 'Nouvelle raison sociale', required: true, initial: c.name, multiline: false } })
    )?.trim();
    if (!name || name === c.name) return;
    try {
      await this.api.updateClient(c.id, { name });
      await this.load();
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }
}
