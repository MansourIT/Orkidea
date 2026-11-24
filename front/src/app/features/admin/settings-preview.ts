import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { AppSettings } from '@shared/settings';
import { MONTH_NAMES, WEEKDAY_NAMES, addMonths, monthName, monthOf } from '@shared/dates';
import { monthDays } from '@shared/holidays';
import { submissionDeadline, submissionOpensOn } from '@shared/submission';
import { monthTitle } from '../../core/format';

const HEADERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** « jeudi 26 novembre » */
function longDate(date: string): string {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${WEEKDAY_NAMES[js === 0 ? 7 : js]} ${Number(date.slice(8))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]}`;
}

/** Aperçu en direct : ce que les réglages impliquent pour le mois en cours (mêmes fonctions que l'API). */
@Component({
  selector: 'app-settings-preview',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card p-5" aria-labelledby="apercu-titre">
      <h3 id="apercu-titre" class="flex items-center gap-2 font-semibold">
        <ng-icon name="lucideInfo" size="18" class="text-orchid" aria-hidden="true" /> Aperçu : {{ title() }}
      </h3>
      <p class="mt-0.5 text-xs text-ink-soft">Ce que vivront les consultants avec ces réglages.</p>

      <div class="mt-4" aria-hidden="true">
        <div class="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-ink-soft">
          @for (h of headers; track $index) { <span>{{ h }}</span> }
        </div>
        <div class="grid grid-cols-7 gap-1">
          @for (blank of blanks(); track $index) { <span></span> }
          @for (d of days(); track d.date) {
            <span
              class="flex aspect-square items-center justify-center rounded-md text-[11px] font-medium"
              [class]="d.cls"
              [class.ring-2]="d.date === today()"
              [class.ring-ink]="d.date === today()"
              [title]="d.title"
            >{{ d.day }}</span>
          }
        </div>
        <ul class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">
          <li class="flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-sm bg-orchid"></span> Soumission ouverte</li>
          <li class="flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-sm border border-slate-200 bg-white"></span> Jour ouvré</li>
          <li class="flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-sm bg-slate-200"></span> Non saisissable</li>
          @if (hasWorkedHoliday()) { <li class="flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-sm bg-amber-100 ring-1 ring-amber"></span> Férié travaillé</li> }
        </ul>
      </div>

      <dl class="mt-5 space-y-3 text-sm">
        <div class="flex gap-3">
          <ng-icon name="lucideSend" size="16" class="mt-0.5 shrink-0 text-orchid" aria-hidden="true" />
          <div><dt class="font-medium text-ink">Soumission de {{ monthLower() }}</dt><dd class="text-ink-soft">{{ openingText() }}</dd></div>
        </div>
        <div class="flex gap-3">
          <ng-icon name="lucideClock" size="16" class="mt-0.5 shrink-0 text-orchid" aria-hidden="true" />
          <div><dt class="font-medium text-ink">Date limite</dt><dd class="text-ink-soft">{{ deadlineText() }}</dd></div>
        </div>
        <div class="flex gap-3">
          <ng-icon name="lucideCircleAlert" size="16" class="mt-0.5 shrink-0 text-orchid" aria-hidden="true" />
          <div><dt class="font-medium text-ink">Jours non renseignés</dt><dd class="text-ink-soft">{{ completenessText() }}</dd></div>
        </div>
        <div class="flex gap-3">
          <ng-icon name="lucidePencil" size="16" class="mt-0.5 shrink-0 text-orchid" aria-hidden="true" />
          <div><dt class="font-medium text-ink">Mois modifiables</dt><dd class="text-ink-soft">{{ editableText() }}</dd></div>
        </div>
        <div class="flex gap-3">
          <ng-icon name="lucideCalendar" size="16" class="mt-0.5 shrink-0 text-orchid" aria-hidden="true" />
          <div><dt class="font-medium text-ink">Week-ends et fériés</dt><dd class="text-ink-soft">{{ calendarText() }}</dd></div>
        </div>
      </dl>
    </section>
  `,
})
export class SettingsPreview {
  readonly settings = input.required<AppSettings>();
  /** Date du jour (YYYY-MM-DD, Europe/Paris). */
  readonly today = input.required<string>();

