import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import type { AppSettings, Completeness, DayPolicy, SubmissionOpening } from '@shared/settings';
import { HOLIDAY_CODES, HOLIDAY_LABELS, type HolidayCode, type HolidayRegion } from '@shared/holidays';
import { Api, apiError } from '../../core/api';

/** Paramétrage global : jours non ouvrés et règles de soumission. */
@Component({
  selector: 'app-admin-settings',
  imports: [ReactiveFormsModule, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" class="grid gap-5 lg:grid-cols-2" aria-label="Paramétrage">
      <fieldset class="card p-5">
        <legend class="sr-only">Calendrier</legend>
        <h3 class="mb-1 font-semibold">Jours non ouvrés</h3>
        <p class="mb-4 text-xs text-ink-soft">Valeurs par défaut, modifiables mission par mission. Les absences ne sont jamais saisissables ces jours-là.</p>
        <div class="grid gap-3 sm:grid-cols-3">
          <div><label for="s-we" class="label">Week-ends</label><select id="s-we" class="input" formControlName="weekendPolicy"><option value="INTERDIT">Interdits</option><option value="AUTORISE">Autorisés</option></select></div>
          <div><label for="s-hol" class="label">Jours fériés</label><select id="s-hol" class="input" formControlName="holidayPolicy"><option value="INTERDIT">Interdits</option><option value="AUTORISE">Autorisés</option></select></div>
          <div><label for="s-reg" class="label">Calendrier</label><select id="s-reg" class="input" formControlName="holidayRegion"><option value="metropole">Métropole</option><option value="alsace-moselle">Alsace-Moselle</option></select></div>
        </div>
        <p class="label mt-4">Jours fériés travaillés par exception</p>
        <div class="flex flex-wrap gap-x-4 gap-y-1">
          @for (code of holidayCodes; track code) {
            <label class="flex items-center gap-1.5 text-xs"><input type="checkbox" class="accent-orchid" [checked]="worked().includes(code)" (change)="toggleWorked(code)" /> {{ holidayLabels[code] }}</label>
          }
        </div>
      </fieldset>

      <fieldset class="card p-5">
        <legend class="sr-only">Soumission</legend>
        <h3 class="mb-4 font-semibold">Soumission des CRA</h3>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label for="s-open" class="label">Ouverture pour le mois en cours</label>
            <select id="s-open" class="input" formControlName="opening">
              <option value="TOUJOURS">Dès le 1er du mois</option>
              <option value="DERNIERS_JOURS_OUVRES">Les N derniers jours ouvrés</option>
              <option value="FIN_DE_MOIS">À partir du dernier jour ouvré</option>
            </select>
          </div>
          @if (form.controls.opening.value === 'DERNIERS_JOURS_OUVRES') {
            <div><label for="s-n" class="label">N (jours ouvrés)</label><input id="s-n" type="number" min="1" max="15" class="input" formControlName="opensDays" /></div>
          }
          <div>
            <label for="s-comp" class="label">Jours ouvrés non renseignés</label>
            <select id="s-comp" class="input" formControlName="completeness"><option value="AVERTIR">Avertir</option><option value="BLOQUER">Bloquer la soumission</option></select>
          </div>
          <div><label for="s-past" class="label">Mois passés modifiables</label><input id="s-past" type="number" min="0" max="24" class="input" formControlName="pastMonthsLimit" /></div>
          <div><label for="s-dead" class="label">Date limite (Nème jour ouvré du mois suivant)</label><input id="s-dead" type="number" min="1" max="15" class="input" formControlName="deadlineWorkingDay" /></div>
          <label class="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" class="h-4 w-4 accent-orchid" formControlName="futureMonths" /> Autoriser la soumission des mois futurs</label>
        </div>
      </fieldset>

      <div class="flex items-center justify-end gap-3 lg:col-span-2">
        <span class="text-sm" aria-live="polite" [class.text-red-700]="!!error()" [class.text-emerald-700]="!error()">{{ error() ?? message() }}</span>
        <button type="submit" class="btn-primary" [disabled]="busy() || form.invalid"><ng-icon name="lucideSave" size="16" aria-hidden="true" /> Enregistrer</button>
      </div>
    </form>
  `,
})
export class AdminSettings implements OnInit {
  private readonly api = inject(Api);
  protected readonly holidayCodes = HOLIDAY_CODES;
  protected readonly holidayLabels = HOLIDAY_LABELS;
  protected readonly worked = signal<HolidayCode[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal('');

  protected readonly form = inject(NonNullableFormBuilder).group({
    weekendPolicy: ['INTERDIT' as DayPolicy],
    holidayPolicy: ['INTERDIT' as DayPolicy],
    holidayRegion: ['metropole' as HolidayRegion],
    opening: ['DERNIERS_JOURS_OUVRES' as SubmissionOpening],
    opensDays: [3, [Validators.required, Validators.min(1), Validators.max(15)]],
    futureMonths: [false],
    completeness: ['AVERTIR' as Completeness],
    pastMonthsLimit: [3, [Validators.required, Validators.min(0), Validators.max(24)]],
    deadlineWorkingDay: [3, [Validators.required, Validators.min(1), Validators.max(15)]],
  });

  async ngOnInit(): Promise<void> {
    try {
      this.apply(await this.api.settings());
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  private apply(s: AppSettings): void {
    this.form.setValue({ ...s.submission, weekendPolicy: s.calendar.weekendPolicy, holidayPolicy: s.calendar.holidayPolicy, holidayRegion: s.calendar.holidayRegion });
    this.worked.set(s.calendar.workedHolidays);
  }

  toggleWorked(code: HolidayCode): void {
    this.worked.update((w) => (w.includes(code) ? w.filter((c) => c !== code) : [...w, code]));
  }

  async save(): Promise<void> {
    const v = this.form.getRawValue();
    const settings: AppSettings = {
      calendar: { weekendPolicy: v.weekendPolicy, holidayPolicy: v.holidayPolicy, holidayRegion: v.holidayRegion, workedHolidays: this.worked() },
      submission: {
        opening: v.opening,
        opensDays: Number(v.opensDays),
        futureMonths: v.futureMonths,
        completeness: v.completeness,
        pastMonthsLimit: Number(v.pastMonthsLimit),
        deadlineWorkingDay: Number(v.deadlineWorkingDay),
      },
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      this.apply(await this.api.saveSettings(settings));
      this.message.set('Paramétrage enregistré.');
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }
}
