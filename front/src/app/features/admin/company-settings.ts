import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { COMPANY_LABELS, type CompanySettings, contractNumber, missingCompanyFields } from '@shared/company';
import { todayInParis } from '@shared/dates';
import { Api, apiError } from '../../core/api';

type Field = keyof CompanySettings;

/** Disposition du formulaire : [champ, largeur (2 = pleine ligne), aide]. */
const LAYOUT: Array<{ title: string; fields: Array<[Field, 1 | 2, string?]> }> = [
  {
    title: 'Identité',
    fields: [
      ['legalName', 1],
      ['legalForm', 1, 'Ex. : SASU'],
      ['capital', 1, 'Tel qu’affiché, ex. : 1 000 €'],
      ['siret', 1, '14 chiffres'],
      ['rcs', 1, 'Ex. : Paris 123 456 789'],
      ['vatNumber', 1, 'Ex. : FR12123456789'],
    ],
  },
  { title: 'Siège', fields: [['address', 2], ['postalCode', 1], ['city', 1]] },
  { title: 'Signataire', fields: [['representativeName', 1], ['representativeRole', 1]] },
  {
    title: 'Portage salarial',
    fields: [['financialGuarantee', 2, 'Garant et numéro de la garantie financière : mention obligatoire du contrat de prestation.']],
  },
];

const FORMATS: Partial<Record<Field, { re: RegExp; message: string }>> = {
  siret: { re: /^(\d{14})?$/, message: '14 chiffres, sans espace' },
  vatNumber: { re: /^(FR[0-9A-Z]{2}\d{9})?$/, message: 'Format FR + 11 caractères' },
  contractNumberPrefix: { re: /^[A-Z]{1,6}$/, message: '1 à 6 lettres majuscules' },
};

