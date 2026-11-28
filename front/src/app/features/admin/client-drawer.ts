import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import type { Client, ClientInput } from '@shared/types';
import { Api, apiError } from '../../core/api';

const EMAIL = /^([^@\s]+@[^@\s]+\.[^@\s]+)?$/;

/** Panneau latéral de création / modification d'un client. Se ferme avec `true` si le client a été enregistré. */
@Component({
  selector: 'app-client-drawer',
  imports: [ReactiveFormsModule, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="flex h-dvh w-[min(100vw,36rem)] flex-col bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="client-drawer-titre">
      <header class="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
        <div class="min-w-0 flex-1">
          <h2 id="client-drawer-titre" class="truncate text-lg font-bold">{{ client ? client.name : 'Nouveau client' }}</h2>
          <p class="text-sm text-ink-soft">Ces informations sont reprises dans les contrats de prestation.</p>
        </div>
        <button type="button" class="btn-ghost p-2" (click)="ref.close(false)" aria-label="Fermer"><ng-icon name="lucideX" size="18" /></button>
      </header>

      <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-1 flex-col overflow-y-auto" novalidate aria-label="Fiche client">
        <div class="flex-1 space-y-6 px-5 py-5">
          <section aria-labelledby="sec-societe-client">
            <h3 id="sec-societe-client" class="section-title"><span class="section-num">1</span> Société</h3>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="sm:col-span-2">
                <label for="cl-name" class="label">Raison sociale</label>
                <input id="cl-name" class="input" formControlName="name" autocomplete="off" [attr.aria-invalid]="invalid('name')" />
              </div>
              <div class="sm:col-span-2">
                <label for="cl-siret" class="label">SIRET</label>
                <input id="cl-siret" class="input" formControlName="siret" inputmode="numeric" maxlength="14" [attr.aria-invalid]="invalid('siret')" />
                @if (invalid('siret')) { <p class="mt-1 text-xs text-red-700">14 chiffres, sans espace.</p> }
              </div>
              <div class="sm:col-span-2"><label for="cl-address" class="label">Adresse</label><input id="cl-address" class="input" formControlName="address" autocomplete="off" /></div>
              <div><label for="cl-cp" class="label">Code postal</label><input id="cl-cp" class="input" formControlName="postalCode" maxlength="10" /></div>
              <div><label for="cl-city" class="label">Ville</label><input id="cl-city" class="input" formControlName="city" /></div>
            </div>
          </section>

          <section aria-labelledby="sec-signataire">
            <h3 id="sec-signataire" class="section-title"><span class="section-num">2</span> Signataire du contrat</h3>
            <div class="grid gap-3 sm:grid-cols-2">
              <div><label for="cl-rep" class="label">Représentant légal</label><input id="cl-rep" class="input" formControlName="representativeName" placeholder="Prénom Nom" /></div>
              <div><label for="cl-role" class="label">Fonction</label><input id="cl-role" class="input" formControlName="representativeRole" placeholder="Ex. : Directeur des achats" /></div>
              <div class="sm:col-span-2">
                <label for="cl-email" class="label">Email pour les contrats</label>
                <input id="cl-email" type="email" class="input" formControlName="contractEmail" [attr.aria-invalid]="invalid('contractEmail')" />
                @if (invalid('contractEmail')) { <p class="mt-1 text-xs text-red-700">Email invalide.</p> }
                @else { <p class="mt-1 text-xs text-ink-soft">Peut être différent du valideur des CRA, défini sur chaque mission.</p> }
              </div>
            </div>
          </section>

          <section aria-labelledby="sec-facturation-client">
            <h3 id="sec-facturation-client" class="section-title"><span class="section-num">3</span> Facturation</h3>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label for="cl-vat" class="label">N° de TVA intracommunautaire</label>
                <input id="cl-vat" class="input uppercase" formControlName="vatNumber" placeholder="FR12345678901" [attr.aria-invalid]="invalid('vatNumber')" />
                @if (invalid('vatNumber')) { <p class="mt-1 text-xs text-red-700">Format attendu : FR + 11 caractères.</p> }
              </div>
              <div>
                <label for="cl-inv-email" class="label">Email pour les factures</label>
                <input id="cl-inv-email" type="email" class="input" formControlName="invoiceEmail" [attr.aria-invalid]="invalid('invoiceEmail')" />
                @if (invalid('invoiceEmail')) { <p class="mt-1 text-xs text-red-700">Email invalide.</p> }
              </div>
            </div>
            <p class="mt-2 text-xs text-ink-soft">Le SIRET et l’adresse complète sont obligatoires pour émettre une facture.</p>
          </section>
        </div>

        <footer class="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          @if (error()) {
            <p class="flex w-full items-start gap-2 text-sm text-red-700" role="alert"><ng-icon name="lucideCircleAlert" size="16" class="mt-0.5 shrink-0" aria-hidden="true" />{{ error() }}</p>
          }
          <button type="button" class="btn-secondary" (click)="ref.close(false)">Annuler</button>
          <button type="submit" class="btn-primary" [disabled]="busy()">
            <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideSave'" size="16" [class.animate-spin]="busy()" aria-hidden="true" /> {{ client ? 'Enregistrer' : 'Créer le client' }}
          </button>
        </footer>
      </form>
    </aside>
  `,
})
export class ClientDrawer {
  protected readonly client = inject<Client | null>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly api = inject(Api);

  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.client?.name ?? '', [Validators.required, Validators.maxLength(120)]],
    siret: [this.client?.siret ?? '', [Validators.pattern(/^(\d{14})?$/)]],
    address: [this.client?.address ?? '', Validators.maxLength(200)],
    postalCode: [this.client?.postalCode ?? '', Validators.maxLength(10)],
    city: [this.client?.city ?? '', Validators.maxLength(80)],
    representativeName: [this.client?.representativeName ?? '', Validators.maxLength(120)],
    representativeRole: [this.client?.representativeRole ?? '', Validators.maxLength(80)],
    contractEmail: [this.client?.contractEmail ?? '', [Validators.pattern(EMAIL)]],
    vatNumber: [this.client?.vatNumber ?? '', [Validators.pattern(/^([A-Za-z]{2}[0-9A-Za-z]{2,13})?$/)]],
    invoiceEmail: [this.client?.invoiceEmail ?? '', [Validators.pattern(EMAIL)]],
  });

  protected invalid(name: keyof typeof this.form.controls): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  async save(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid) {
      this.error.set('Complétez ou corrigez les champs encadrés en rouge.');
      return;
    }
    const v = this.form.getRawValue();
    const orNull = (x: string) => x.trim() || null;
    const body: ClientInput = {
      name: v.name.trim(),
      siret: orNull(v.siret),
      address: orNull(v.address),
      postalCode: orNull(v.postalCode),
      city: orNull(v.city),
      representativeName: orNull(v.representativeName),
      representativeRole: orNull(v.representativeRole),
      contractEmail: orNull(v.contractEmail),
      vatNumber: orNull(v.vatNumber)?.toUpperCase() ?? null,
      invoiceEmail: orNull(v.invoiceEmail),
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.client) await this.api.updateClient(this.client.id, body);
      else await this.api.createClient(body);
      this.ref.close(true);
    } catch (err) {
      const e = apiError(err);
      this.error.set(e.error + (e.details?.length ? ` (${e.details.join(' ; ')})` : ''));
    } finally {
      this.busy.set(false);
    }
  }
}
