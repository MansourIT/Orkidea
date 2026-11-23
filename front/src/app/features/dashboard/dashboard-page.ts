import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import type { TimesheetSummary } from '@shared/types';
import { addMonths, monthOf, todayInParis } from '@shared/dates';
import { Api, apiError } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { formatDays, monthTitle } from '../../core/format';
import { StatusBadge } from '../../ui/status-badge';

/** Tableau de bord consultant : CRA des 12 derniers mois avec statut et accès rapide. */
@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, NgIcon, StatusBadge, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-bold sm:text-3xl">Tableau de bord</h1>
    <p class="mt-1 text-sm text-ink-soft">Bonjour {{ firstName() }}, voici vos comptes rendus d’activité des 12 derniers mois.</p>

    @if (error()) {
      <div class="alert-error mt-6" role="alert"><ng-icon name="lucideCircleAlert" size="18" aria-hidden="true" /> {{ error() }}</div>
    } @else if (!list()) {
      <div class="card mt-6 flex items-center justify-center gap-2 p-16 text-ink-soft" role="status">
        <ng-icon name="lucideLoaderCircle" size="20" class="animate-spin" aria-hidden="true" /> Chargement…
      </div>
    } @else {
      @if (toFix().length) {
        <div class="alert-warning mt-6" role="status">
          <ng-icon name="lucideCircleAlert" size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            @for (m of toFix(); track m.month; let last = $last) {
              <a class="font-semibold underline" [routerLink]="['/saisie', m.month]">{{ title(m.month) }}</a>{{ m.status === 'REJETE' ? ' (rejeté)' : '' }}{{ last ? '' : ', ' }}
            }
            : à compléter ou corriger.
          </p>
        </div>
      }

      <ul class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        @for (m of list(); track m.month) {
          <li>
            <a [routerLink]="['/saisie', m.month]" class="card flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-md"
               [class.ring-2]="m.month === current" [class.ring-orchid]="m.month === current"
               [attr.aria-label]="title(m.month) + ' : ' + m.status">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="font-semibold text-ink">{{ title(m.month) }}</p>
                  @if (m.month === current) { <p class="text-xs font-medium text-orchid">Mois en cours</p> }
                </div>
                <app-status-badge [status]="m.status" />
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <div class="flex h-full">
                  <div class="bg-orchid" [style.width.%]="pct(m.workedDays, m)"></div>
                  <div class="bg-amber" [style.width.%]="pct(m.absenceDays, m)"></div>
                </div>
              </div>
              <dl class="grid grid-cols-3 gap-2 text-xs">
                <div><dt class="text-ink-soft">Travaillés</dt><dd class="font-semibold text-ink">{{ fmt(m.workedDays) }}</dd></div>
                <div><dt class="text-ink-soft">Absences</dt><dd class="font-semibold text-ink">{{ fmt(m.absenceDays) }}</dd></div>
                <div><dt class="text-ink-soft">Ouvrés</dt><dd class="font-semibold text-ink">{{ m.workingDays }} j</dd></div>
              </dl>
              <p class="mt-auto text-xs text-ink-soft">
                @if (m.submittedAt) { Soumis le {{ m.submittedAt | date: 'dd/MM/yyyy' }} } @else { Non soumis }
              </p>
            </a>
          </li>
        }
      </ul>
    }
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);

  protected readonly current = monthOf(todayInParis());
  protected readonly list = signal<TimesheetSummary[] | null>(null);
  /** Mois passés encore modifiables (paramétrage Orkidea). */
  private readonly pastLimit = signal(3);
  protected readonly error = signal<string | null>(null);
  protected readonly firstName = computed(() => this.auth.user()?.name.split(' ')[0] ?? '');
  /** CRA rejetés, ou mois passés non soumis encore modifiables. */
  protected readonly toFix = computed(() => {
    const oldest = addMonths(this.current, -this.pastLimit());
    return (this.list() ?? []).filter(
      (m) => m.status === 'REJETE' || (m.month < this.current && m.month >= oldest && ['NON_COMMENCE', 'BROUILLON'].includes(m.status)),
    );
  });
  protected readonly title = monthTitle;
  protected readonly fmt = formatDays;

  async ngOnInit(): Promise<void> {
    try {
      const [list, config] = await Promise.all([this.api.summaries(), this.api.config()]);
      this.pastLimit.set(config.settings.submission.pastMonthsLimit);
      this.list.set(list);
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  protected pct(days: number, m: TimesheetSummary): number {
    return m.workingDays ? Math.min(100, (days / m.workingDays) * 100) : 0;
  }
}
