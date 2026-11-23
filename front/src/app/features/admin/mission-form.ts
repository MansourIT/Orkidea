import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { type AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import type { AdminUser, Client, HolidayCode, Mission } from '@shared/types';
import type { DayPolicy } from '@shared/settings';
import { HOLIDAY_CODES, HOLIDAY_LABELS, type HolidayRegion } from '@shared/holidays';
import { Api, apiError, type MissionInput } from '../../core/api';

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

/** Création / modification d'une mission (contrat consultant ↔ client) et de ses activités. */
@Component({
  selector: 'app-mission-form',
  imports: [ReactiveFormsModule, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" class="grid gap-4" [attr.aria-label]="mission() ? 'Modifier la mission' : 'Nouvelle mission'" novalidate>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        @if (!mission()) {
          <div>
            <label for="m-consultant" class="label">Consultant</label>
            <select id="m-consultant" class="input" formControlName="consultantId">
              <option value="">— Choisir —</option>
              @for (u of consultants(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
            </select>
          </div>
          <div>
            <label for="m-client" class="label">Client</label>
            <select id="m-client" class="input" formControlName="clientId">
              <option value="">— Choisir —</option>
              @for (c of clients(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select>
          </div>
        }
        <div [class.lg:col-span-2]="!mission()" [class.lg:col-span-4]="!!mission()">
          <label for="m-label" class="label">Intitulé de la mission</label>
          <input id="m-label" class="input" formControlName="label" placeholder="Ex. : Projet Alpha" />
        </div>
        <div><label for="m-start" class="label">Début</label><input id="m-start" type="date" class="input" formControlName="startDate" /></div>
        <div><label for="m-end" class="label">Fin <span class="font-normal text-ink-soft">(facultatif)</span></label><input id="m-end" type="date" class="input" formControlName="endDate" /></div>
        <div><label for="m-tjm" class="label">TJM (€ HT)</label><input id="m-tjm" type="number" min="0" step="10" class="input" formControlName="tjm" /></div>
        <div><label for="m-color" class="label">Couleur</label><input id="m-color" type="color" class="input h-10 p-1" formControlName="color" /></div>
      </div>

      <fieldset class="rounded-xl border border-slate-200 p-4">
        <legend class="px-1 text-sm font-semibold">Validation client</legend>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="h-4 w-4 accent-orchid" formControlName="clientValidation" /> Validation client exigée par le contrat
        </label>
        @if (form.controls.clientValidation.value) {
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label for="m-vname" class="label">Nom du valideur</label>
              <input id="m-vname" class="input" formControlName="validatorName" [attr.aria-invalid]="showErr('validatorName')" />
              @if (showErr('validatorName')) { <p class="mt-1 text-sm text-red-700">Nom du valideur obligatoire.</p> }
            </div>
            <div>
              <label for="m-vemail" class="label">Email du valideur</label>
              <input id="m-vemail" type="email" class="input" formControlName="validatorEmail" [attr.aria-invalid]="showErr('validatorEmail')" />
              @if (showErr('validatorEmail')) { <p class="mt-1 text-sm text-red-700">Email du valideur obligatoire et valide.</p> }
            </div>
          </div>
        }
      </fieldset>

      <fieldset class="rounded-xl border border-slate-200 p-4">
        <legend class="px-1 text-sm font-semibold">Activités</legend>
        <ul class="flex flex-wrap gap-2">
          @for (a of mission()?.activities ?? []; track a.id) {
            <li class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs" [class]="a.active ? 'border-slate-300' : 'border-dashed border-slate-300 text-ink-soft line-through'">
              <span class="h-2 w-2 rounded-full" [style.background]="a.color" aria-hidden="true"></span>{{ a.label }}
              <button type="button" class="ml-1 text-ink-soft hover:text-ink" (click)="toggleActivity(a)" [attr.aria-label]="(a.active ? 'Désactiver ' : 'Réactiver ') + a.label">
                <ng-icon [name]="a.active ? 'lucideX' : 'lucideRotateCcw'" size="12" />
              </button>
            </li>
          }
          @for (label of newActivities(); track label) {
            <li class="flex items-center gap-1.5 rounded-full border border-orchid-200 bg-orchid-50 px-3 py-1 text-xs">
              {{ label }}
              <button type="button" class="ml-1 text-ink-soft hover:text-ink" (click)="removeNew(label)" [attr.aria-label]="'Retirer ' + label"><ng-icon name="lucideX" size="12" /></button>
            </li>
          }
        </ul>
        <div class="mt-3 flex gap-2">
          <input #act class="input max-w-xs" placeholder="Ex. : Développement" aria-label="Nouvelle activité" (keydown.enter)="$event.preventDefault(); addNew(act.value); act.value = ''" />
          <button type="button" class="btn-secondary" (click)="addNew(act.value); act.value = ''"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Ajouter</button>
        </div>
        @if (!mission() && !newActivities().length) { <p class="mt-2 text-xs text-ink-soft">Sans activité saisie, une activité « Prestation » est créée.</p> }
      </fieldset>

      <fieldset class="rounded-xl border border-slate-200 p-4">
        <legend class="px-1 text-sm font-semibold">Jours non ouvrés (contrat)</legend>
        <p class="mb-3 text-xs text-ink-soft">« Paramétrage global » applique le réglage de l’onglet Paramètres. Les absences restent toujours interdites ces jours-là.</p>
        <div class="grid gap-3 sm:grid-cols-3">
          <div>
            <label for="m-we" class="label">Week-ends</label>
            <select id="m-we" class="input" formControlName="weekendPolicy"><option value="">Paramétrage global</option><option value="INTERDIT">Interdits</option><option value="AUTORISE">Autorisés</option></select>
          </div>
          <div>
            <label for="m-hol" class="label">Jours fériés</label>
            <select id="m-hol" class="input" formControlName="holidayPolicy"><option value="">Paramétrage global</option><option value="INTERDIT">Interdits</option><option value="AUTORISE">Autorisés</option></select>
          </div>
          <div>
            <label for="m-region" class="label">Calendrier</label>
            <select id="m-region" class="input" formControlName="holidayRegion"><option value="">Paramétrage global</option><option value="metropole">Métropole</option><option value="alsace-moselle">Alsace-Moselle</option></select>
          </div>
        </div>
        <label class="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4 accent-orchid" formControlName="overrideWorkedHolidays" /> Fériés travaillés propres à cette mission</label>
        @if (form.controls.overrideWorkedHolidays.value) {
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            @for (code of holidayCodes; track code) {
              <label class="flex items-center gap-1.5 text-xs"><input type="checkbox" class="accent-orchid" [checked]="worked().includes(code)" (change)="toggleWorked(code)" /> {{ holidayLabels[code] }}</label>
            }
          </div>
        }
      </fieldset>

      @if (showErr('dates')) { <p class="text-sm text-red-700">La date de fin doit être postérieure à la date de début.</p> }
      @if (error()) { <p class="alert-error" role="alert">{{ error() }}</p> }

      <div class="flex flex-wrap justify-end gap-2">
        @if (mission(); as m) {
          <button type="button" class="btn-ghost mr-auto" (click)="toggleMission(m)">{{ m.active ? 'Désactiver la mission' : 'Réactiver la mission' }}</button>
        }
        <button type="button" class="btn-secondary" (click)="cancelled.emit()">Annuler</button>
        <button type="submit" class="btn-primary" [disabled]="busy()">{{ mission() ? 'Enregistrer' : 'Créer la mission' }}</button>
      </div>
    </form>
  `,
})
export class MissionForm implements OnInit {
  private readonly api = inject(Api);

  readonly mission = input<Mission | null>(null);
  readonly consultants = input<AdminUser[]>([]);
  readonly clients = input<Client[]>([]);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  protected readonly holidayCodes = HOLIDAY_CODES;
  protected readonly holidayLabels = HOLIDAY_LABELS;
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
      color: ['#3B82F6'],
      clientValidation: [false],
      validatorName: [''],
      validatorEmail: [''],
      weekendPolicy: ['' as Inherit<DayPolicy>],
      holidayPolicy: ['' as Inherit<DayPolicy>],
      holidayRegion: ['' as Inherit<HolidayRegion>],
      overrideWorkedHolidays: [false],
    },
    { validators: missionRules },
  );

  ngOnInit(): void {
    const m = this.mission();
    if (m) {
      this.form.patchValue({
        label: m.label,
        startDate: m.startDate,
        endDate: m.endDate ?? '',
        tjm: m.tjm,
        color: m.activities[0]?.color ?? '#3B82F6',
        clientValidation: m.clientValidation,
        validatorName: m.validatorName ?? '',
        validatorEmail: m.validatorEmail ?? '',
        weekendPolicy: m.weekendPolicy ?? '',
        holidayPolicy: m.holidayPolicy ?? '',
        holidayRegion: m.holidayRegion ?? '',
        overrideWorkedHolidays: m.workedHolidays !== null,
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

  addNew(label: string): void {
    const l = label.trim();
    if (l && !this.newActivities().includes(l) && !this.mission()?.activities.some((a) => a.label === l)) this.newActivities.update((x) => [...x, l]);
  }

  removeNew(label: string): void {
    this.newActivities.update((x) => x.filter((l) => l !== label));
  }

  toggleWorked(code: HolidayCode): void {
    this.worked.update((w) => (w.includes(code) ? w.filter((c) => c !== code) : [...w, code]));
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
      weekendPolicy: v.weekendPolicy || null,
      holidayPolicy: v.holidayPolicy || null,
      holidayRegion: v.holidayRegion || null,
      workedHolidays: v.overrideWorkedHolidays ? this.worked() : null,
    };
  }

  async save(): Promise<void> {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set(this.form.errors ? null : 'Complétez les champs obligatoires (consultant, client, intitulé, début).');
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
      this.error.set(apiError(err).error + (apiError(err).details?.length ? ` (${apiError(err).details!.join(' ; ')})` : ''));
    } finally {
      this.busy.set(false);
    }
  }

  async toggleActivity(a: Mission['activities'][number]): Promise<void> {
    try {
      await this.api.updateActivity(a.id, { active: !a.active });
      this.saved.emit();
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