/** Identité d'Orkidea reprise dans les contrats, avec son propre enregistrement. */
@Component({
  selector: 'app-company-settings',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card overflow-hidden" aria-labelledby="sec-societe">
      <header class="flex items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orchid-50 text-orchid"><ng-icon name="lucideBuilding2" size="18" aria-hidden="true" /></span>
        <div class="min-w-0 flex-1">
          <h3 id="sec-societe" class="font-semibold">Société et contrats</h3>
          <p class="text-xs text-ink-soft">Identité d’Orkidea reprise dans les contrats de prestation envoyés aux clients.</p>
        </div>
        @if (draft()) {
          @if (missing().length) {
            <span class="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800" [title]="'À compléter : ' + missingLabels()">{{ missing().length }} à compléter</span>
          } @else {
            <span class="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Complète</span>
          }
        }
      </header>

      @if (!draft()) {
        <p class="flex items-center gap-2 px-5 py-6 text-sm text-ink-soft" role="status">
          @if (error()) { <span class="text-red-700">{{ error() }}</span> } @else { <ng-icon name="lucideLoaderCircle" size="16" class="animate-spin" aria-hidden="true" /> Chargement… }
        </p>
      } @else {
        @let d = draft()!;
        <div class="divide-y divide-slate-100">
          @for (group of layout; track group.title) {
            <fieldset class="px-5 py-4">
              <legend class="mb-2 text-sm font-medium text-ink">{{ group.title }}</legend>
              <div class="grid gap-3 sm:grid-cols-2">
                @for (f of group.fields; track f[0]) {
                  <div [class.sm:col-span-2]="f[1] === 2">
                    <label [for]="'co-' + f[0]" class="label">{{ labels[f[0]] }}</label>
                    @if (f[0] === 'financialGuarantee') {
                      <textarea [id]="'co-' + f[0]" class="input min-h-16" maxlength="300" [value]="d[f[0]]" (input)="set(f[0], $any($event.target).value)" [attr.aria-describedby]="'co-' + f[0] + '-aide'"></textarea>
                    } @else {
                      <input [id]="'co-' + f[0]" class="input" [value]="d[f[0]]" (input)="set(f[0], $any($event.target).value)"
                             [attr.aria-invalid]="!!invalid()[f[0]]" [attr.aria-describedby]="f[2] || invalid()[f[0]] ? 'co-' + f[0] + '-aide' : null" />
                    }
                    @if (invalid()[f[0]]; as msg) { <p [id]="'co-' + f[0] + '-aide'" class="mt-1 text-xs text-red-700">{{ msg }}</p> }
                    @else if (f[2]) { <p [id]="'co-' + f[0] + '-aide'" class="mt-1 text-xs text-ink-soft">{{ f[2] }}</p> }
                  </div>
                }
              </div>
            </fieldset>
          }
          <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div class="min-w-0">
              <label for="co-contractNumberPrefix" class="text-sm font-medium text-ink">{{ labels.contractNumberPrefix }}</label>
              <p class="text-xs" [class]="invalid().contractNumberPrefix ? 'text-red-700' : 'text-ink-soft'">
                {{ invalid().contractNumberPrefix ?? 'Prochain contrat de l’année : ' + example() + ' (numérotation remise à zéro chaque année).' }}
              </p>
            </div>
            <input id="co-contractNumberPrefix" class="input w-28 uppercase" maxlength="6" [value]="d.contractNumberPrefix" (input)="set('contractNumberPrefix', $any($event.target).value.toUpperCase())"
                   [attr.aria-invalid]="!!invalid().contractNumberPrefix" />
          </div>
        </div>

        @if (dirty() || error() || savedAt()) {
          <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <p class="mr-auto flex items-center gap-1.5 text-xs" aria-live="polite">
              @if (error()) { <span class="text-red-700">{{ error() }}</span> }
              @else if (dirty()) { <span class="h-2 w-2 rounded-full bg-amber" aria-hidden="true"></span> Fiche société modifiée }
              @else { <ng-icon name="lucideCircleCheck" size="14" class="text-emerald-700" aria-hidden="true" /><span class="text-emerald-700">Enregistrée à {{ savedAt() }}</span> }
            </p>
            @if (dirty()) {
              <button type="button" class="btn-secondary" (click)="cancel()" [disabled]="busy()">Annuler</button>
              <button type="button" class="btn-primary" (click)="save()" [disabled]="busy() || hasErrors()">
                <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideSave'" size="16" [class.animate-spin]="busy()" aria-hidden="true" /> Enregistrer la fiche société
              </button>
            }
          </footer>
        }
      }
    </section>
  `,
})
export class CompanySettingsCard implements OnInit {
  private readonly api = inject(Api);
  protected readonly layout = LAYOUT;
  protected readonly labels = COMPANY_LABELS;

  private readonly saved = signal<CompanySettings | null>(null);
  protected readonly draft = signal<CompanySettings | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedAt = signal<string | null>(null);

  readonly dirty = computed(() => !!this.draft() && JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));
  protected readonly missing = computed(() => (this.draft() ? missingCompanyFields(this.draft()!) : []));
  protected readonly missingLabels = computed(() => this.missing().map((k) => COMPANY_LABELS[k]).join(', '));
  protected readonly example = computed(() => contractNumber(this.draft()?.contractNumberPrefix || 'CS', Number(todayInParis().slice(0, 4)), 1));

  /** Erreurs de format par champ (affichées sous le champ). */
  protected readonly invalid = computed(() => {
    const d = this.draft();
    const errors: Partial<Record<Field, string>> = {};
    if (!d) return errors;
    if (!d.legalName.trim()) errors.legalName = 'Raison sociale obligatoire';
    for (const [k, rule] of Object.entries(FORMATS) as Array<[Field, { re: RegExp; message: string }]>) if (!rule.re.test(d[k].trim())) errors[k] = rule.message;
    return errors;
  });
  protected readonly hasErrors = computed(() => Object.keys(this.invalid()).length > 0);

  async ngOnInit(): Promise<void> {
    try {
      const c = await this.api.company();
      this.saved.set(c);
      this.draft.set({ ...c });
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  protected set(key: Field, value: string): void {
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
    if (!d || this.hasErrors()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const trimmed = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim()])) as unknown as CompanySettings;
      const c = await this.api.saveCompany(trimmed);
      this.saved.set(c);
      this.draft.set({ ...c });
      this.savedAt.set(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      const e = apiError(err);
      this.error.set(e.details?.length ? `${e.error} : ${e.details.join(' ; ')}` : e.error);
    } finally {
      this.busy.set(false);
    }
  }
}
