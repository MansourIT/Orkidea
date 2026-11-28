import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { invoiceNumber, type InvoiceSettings } from '@shared/factures';
import { todayInParis } from '@shared/dates';
import { Api, apiError } from '../../core/api';
import { ToggleSwitch } from '../../ui/toggle-switch';

/** Paramètres de facturation (numérotation, TVA, délai, pénalités, coordonnées bancaires), enregistrés à part. */
@Component({
  selector: 'app-invoice-settings',
  imports: [NgIcon, ToggleSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card overflow-hidden" aria-labelledby="sec-facturation">
      <header class="flex items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orchid-50 text-orchid"><ng-icon name="lucideFileText" size="18" aria-hidden="true" /></span>
        <div class="min-w-0 flex-1">
          <h3 id="sec-facturation" class="font-semibold">Facturation</h3>
          <p class="text-xs text-ink-soft">Numérotation, TVA et conditions de paiement des factures émises depuis les CRA validés.</p>
        </div>
      </header>
      @if (!draft()) {
        <p class="flex items-center gap-2 px-5 py-6 text-sm text-ink-soft" role="status">
          @if (error()) { <span class="text-red-700">{{ error() }}</span> } @else { <ng-icon name="lucideLoaderCircle" size="16" class="animate-spin" aria-hidden="true" /> Chargement… }
        </p>
      } @else {
        @let d = draft()!;
        <div class="grid gap-3 px-5 py-4 sm:grid-cols-2">
          <div>
            <label for="fa-prefix" class="label">Préfixe des factures</label>
            <input id="fa-prefix" class="input w-28 uppercase" maxlength="6" [value]="d.prefix" (input)="set('prefix', $any($event.target).value.toUpperCase())" />
            <p class="mt-1 text-xs text-ink-soft">Prochaine : {{ example(d.prefix) }}</p>
          </div>
          <div>
            <label for="fa-credit" class="label">Préfixe des avoirs</label>
            <input id="fa-credit" class="input w-28 uppercase" maxlength="6" [value]="d.creditPrefix" (input)="set('creditPrefix', $any($event.target).value.toUpperCase())" />
            <p class="mt-1 text-xs text-ink-soft">Prochain : {{ example(d.creditPrefix) }}</p>
          </div>
          <div>
            <label for="fa-vat" class="label">Taux de TVA</label>
            <div class="relative w-28"><input id="fa-vat" type="number" min="0" max="30" step="0.1" class="input pr-8" [value]="d.vatRate" (input)="set('vatRate', +$any($event.target).value)" /><span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-soft">%</span></div>
          </div>
          <div>
            <label for="fa-days" class="label">Délai de paiement par défaut</label>
            <div class="relative w-32"><input id="fa-days" type="number" min="0" max="60" class="input pr-12" [value]="d.defaultPaymentDays" (input)="set('defaultPaymentDays', +$any($event.target).value)" /><span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-soft">jours</span></div>
            <p class="mt-1 text-xs text-ink-soft">Si la mission n’en précise pas.</p>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 sm:col-span-2">
            <div>
              <p class="text-sm font-medium text-ink">TVA sur les débits</p>
              <p class="text-xs text-ink-soft">Par défaut, la TVA des prestations de services est due à l’encaissement. Activez si Orkidea a opté pour les débits : la mention figurera sur les factures.</p>
            </div>
            <app-switch label="Option pour la TVA sur les débits" [checked]="d.vatOnDebits" (checkedChange)="set('vatOnDebits', $event)" />
          </div>
          <div class="sm:col-span-2">
            <label for="fa-penalty" class="label">Taux des pénalités de retard</label>
            <input id="fa-penalty" class="input" maxlength="120" [value]="d.latePenalty" (input)="set('latePenalty', $any($event.target).value)" />
            <p class="mt-1 text-xs text-ink-soft">Mention obligatoire, avec l’indemnité forfaitaire de 40 € ajoutée automatiquement.</p>
          </div>
          <div>
            <label for="fa-iban" class="label">IBAN</label>
            <input id="fa-iban" class="input font-mono uppercase" [value]="d.iban" (input)="set('iban', $any($event.target).value)" placeholder="FR76 …" />
          </div>
          <div>
            <label for="fa-bic" class="label">BIC</label>
            <input id="fa-bic" class="input font-mono uppercase" maxlength="11" [value]="d.bic" (input)="set('bic', $any($event.target).value)" />
          </div>
        </div>
        @if (dirty() || error() || savedAt()) {
          <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <p class="mr-auto text-xs" aria-live="polite">
              @if (error()) { <span class="text-red-700">{{ error() }}</span> }
              @else if (dirty()) { Paramètres de facturation modifiés }
              @else { <span class="text-emerald-700">Enregistrés à {{ savedAt() }}</span> }
            </p>
            @if (dirty()) {
              <button type="button" class="btn-secondary" (click)="cancel()" [disabled]="busy()">Annuler</button>
              <button type="button" class="btn-primary" (click)="save()" [disabled]="busy()">
                <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideSave'" size="16" [class.animate-spin]="busy()" aria-hidden="true" /> Enregistrer la facturation
              </button>
            }
          </footer>
        }
      }
    </section>
  `,
})
export class InvoiceSettingsCard implements OnInit {
  private readonly api = inject(Api);
  private readonly saved = signal<InvoiceSettings | null>(null);
  protected readonly draft = signal<InvoiceSettings | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedAt = signal<string | null>(null);
  readonly dirty = computed(() => !!this.draft() && JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));
  private readonly year = Number(todayInParis().slice(0, 4));

  async ngOnInit(): Promise<void> {
    try {
      const s = await this.api.invoiceSettings();
      this.saved.set(s);
      this.draft.set({ ...s });
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  protected example(prefix: string): string {
    return invoiceNumber(prefix || 'FA', this.year, 1);
  }

  protected set<K extends keyof InvoiceSettings>(key: K, value: InvoiceSettings[K]): void {
    this.draft.update((d) => d && { ...d, [key]: value });
    this.error.set(null);
    this.savedAt.set(null);
  }

  cancel(): void {
    const s = this.saved();
    if (s) this.draft.set({ ...s });
    this.error.set(null);
  }

  async save(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const s = await this.api.saveInvoiceSettings(d);
      this.saved.set(s);
      this.draft.set({ ...s });
      this.savedAt.set(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      const e = apiError(err);
      this.error.set(e.details?.length ? `${e.error} : ${e.details.join(' ; ')}` : e.error);
    } finally {
      this.busy.set(false);
    }
  }
}
