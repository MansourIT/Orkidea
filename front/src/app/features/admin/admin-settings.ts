import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { DEFAULT_SETTINGS, type AppSettings, type CalendarSettings, type Completeness, type DayPolicy, type SubmissionOpening, type SubmissionSettings } from '@shared/settings';
import { WEEKDAY_NAMES, frDate, todayInParis } from '@shared/dates';
import { type HolidayCode, type HolidayRegion, holidayList } from '@shared/holidays';
import { Api, apiError } from '../../core/api';
import { Confirm } from '../../ui/confirm-dialog';
import { Segmented, type SegmentOption } from '../../ui/segmented';
import { Stepper } from '../../ui/stepper';
import { ToggleSwitch } from '../../ui/toggle-switch';
import { CompanySettingsCard } from './company-settings';
import { InvoiceSettingsCard } from './invoice-settings';
import { SettingsPreview } from './settings-preview';

const POLICIES: SegmentOption<DayPolicy>[] = [
  { value: 'INTERDIT', label: 'Interdits' },
  { value: 'AUTORISE', label: 'Autorisés' },
];
const REGIONS: SegmentOption<HolidayRegion>[] = [
  { value: 'metropole', label: 'Métropole' },
  { value: 'alsace-moselle', label: 'Alsace-Moselle' },
];
const COMPLETENESS: SegmentOption<Completeness>[] = [
  { value: 'AVERTIR', label: 'Avertir' },
  { value: 'BLOQUER', label: 'Bloquer' },
];
const OPENINGS: Array<{ value: SubmissionOpening; title: string; text: string }> = [
  { value: 'TOUJOURS', title: 'Dès le 1er du mois', text: 'Le consultant soumet quand il veut.' },
  { value: 'DERNIERS_JOURS_OUVRES', title: 'Les derniers jours ouvrés', text: 'Ouverture quelques jours avant la fin du mois.' },
  { value: 'FIN_DE_MOIS', title: 'Le dernier jour ouvré', text: 'Le mois doit être (presque) terminé.' },
];

const clone = (s: AppSettings): AppSettings => JSON.parse(JSON.stringify(s)) as AppSettings;
const same = (a: AppSettings, b: AppSettings) =>
  JSON.stringify({ ...a, calendar: { ...a.calendar, workedHolidays: [...a.calendar.workedHolidays].sort() } }) ===
  JSON.stringify({ ...b, calendar: { ...b.calendar, workedHolidays: [...b.calendar.workedHolidays].sort() } });

