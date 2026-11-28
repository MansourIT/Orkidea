import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import type { AdminUser, Client, HolidayCode, Mission } from '@shared/types';
import type { AppSettings, DayPolicy } from '@shared/settings';
import { HOLIDAY_CODES, HOLIDAY_LABELS, type HolidayRegion } from '@shared/holidays';
import { Api, apiError, type MissionInput } from '../../core/api';
import { ACTIVITY_CODE_HINT, ACTIVITY_CODE_RE } from '@shared/activity-code';
import { Confirm } from '../../ui/confirm-dialog';
import { Segmented, type SegmentOption } from '../../ui/segmented';
import { ToggleSwitch } from '../../ui/toggle-switch';

/** Si le contrat exige la validation client : nom et email du valideur obligatoires ; fin ≥ début. */
function missionRules(group: AbstractControl): ValidationErrors | null {
  const v = group.getRawValue() as { clientValidation: boolean; validatorName: string; validatorEmail: string; startDate: string; endDate: string };
  const errors: ValidationErrors = {};
  if (v.clientValidation && !v.validatorName.trim()) errors['validatorName'] = true;
  if (v.clientValidation && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.validatorEmail.trim())) errors['validatorEmail'] = true;
  if (v.endDate && v.startDate && v.endDate < v.startDate) errors['dates'] = true;
  return Object.keys(errors).length ? errors : null;
}

type Inherit<T> = T | '';

export const MISSION_COLORS = ['#3B82F6', '#A855F7', '#22C55E', '#0EA5E9', '#F97316', '#EF4444', '#14B8A6', '#EAB308', '#EC4899', '#64748B'];

const POLICY_OPTIONS: SegmentOption<Inherit<DayPolicy>>[] = [
  { value: '', label: 'Global' },
  { value: 'INTERDIT', label: 'Interdits' },
  { value: 'AUTORISE', label: 'Autorisés' },
];
const REGION_OPTIONS: SegmentOption<Inherit<HolidayRegion>>[] = [
  { value: '', label: 'Global' },
  { value: 'metropole', label: 'Métropole' },
  { value: 'alsace-moselle', label: 'Alsace-Moselle' },
];