  protected readonly headers = HEADERS;
  private readonly month = computed(() => monthOf(this.today()));
  protected readonly title = computed(() => monthTitle(this.month()));
  protected readonly monthLower = computed(() => monthName(this.month()));
  private readonly region = computed(() => this.settings().calendar.holidayRegion);
  private readonly opensOn = computed(() => submissionOpensOn(this.month(), this.settings().submission, this.region()));

  protected readonly blanks = computed(() => Array(monthDays(this.month(), this.region())[0].weekday - 1).fill(0));
  protected readonly days = computed(() => {
    const cal = this.settings().calendar;
    const opens = this.opensOn() ?? `${this.month()}-01`;
    return monthDays(this.month(), this.region()).map((d) => {
      const worked = !!d.holidayCode && (cal.holidayPolicy === 'AUTORISE' || cal.workedHolidays.includes(d.holidayCode));
      const weekendOk = d.weekend && cal.weekendPolicy === 'AUTORISE';
      const blocked = (d.weekend && !weekendOk) || (!!d.holiday && !worked);
      const open = d.date >= opens;
      let cls = 'border border-slate-200 bg-white text-ink';
      if (blocked) cls = 'bg-slate-200 text-slate-400';
      else if (worked && !d.weekend) cls = 'bg-amber-100 text-ink ring-1 ring-amber';
      if (open && !blocked) cls = worked ? 'bg-orchid text-white ring-1 ring-amber' : 'bg-orchid text-white';
      const title = [d.holiday, blocked ? 'non saisissable' : null, open && !blocked ? 'soumission ouverte' : null].filter(Boolean).join(' · ');
      return { date: d.date, day: d.day, cls, title };
    });
  });
  protected readonly hasWorkedHoliday = computed(() => this.days().some((d) => d.cls.includes('amber')));

  protected readonly openingText = computed(() => {
    const s = this.settings().submission;
    const opens = this.opensOn();
    const base = opens ? `à partir du ${longDate(opens)}` : 'dès le 1er du mois';
    return s.futureMonths ? `${base} ; les mois futurs peuvent aussi être soumis.` : `${base}.`;
  });
  protected readonly deadlineText = computed(() => {
    const d = submissionDeadline(this.month(), this.settings().submission, this.region());
    return `${longDate(d)} (${this.settings().submission.deadlineWorkingDay}ᵉ jour ouvré du mois suivant) ; au-delà, badge « En retard » côté admin.`;
  });
  protected readonly completenessText = computed(() =>
    this.settings().submission.completeness === 'BLOQUER'
      ? 'la soumission est bloquée tant que tous les jours ouvrés ne sont pas saisis.'
      : 'simple avertissement avant la soumission.',
  );
  protected readonly editableText = computed(() => {
    const n = this.settings().submission.pastMonthsLimit;
    if (n === 0) return `uniquement ${this.monthLower()} (hors CRA rejetés, toujours corrigeables).`;
    return `de ${monthName(addMonths(this.month(), -n))} à ${this.monthLower()} (les CRA rejetés restent toujours corrigeables).`;
  });
  protected readonly calendarText = computed(() => {
    const c = this.settings().calendar;
    const we = c.weekendPolicy === 'AUTORISE' ? 'week-ends saisissables' : 'week-ends interdits';
    const hol =
      c.holidayPolicy === 'AUTORISE'
        ? 'jours fériés saisissables'
        : c.workedHolidays.length
          ? `fériés interdits sauf ${c.workedHolidays.length} travaillé${c.workedHolidays.length > 1 ? 's' : ''}`
          : 'jours fériés interdits';
    return `${we}, ${hol} (calendrier ${c.holidayRegion === 'alsace-moselle' ? 'Alsace-Moselle' : 'Métropole'}). Chaque mission peut changer ces règles ; les absences restent toujours interdites ces jours-là.`;
  });
}