/** Paramétrage global : jours non ouvrés et règles de soumission, avec aperçu en direct. */
@Component({
  selector: 'app-admin-settings',
  imports: [NgIcon, Segmented, ToggleSwitch, Stepper, SettingsPreview, CompanySettingsCard, InvoiceSettingsCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    @if (!draft()) {
      <div class="card flex items-center justify-center gap-2 p-16 text-ink-soft" role="status">
        @if (error()) { <span class="text-red-700">{{ error() }}</span> }
        @else { <ng-icon name="lucideLoaderCircle" size="20" class="animate-spin" aria-hidden="true" /> Chargement… }
      </div>
    } @else {
      @let s = draft()!;
      <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">Paramètres</h2>
          <p class="text-sm text-ink-soft">Règles appliquées par défaut à tous les consultants. Chaque mission peut adapter les règles de calendrier.</p>
        </div>
        <button type="button" class="btn-ghost text-xs" (click)="resetDefaults()" [disabled]="isDefault()">
          <ng-icon name="lucideRotateCcw" size="14" aria-hidden="true" /> Valeurs par défaut
        </button>
      </div>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div class="space-y-6">
          <!-- ===================================================== Jours non ouvrés -->
          <section class="card overflow-hidden" aria-labelledby="sec-calendrier">
            <header class="flex items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orchid-50 text-orchid"><ng-icon name="lucideCalendarDays" size="18" aria-hidden="true" /></span>
              <div>
                <h3 id="sec-calendrier" class="font-semibold">Jours non ouvrés</h3>
                <p class="text-xs text-ink-soft">Peut-on saisir du travail un samedi, un dimanche ou un jour férié ? Les absences n’y sont jamais saisissables.</p>
              </div>
            </header>

            <div class="divide-y divide-slate-100">
              <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink">Week-ends</p>
                  <p class="text-xs text-ink-soft">{{ s.calendar.weekendPolicy === 'AUTORISE' ? 'Saisie possible le samedi et le dimanche (astreintes, mises en production…).' : 'Samedis et dimanches grisés dans la saisie.' }}</p>
                </div>
                <app-segmented label="Week-ends" [options]="policies" [value]="s.calendar.weekendPolicy" (valueChange)="setCal('weekendPolicy', $event)" />
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink">Jours fériés</p>
                  <p class="text-xs text-ink-soft">{{ s.calendar.holidayPolicy === 'AUTORISE' ? 'Tous les jours fériés sont saisissables.' : 'Jours fériés grisés, sauf ceux marqués « travaillé » ci-dessous.' }}</p>
                </div>
                <app-segmented label="Jours fériés" [options]="policies" [value]="s.calendar.holidayPolicy" (valueChange)="setCal('holidayPolicy', $event)" />
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink">Calendrier des jours fériés</p>
                  <p class="text-xs text-ink-soft">Alsace-Moselle ajoute le Vendredi saint et la Saint-Étienne (26 décembre).</p>
                </div>
                <app-segmented label="Calendrier des jours fériés" [options]="regions" [value]="s.calendar.holidayRegion" (valueChange)="setCal('holidayRegion', $event)" />
              </div>

              <div class="px-5 py-4">
                <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p class="text-sm font-medium text-ink">Jours fériés travaillés par exception</p>
                    <p class="text-xs text-ink-soft">
                      @if (s.calendar.holidayPolicy === 'AUTORISE') { Sans objet : tous les jours fériés sont déjà saisissables. }
                      @else { {{ workedCount() }} jour{{ workedCount() > 1 ? 's' : '' }} férié{{ workedCount() > 1 ? 's' : '' }} travaillé{{ workedCount() > 1 ? 's' : '' }} — ex. lundi de Pentecôte (journée de solidarité). }
                    </p>
                  </div>
                  <div class="flex items-center gap-1" role="group" aria-label="Année affichée">
                    <button type="button" class="btn-ghost p-1.5" (click)="year.set(year() - 1)" aria-label="Année précédente"><ng-icon name="lucideChevronLeft" size="16" /></button>
                    <span class="w-12 text-center text-sm font-semibold" aria-live="polite">{{ year() }}</span>
                    <button type="button" class="btn-ghost p-1.5" (click)="year.set(year() + 1)" aria-label="Année suivante"><ng-icon name="lucideChevronRight" size="16" /></button>
                  </div>
                </div>
                <ul class="grid gap-x-6 sm:grid-cols-2" [class.opacity-50]="s.calendar.holidayPolicy === 'AUTORISE'">
                  @for (h of holidays(); track h.code) {
                    <li class="flex items-center gap-3 border-b border-slate-100 py-2 last:border-0 sm:[&:nth-last-child(2)]:border-0">
                      <span class="w-20 shrink-0 text-xs text-ink-soft"><span class="capitalize">{{ h.weekday }}</span> {{ h.short }}</span>
                      <span class="min-w-0 flex-1 truncate text-sm text-ink">
                        {{ h.label }}
                        @if (h.onWeekend) { <span class="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-ink-soft">week-end</span> }
                      </span>
                      <app-switch
                        [label]="'Travaillé : ' + h.label"
                        [checked]="s.calendar.holidayPolicy === 'AUTORISE' || s.calendar.workedHolidays.includes(h.code)"
                        [disabled]="s.calendar.holidayPolicy === 'AUTORISE'"
                        (checkedChange)="toggleWorked(h.code, $event)"
                      />
                    </li>
                  }
                </ul>
              </div>
            </div>
          </section>

          <!-- ===================================================== Soumission -->
          <section class="card overflow-hidden" aria-labelledby="sec-soumission">
            <header class="flex items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orchid-50 text-orchid"><ng-icon name="lucideSend" size="18" aria-hidden="true" /></span>
              <div>
                <h3 id="sec-soumission" class="font-semibold">Soumission des CRA</h3>
                <p class="text-xs text-ink-soft">Quand le consultant peut-il soumettre son mois, et jusqu’à quand ?</p>
              </div>
            </header>

            <div class="divide-y divide-slate-100">
              <div class="px-5 py-4">
                <p id="ouverture-titre" class="text-sm font-medium text-ink">Ouverture de la soumission pour le mois en cours</p>
                <p class="mb-3 text-xs text-ink-soft">Les mois passés peuvent toujours être soumis.</p>
                <div class="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="ouverture-titre">
                  @for (o of openings; track o.value) {
                    <label
                      class="relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orchid"
                      [class]="s.submission.opening === o.value ? 'border-orchid bg-orchid-50 ring-1 ring-orchid' : 'border-slate-200 hover:border-slate-300'"
                    >
                      <input type="radio" name="ouverture" class="sr-only" [checked]="s.submission.opening === o.value" (change)="setSub('opening', o.value)" />
                      <span class="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
                        {{ o.title }}
                        @if (s.submission.opening === o.value) { <ng-icon name="lucideCircleCheck" size="16" class="text-orchid" aria-hidden="true" /> }
                      </span>
                      <span class="text-xs text-ink-soft">{{ o.text }}</span>
                    </label>
                  }
                </div>
                @if (s.submission.opening === 'DERNIERS_JOURS_OUVRES') {
                  <div class="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span>Ouverture</span>
                    <app-stepper label="Nombre de derniers jours ouvrés" [min]="1" [max]="15" [value]="s.submission.opensDays" (valueChange)="setSub('opensDays', $event)" />
                    <span>jour{{ s.submission.opensDays > 1 ? 's' : '' }} ouvré{{ s.submission.opensDays > 1 ? 's' : '' }} avant la fin du mois</span>
                  </div>
                }
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink">Jours ouvrés non renseignés</p>
                  <p class="text-xs text-ink-soft">{{ s.submission.completeness === 'BLOQUER' ? 'Soumission impossible tant que tous les jours ouvrés ne sont pas saisis.' : 'Le consultant est averti mais peut soumettre quand même.' }}</p>
                </div>
                <app-segmented label="Jours ouvrés non renseignés" [options]="completeness" [value]="s.submission.completeness" (valueChange)="setSub('completeness', $event)" />
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink">Mois passés encore modifiables</p>
                  <p class="text-xs text-ink-soft">Au-delà, un brouillon n’est plus modifiable (un CRA rejeté reste toujours corrigeable).</p>
                </div>
                <div class="flex items-center gap-2 text-sm"><app-stepper label="Mois passés modifiables" [min]="0" [max]="24" [value]="s.submission.pastMonthsLimit" (valueChange)="setSub('pastMonthsLimit', $event)" /> mois</div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink">Date limite de soumission</p>
                  <p class="text-xs text-ink-soft">Au-delà, le consultant apparaît « En retard » dans le suivi du mois.</p>
                </div>
                <div class="flex items-center gap-2 text-sm">
                  <app-stepper label="Date limite, en jours ouvrés après la fin du mois" [min]="1" [max]="15" [value]="s.submission.deadlineWorkingDay" (valueChange)="setSub('deadlineWorkingDay', $event)" />
                  jour{{ s.submission.deadlineWorkingDay > 1 ? 's' : '' }} ouvré{{ s.submission.deadlineWorkingDay > 1 ? 's' : '' }} après la fin du mois
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink">Soumission des mois futurs</p>
                  <p class="text-xs text-ink-soft">Utile pour un départ en congés de longue durée ; désactivé par défaut.</p>
                </div>
                <app-switch label="Autoriser la soumission des mois futurs" [checked]="s.submission.futureMonths" (checkedChange)="setSub('futureMonths', $event)" />
              </div>
            </div>
          </section>

          <!-- ===================================================== Société (contrats) -->
          <app-company-settings />

          <!-- ===================================================== Facturation -->
          <app-invoice-settings />
        </div>

        <aside class="lg:sticky lg:top-20">
          <app-settings-preview [settings]="s" [today]="today" />
          @if (savedAt()) {
            <p class="mt-3 flex items-center gap-1.5 text-xs text-emerald-700" role="status"><ng-icon name="lucideCircleCheck" size="14" aria-hidden="true" /> Enregistré à {{ savedAt() }}</p>
          }
        </aside>
      </div>

      <!-- Barre d'enregistrement : visible dès qu'il y a une modification -->
      @if (dirty() || error()) {
        <div class="h-20" aria-hidden="true"></div>
        <div class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-4px_12px_rgba(27,35,64,0.06)] backdrop-blur" role="region" aria-label="Enregistrement des paramètres">
          <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p class="flex items-center gap-2 text-sm" aria-live="polite">
              @if (error()) { <ng-icon name="lucideCircleAlert" size="16" class="text-red-600" aria-hidden="true" /><span class="text-red-700">{{ error() }}</span> }
              @else { <span class="h-2 w-2 rounded-full bg-amber" aria-hidden="true"></span><span class="font-medium text-ink">Modifications non enregistrées</span> }
            </p>
            <div class="flex gap-2">
              <button type="button" class="btn-secondary" (click)="cancel()" [disabled]="busy()">Annuler</button>
              <button type="button" class="btn-primary" (click)="save()" [disabled]="busy() || !dirty()">
                <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideSave'" size="16" [class.animate-spin]="busy()" aria-hidden="true" /> Enregistrer
              </button>
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class AdminSettings implements OnInit {
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  private readonly company = viewChild(CompanySettingsCard);
  private readonly invoicing = viewChild(InvoiceSettingsCard);

  protected readonly policies = POLICIES;
  protected readonly regions = REGIONS;
  protected readonly completeness = COMPLETENESS;
  protected readonly openings = OPENINGS;
  protected readonly today = todayInParis();

  private readonly saved = signal<AppSettings | null>(null);
  protected readonly draft = signal<AppSettings | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedAt = signal<string | null>(null);
  protected readonly year = signal(Number(this.today.slice(0, 4)));

  protected readonly dirty = computed(() => !!this.draft() && !!this.saved() && !same(this.draft()!, this.saved()!));
  protected readonly isDefault = computed(() => !!this.draft() && same(this.draft()!, DEFAULT_SETTINGS));
  protected readonly workedCount = computed(() => this.draft()?.calendar.workedHolidays.length ?? 0);

  /** Jours fériés de l'année affichée, pour le calendrier choisi. */
  protected readonly holidays = computed(() =>
    holidayList(this.year(), this.draft()?.calendar.holidayRegion ?? 'metropole').map((h) => {
      const js = new Date(`${h.date}T00:00:00Z`).getUTCDay();
      return { ...h, weekday: WEEKDAY_NAMES[js === 0 ? 7 : js].slice(0, 3) + '.', short: frDate(h.date).slice(0, 5), onWeekend: js === 0 || js === 6 };
    }),
  );

  async ngOnInit(): Promise<void> {
    try {
      const s = await this.api.settings();
      this.saved.set(clone(s));
      this.draft.set(clone(s));
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  protected setCal<K extends keyof CalendarSettings>(key: K, value: CalendarSettings[K]): void {
    this.draft.update((d) => d && { ...d, calendar: { ...d.calendar, [key]: value } });
    this.error.set(null);
  }

  protected setSub<K extends keyof SubmissionSettings>(key: K, value: SubmissionSettings[K]): void {
    this.draft.update((d) => d && { ...d, submission: { ...d.submission, [key]: value } });
    this.error.set(null);
  }

  protected toggleWorked(code: HolidayCode, on: boolean): void {
    const current = this.draft()?.calendar.workedHolidays ?? [];
    this.setCal('workedHolidays', on ? [...new Set([...current, code])] : current.filter((c) => c !== code));
  }

  async resetDefaults(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Revenir aux valeurs par défaut ?',
      message: 'Week-ends et fériés interdits, soumission les 3 derniers jours ouvrés, avertissement si des jours manquent, 3 mois modifiables, date limite au 3ᵉ jour ouvré. Rien n’est enregistré tant que vous ne cliquez pas sur « Enregistrer ».',
      confirmLabel: 'Appliquer',
    });
    if (ok) this.draft.set(clone(DEFAULT_SETTINGS));
  }

  cancel(): void {
    const s = this.saved();
    if (s) this.draft.set(clone(s));
    this.error.set(null);
  }

  async save(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const s = await this.api.saveSettings(d);
      this.saved.set(clone(s));
      this.draft.set(clone(s));
      this.savedAt.set(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      const e = apiError(err);
      this.error.set(e.details?.length ? `${e.error} : ${e.details.join(' ; ')}` : e.error);
    } finally {
      this.busy.set(false);
    }
  }

  /** Utilisé par la page d'administration avant de changer d'onglet. */
  hasUnsavedChanges(): boolean {
    return this.dirty() || !!this.company()?.dirty() || !!this.invoicing()?.dirty();
  }

  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) e.preventDefault();
  }
}