/** Création / modification d'une mission (contrat consultant ↔ client) et de ses activités, en sections. */
@Component({
  selector: 'app-mission-form',
  imports: [ReactiveFormsModule, NgIcon, Segmented, ToggleSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" class="flex min-h-full flex-col" [attr.aria-label]="mission() ? 'Modifier la mission' : 'Nouvelle mission'" novalidate>
      <div class="flex-1 space-y-6 px-5 py-5">
        <!-- 1. Contrat -->
        <section aria-labelledby="sec-contrat">
          <h3 id="sec-contrat" class="section-title"><span class="section-num">1</span> Contrat</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            @if (!mission()) {
              <div>
                <label for="m-consultant" class="label">Consultant</label>
                <select id="m-consultant" class="input" formControlName="consultantId" [attr.aria-invalid]="showCtl('consultantId')">
                  <option value="">— Choisir —</option>
                  @for (u of consultants(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
                </select>
              </div>
              <div>
                <label for="m-client" class="label">Client</label>
                <select id="m-client" class="input" formControlName="clientId" [attr.aria-invalid]="showCtl('clientId')">
                  <option value="">— Choisir —</option>
                  @for (c of clients(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
                </select>
              </div>
            } @else {
              <div class="rounded-lg bg-slate-50 px-3 py-2 text-sm sm:col-span-2">
                <span class="text-ink-soft">Consultant :</span> <span class="font-medium">{{ mission()!.consultant }}</span>
                <span class="mx-2 text-slate-300">|</span>
                <span class="text-ink-soft">Client :</span> <span class="font-medium">{{ mission()!.client }}</span>
              </div>
            }
            <div class="sm:col-span-2">
              <label for="m-label" class="label">Intitulé de la mission</label>
              <input id="m-label" class="input" formControlName="label" placeholder="Ex. : Projet Alpha" [attr.aria-invalid]="showCtl('label')" />
            </div>
            <div><label for="m-start" class="label">Début</label><input id="m-start" type="date" class="input" formControlName="startDate" [attr.aria-invalid]="showCtl('startDate')" /></div>
            <div>
              <label for="m-end" class="label">Fin <span class="font-normal text-ink-soft">(facultatif)</span></label>
              <input id="m-end" type="date" class="input" formControlName="endDate" [attr.aria-invalid]="showErr('dates')" />
              @if (showErr('dates')) { <p class="mt-1 text-xs text-red-700">La fin doit être postérieure au début.</p> }
            </div>
            <div>
              <label for="m-tjm" class="label">TJM (€ HT)</label>
              <div class="relative"><input id="m-tjm" type="number" min="0" step="10" class="input pr-10" formControlName="tjm" /><span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-soft">€</span></div>
            </div>
            <div>
              <p class="label" id="couleur-label">Couleur dans la saisie</p>
              <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="couleur-label">
                @for (c of colors; track c) {
                  <button type="button" role="radio" [attr.aria-checked]="form.controls.color.value.toLowerCase() === c.toLowerCase()" [attr.aria-label]="'Couleur ' + c"
                          class="h-7 w-7 rounded-full ring-offset-2 transition" [style.background]="c"
                          [class.ring-2]="form.controls.color.value.toLowerCase() === c.toLowerCase()" [class.ring-ink]="form.controls.color.value.toLowerCase() === c.toLowerCase()"
                          (click)="form.controls.color.setValue(c)"></button>
                }
                <label class="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-dashed border-slate-300 text-ink-soft" title="Autre couleur">
                  <ng-icon name="lucidePlus" size="12" aria-hidden="true" />
                  <input type="color" class="absolute inset-0 cursor-pointer opacity-0" formControlName="color" aria-label="Autre couleur" />
                </label>
              </div>
            </div>
          </div>
        </section>

        <!-- 2. Validation client -->
        <section aria-labelledby="sec-validation">
          <h3 id="sec-validation" class="section-title"><span class="section-num">2</span> Validation client et astreintes</h3>
          <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
            <div>
              <p class="text-sm font-medium text-ink">Validation client exigée par le contrat</p>
              <p class="text-xs text-ink-soft">À chaque soumission, le valideur reçoit un lien pour valider ou rejeter les jours de cette mission.</p>
            </div>
            <app-switch label="Validation client exigée par le contrat" [checked]="validation()" (checkedChange)="form.controls.clientValidation.setValue($event)" />
          </div>
          @if (validation()) {
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label for="m-vname" class="label">Nom du valideur</label>
                <input id="m-vname" class="input" formControlName="validatorName" [attr.aria-invalid]="showErr('validatorName')" />
                @if (showErr('validatorName')) { <p class="mt-1 text-xs text-red-700">Nom du valideur obligatoire.</p> }
              </div>
              <div>
                <label for="m-vemail" class="label">Email du valideur</label>
                <input id="m-vemail" type="email" class="input" formControlName="validatorEmail" [attr.aria-invalid]="showErr('validatorEmail')" />
                @if (showErr('validatorEmail')) { <p class="mt-1 text-xs text-red-700">Email du valideur obligatoire et valide.</p> }
              </div>
            </div>
          }

          <div class="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
            <div>
              <p class="flex items-center gap-1.5 text-sm font-medium text-ink"><ng-icon name="lucideSiren" size="14" class="text-red-600" aria-hidden="true" /> Astreintes</p>
              <p class="text-xs text-ink-soft">Le consultant peut déclarer des jours d’astreinte et ses interventions (heures), y compris les week-ends et jours fériés.</p>
            </div>
            <app-switch label="Astreintes possibles sur cette mission" [checked]="onCall()" (checkedChange)="form.controls.onCall.setValue($event)" />
          </div>
        </section>

        <!-- 3. Activités -->
        <section aria-labelledby="sec-activites">
          <h3 id="sec-activites" class="section-title"><span class="section-num">3</span> Activités</h3>
          <p class="mb-2 text-xs text-ink-soft">Ce que le consultant pourra saisir sur cette mission (ex. Développement, Réunion, Formation). Le code court (DEV, REU…) s’affiche dans les cases du calendrier ; cliquez dessus pour le changer.</p>
          <ul class="flex flex-wrap gap-2">
            @for (a of mission()?.activities ?? []; track a.id) {
              <li class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs" [class]="a.active ? 'border-slate-300 bg-white' : 'border-dashed border-slate-300 text-ink-soft'">
                <span class="h-2 w-2 rounded-full" [style.background]="a.active ? form.controls.color.value : '#CBD5E1'" aria-hidden="true"></span>
                <button type="button" class="rounded bg-slate-100 px-1 font-mono text-[10px] font-semibold leading-4 text-ink hover:bg-orchid-50 hover:text-orchid-700" (click)="editCode(a)"
                        [attr.aria-label]="'Code de ' + a.label + ' : ' + a.code + ', modifier'" title="Modifier le code court">{{ a.code }}</button>
                <span [class.line-through]="!a.active">{{ a.label }}</span>
                <button type="button" class="ml-1 text-ink-soft hover:text-ink" (click)="toggleActivity(a)" [attr.aria-label]="(a.active ? 'Désactiver ' : 'Réactiver ') + a.label" [title]="a.active ? 'Désactiver' : 'Réactiver'">
                  <ng-icon [name]="a.active ? 'lucideX' : 'lucideRotateCcw'" size="12" />
                </button>
              </li>
            }
            @for (label of newActivities(); track label) {
              <li class="flex items-center gap-1.5 rounded-full border border-orchid-200 bg-orchid-50 px-3 py-1 text-xs">
                <span class="h-2 w-2 rounded-full" [style.background]="form.controls.color.value" aria-hidden="true"></span>{{ label }}
                <span class="text-[10px] text-orchid-700">nouvelle</span>
                <button type="button" class="ml-1 text-ink-soft hover:text-ink" (click)="removeNew(label)" [attr.aria-label]="'Retirer ' + label"><ng-icon name="lucideX" size="12" /></button>
              </li>
            }
          </ul>
          <div class="mt-3 flex gap-2">
            <input #act class="input" placeholder="Nouvelle activité, puis Entrée" aria-label="Nouvelle activité" (keydown.enter)="$event.preventDefault(); addNew(act.value); act.value = ''" />
            <button type="button" class="btn-secondary shrink-0" (click)="addNew(act.value); act.value = ''"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Ajouter</button>
          </div>
          @if (!mission() && !newActivities().length) { <p class="mt-2 text-xs text-ink-soft">Sans activité saisie, une activité « Prestation » est créée.</p> }
        </section>

        <!-- 4. Jours non ouvrés -->
        <section aria-labelledby="sec-calendrier-m">
          <h3 id="sec-calendrier-m" class="section-title"><span class="section-num">4</span> Jours non ouvrés</h3>
          <p class="mb-3 text-xs text-ink-soft">« Global » applique l’onglet Paramètres. Les absences restent toujours interdites ces jours-là.</p>
          <div class="space-y-3 rounded-xl border border-slate-200 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-medium">Week-ends</span>
              <app-segmented label="Week-ends" [options]="policyOptions" [value]="form.controls.weekendPolicy.value" (valueChange)="form.controls.weekendPolicy.setValue($event)" />
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-medium">Jours fériés</span>
              <app-segmented label="Jours fériés" [options]="policyOptions" [value]="form.controls.holidayPolicy.value" (valueChange)="form.controls.holidayPolicy.setValue($event)" />
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-medium">Calendrier</span>
              <app-segmented label="Calendrier des jours fériés" [options]="regionOptions" [value]="form.controls.holidayRegion.value" (valueChange)="form.controls.holidayRegion.setValue($event)" />
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span class="text-sm font-medium">Fériés travaillés propres à la mission</span>
              <app-switch label="Fériés travaillés propres à la mission" [checked]="overrideWorked()" (checkedChange)="form.controls.overrideWorkedHolidays.setValue($event)" />
            </div>
            @if (overrideWorked()) {
              <div class="flex flex-wrap gap-1.5" role="group" aria-label="Jours fériés travaillés">
                @for (code of holidayCodes; track code) {
                  <button type="button" (click)="toggleWorked(code)" [attr.aria-pressed]="worked().includes(code)"
                          class="rounded-full border px-2.5 py-1 text-xs transition-colors"
                          [class]="worked().includes(code) ? 'border-orchid bg-orchid-50 text-orchid-700' : 'border-slate-200 text-ink-soft hover:border-slate-300'">
                    {{ holidayLabels[code] }}
                  </button>
                }
              </div>
            }
            <p class="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-ink-soft" aria-live="polite">
              <ng-icon name="lucideInfo" size="14" class="mt-0.5 shrink-0 text-orchid" aria-hidden="true" /> {{ effectiveRules() }}
            </p>
          </div>
        </section>

        <!-- 5. Contrat de prestation -->
        <section aria-labelledby="sec-prestation">
          <h3 id="sec-prestation" class="section-title"><span class="section-num">5</span> Contrat de prestation</h3>
          <p class="mb-3 text-xs text-ink-soft">Repris dans le contrat de prestation envoyé au client.</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label for="m-purpose" class="label">Objet de la prestation</label>
              <textarea id="m-purpose" class="input min-h-20" formControlName="purpose" maxlength="2000" placeholder="Ex. : Refonte de la plateforme de paiement"></textarea>
            </div>
            <div class="sm:col-span-2">
              <label for="m-location" class="label">Lieu d’exécution</label>
              <input id="m-location" class="input" formControlName="location" maxlength="200" placeholder="Ex. : Paris, 2 jours de télétravail par semaine" />
            </div>
            <div class="sm:col-span-2">
              <label for="m-terms" class="label">Modalités d’exécution <span class="font-normal text-ink-soft">(facultatif)</span></label>
              <textarea id="m-terms" class="input min-h-20" formControlName="terms" maxlength="2000" placeholder="Ex. : régie, horaires, astreintes, matériel fourni…"></textarea>
            </div>
            <div>
              <label for="m-payment" class="label">Délai de paiement</label>
              <div class="relative">
                <input id="m-payment" type="number" min="0" max="60" step="1" class="input pr-14" formControlName="paymentTermsDays" [attr.aria-invalid]="showCtl('paymentTermsDays')" aria-describedby="m-payment-aide" />
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-soft">jours</span>
              </div>
              <p id="m-payment-aide" class="mt-1 text-xs" [class]="showCtl('paymentTermsDays') ? 'text-red-700' : 'text-ink-soft'">60 jours au plus après la date de facture.</p>
            </div>
          </div>
        </section>
      </div>

      <footer class="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
        @if (error()) {
          <p class="flex w-full items-start gap-2 text-sm text-red-700" role="alert"><ng-icon name="lucideCircleAlert" size="16" class="mt-0.5 shrink-0" aria-hidden="true" />{{ error() }}</p>
        }
        @if (mission(); as m) {
          <button type="button" class="btn-ghost mr-auto text-xs" [class.text-red-700]="m.active" (click)="toggleMission(m)">{{ m.active ? 'Désactiver la mission' : 'Réactiver la mission' }}</button>
        }
        <button type="button" class="btn-secondary" (click)="cancelled.emit()">Annuler</button>
        <button type="submit" class="btn-primary" [disabled]="busy()">
          <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideSave'" size="16" [class.animate-spin]="busy()" aria-hidden="true" /> {{ mission() ? 'Enregistrer' : 'Créer la mission' }}
        </button>
      </footer>
    </form>
  `,
})
export class MissionForm implements OnInit {
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);

  readonly mission = input<Mission | null>(null);
  readonly consultants = input<AdminUser[]>([]);
  readonly clients = input<Client[]>([]);
  /** Paramétrage global, pour afficher les règles effectives (facultatif). */
  readonly settings = input<AppSettings | null>(null);
  /** Mission créée / enregistrée / (dés)activée : le parent ferme le formulaire. */
  readonly saved = output<void>();
  /** Activité (dés)activée : le parent recharge la mission, le formulaire reste ouvert. */
  readonly changed = output<void>();
  readonly cancelled = output<void>();

  protected readonly holidayCodes = HOLIDAY_CODES;
  protected readonly holidayLabels = HOLIDAY_LABELS;
  protected readonly colors = MISSION_COLORS;
  protected readonly policyOptions = POLICY_OPTIONS;
  protected readonly regionOptions = REGION_OPTIONS;
  protected readonly newActivities = signal<string[]>([]);
  protected readonly worked = signal<HolidayCode[]>([]);
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      consultantId: [''],
      clientId: [''],
      label: ['', [Validators.required, Validators.maxLength(120)]],
      startDate: ['', Validators.required],
      endDate: [''],
      tjm: [null as number | null, [Validators.min(0)]],
      color: [MISSION_COLORS[0]],
      clientValidation: [false],
      validatorName: [''],
      validatorEmail: [''],
      onCall: [false],
      weekendPolicy: ['' as Inherit<DayPolicy>],
      holidayPolicy: ['' as Inherit<DayPolicy>],
      holidayRegion: ['' as Inherit<HolidayRegion>],
      overrideWorkedHolidays: [false],
      purpose: ['', Validators.maxLength(2000)],
      location: ['', Validators.maxLength(200)],
      terms: ['', Validators.maxLength(2000)],
      paymentTermsDays: [null as number | null, [Validators.min(0), Validators.max(60)]],
    },
    { validators: missionRules },
  );

  private readonly values$ = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly validation = computed(() => !!this.values$().clientValidation);
  protected readonly overrideWorked = computed(() => !!this.values$().overrideWorkedHolidays);
  protected readonly onCall = computed(() => !!this.values$().onCall);

  /** Règles effectives en clair (réglage de la mission, sinon réglage global). */
  protected readonly effectiveRules = computed(() => {
    const v = this.values$();
    const g = this.settings()?.calendar;
    const we = v.weekendPolicy || g?.weekendPolicy;
    const hol = v.holidayPolicy || g?.holidayPolicy;
    const region = v.holidayRegion || g?.holidayRegion;
    const worked = v.overrideWorkedHolidays ? this.worked() : (g?.workedHolidays ?? []);
    if (!we || !hol) return 'Règles du paramétrage global.';
    const parts = [
      we === 'AUTORISE' ? 'week-ends saisissables' : 'week-ends interdits',
      hol === 'AUTORISE' ? 'jours fériés saisissables' : worked.length ? `fériés interdits sauf ${worked.map((c) => HOLIDAY_LABELS[c]).join(', ')}` : 'jours fériés interdits',
      `calendrier ${region === 'alsace-moselle' ? 'Alsace-Moselle' : 'Métropole'}`,
    ];
    return `Résultat pour cette mission : ${parts.join(', ')}.`;
  });

  ngOnInit(): void {
    const m = this.mission();
    if (m) {
      this.form.patchValue({
        label: m.label,
        startDate: m.startDate,
        endDate: m.endDate ?? '',
        tjm: m.tjm,
        color: m.activities[0]?.color ?? MISSION_COLORS[0],
        clientValidation: m.clientValidation,
        validatorName: m.validatorName ?? '',
        validatorEmail: m.validatorEmail ?? '',
        onCall: m.onCall,
        weekendPolicy: m.weekendPolicy ?? '',
        holidayPolicy: m.holidayPolicy ?? '',
        holidayRegion: m.holidayRegion ?? '',
        overrideWorkedHolidays: m.workedHolidays !== null,
        purpose: m.purpose ?? '',
        location: m.location ?? '',
        terms: m.terms ?? '',
        paymentTermsDays: m.paymentTermsDays,
      });
      this.worked.set(m.workedHolidays ?? []);
    } else {
      this.form.controls.consultantId.addValidators(Validators.required);
      this.form.controls.clientId.addValidators(Validators.required);
      this.form.updateValueAndValidity();
    }
  }

  protected showErr(key: string): boolean {
    return this.submitted() && !!this.form.errors?.[key];
  }

  protected showCtl(name: 'consultantId' | 'clientId' | 'label' | 'startDate' | 'paymentTermsDays'): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  addNew(label: string): void {
    const l = label.trim();
    if (l && !this.newActivities().includes(l) && !this.mission()?.activities.some((a) => a.label === l)) this.newActivities.update((x) => [...x, l]);
  }

  removeNew(label: string): void {
    this.newActivities.update((x) => x.filter((l) => l !== label));
  }

  toggleWorked(code: HolidayCode): void {
    this.worked.update((w) => (w.includes(code) ? w.filter((c) => c !== code) : [...w, code]));
    this.form.markAsDirty();
  }

  private values(): MissionInput {
    const v = this.form.getRawValue();
    return {
      label: v.label.trim(),
      startDate: v.startDate,
      endDate: v.endDate || null,
      tjm: v.tjm === null || (v.tjm as unknown) === '' ? null : Number(v.tjm),
      clientValidation: v.clientValidation,
      validatorName: v.clientValidation ? v.validatorName.trim() : v.validatorName.trim() || null,
      validatorEmail: v.clientValidation ? v.validatorEmail.trim() : v.validatorEmail.trim() || null,
      onCall: v.onCall,
      weekendPolicy: v.weekendPolicy || null,
      holidayPolicy: v.holidayPolicy || null,
      holidayRegion: v.holidayRegion || null,
      workedHolidays: v.overrideWorkedHolidays ? this.worked() : null,
      purpose: v.purpose.trim() || null,
      location: v.location.trim() || null,
      terms: v.terms.trim() || null,
      paymentTermsDays: v.paymentTermsDays === null || (v.paymentTermsDays as unknown) === '' ? null : Number(v.paymentTermsDays),
    };
  }

  async save(): Promise<void> {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set('Complétez ou corrigez les champs encadrés en rouge.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const v = this.form.getRawValue();
      const m = this.mission();
      if (m) await this.api.updateMission(m.id, { ...this.values(), color: v.color, addActivities: this.newActivities() });
      else await this.api.createMission({ ...this.values(), consultantId: v.consultantId, clientId: v.clientId, color: v.color, activities: this.newActivities() });
      this.saved.emit();
    } catch (err) {
      const e = apiError(err);
      this.error.set(e.error + (e.details?.length ? ` (${e.details.join(' ; ')})` : ''));
    } finally {
      this.busy.set(false);
    }
  }

  /** Code court d'une activité existante (unique dans la mission et parmi les absences). */
  async editCode(a: Mission['activities'][number]): Promise<void> {
    const value = (
      await this.confirm.prompt({
        title: `Code court de « ${a.label} »`,
        message: `Affiché dans les cases du calendrier du consultant. ${ACTIVITY_CODE_HINT}.`,
        confirmLabel: 'Enregistrer',
        input: { label: 'Code', required: true, initial: a.code },
      })
    )
      ?.trim()
      .toUpperCase();
    if (!value || value === a.code) return;
    if (!ACTIVITY_CODE_RE.test(value)) {
      this.error.set(`Code « ${value} » invalide : ${ACTIVITY_CODE_HINT}.`);
      return;
    }
    try {
      await this.api.updateActivity(a.id, { code: value });
      this.changed.emit();
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  async toggleActivity(a: Mission['activities'][number]): Promise<void> {
    try {
      await this.api.updateActivity(a.id, { active: !a.active });
      this.changed.emit();
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  async toggleMission(m: Mission): Promise<void> {
    try {
      await this.api.updateMission(m.id, { active: !m.active });
      this.saved.emit();
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }
}
