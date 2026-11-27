import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { Activity, AdminTimesheetDetail, Entry, TimesheetEvent } from '@shared/types';
import { monthDays } from '@shared/holidays';
import { Api, apiError } from '../../core/api';
import { formatDays, monthTitle } from '../../core/format';
import { Confirm } from '../../ui/confirm-dialog';
import { StatusBadge } from '../../ui/status-badge';
import { tint } from '../timesheet/calendar-grid';
import { EVENT_LABELS, actorLabel } from './timesheet-labels';

export interface DrawerData {
  id: string;
}

/** Panneau latéral de détail d'un CRA (lecture seule + actions admin). Se ferme avec `true` si le CRA a changé. */
@Component({
  selector: 'app-timesheet-drawer',
  imports: [NgIcon, StatusBadge, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="flex h-dvh w-[min(100vw,40rem)] flex-col bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="drawer-titre">
      <header class="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
        <div class="min-w-0 flex-1">
          @if (detail(); as d) {
            <h2 id="drawer-titre" class="truncate text-lg font-bold">{{ d.consultant.name }}</h2>
            <p class="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              {{ monthTitle(d.timesheet.month) }} <app-status-badge [status]="d.timesheet.status" />
            </p>
            <p class="truncate text-xs text-ink-soft">{{ d.consultant.email }}</p>
          } @else {
            <h2 id="drawer-titre" class="text-lg font-bold">Détail du CRA</h2>
          }
        </div>
        <button type="button" class="btn-ghost p-2" (click)="ref.close(changed)" aria-label="Fermer le détail"><ng-icon name="lucideX" size="18" /></button>
      </header>

      <div class="flex-1 overflow-y-auto px-5 py-4">
        @if (error()) { <p class="alert-error" role="alert">{{ error() }}</p> }
        @if (detail(); as d) {
          <!-- Synthèse -->
          <dl class="grid grid-cols-3 gap-3">
            <div class="rounded-xl bg-orchid-50 p-3"><dt class="text-xs text-ink-soft">Travaillés</dt><dd class="text-lg font-bold text-orchid-700">{{ fmt(worked()) }}</dd></div>
            <div class="rounded-xl bg-amber-50 p-3"><dt class="text-xs text-ink-soft">Absences</dt><dd class="text-lg font-bold text-amber-800">{{ fmt(absent()) }}</dd></div>
            <div class="rounded-xl bg-slate-50 p-3"><dt class="text-xs text-ink-soft">Jours ouvrés</dt><dd class="text-lg font-bold text-ink">{{ d.timesheet.workingDays }} j</dd></div>
          </dl>

          <!-- Calendrier en lecture seule -->
          <h3 class="mt-6 mb-2 text-sm font-semibold">Calendrier</h3>
          <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-ink-soft" aria-hidden="true">
            @for (h of headers; track $index) { <span>{{ h }}</span> }
          </div>
          <div class="mt-1 grid grid-cols-7 gap-1" role="list" aria-label="Jours du mois">
            @for (b of blanks(); track $index) { <span aria-hidden="true"></span> }
            @for (c of cells(); track c.date) {
              <span role="listitem" class="flex h-11 flex-col items-center justify-center rounded-md border text-[11px] leading-tight"
                    [class]="c.nonWorking && !c.entries.length ? 'border-slate-100 bg-slate-50 text-slate-400' : 'border-slate-200 text-ink'"
                    [style.background]="c.background" [title]="c.title" [attr.aria-label]="c.title">
                <span class="font-semibold">{{ c.day }}</span>
                @if (c.total) { <span class="text-[9px] text-ink/70">{{ c.total === 1 ? '1 j' : '½ j' }}</span> }
              </span>
            }
          </div>

          <!-- Totaux par activité -->
          <h3 class="mt-6 mb-2 text-sm font-semibold">Répartition</h3>
          <ul class="divide-y divide-slate-100 rounded-xl border border-slate-200">
            @for (t of totals(); track t.activity.id) {
              <li class="flex items-center gap-2 px-3 py-2 text-sm">
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" [style.background]="t.activity.color" aria-hidden="true"></span>
                <span class="min-w-0 flex-1 truncate">{{ t.activity.missionLabel ? t.activity.missionLabel + ' · ' + t.activity.label : t.activity.label }}
                  @if (t.activity.clientName) { <span class="text-xs text-ink-soft">({{ t.activity.clientName }})</span> }
                </span>
                <span class="font-semibold">{{ fmt(t.days) }}</span>
              </li>
            } @empty {
              <li class="px-3 py-4 text-center text-sm text-ink-soft">Aucune saisie.</li>
            }
          </ul>

          @if (d.timesheet.validations.length) {
            <h3 class="mt-6 mb-2 text-sm font-semibold">Validation client</h3>
            <ul class="space-y-2">
              @for (v of d.timesheet.validations; track v.missionId) {
                <li class="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <p class="flex flex-wrap items-center justify-between gap-2">
                    <span class="font-medium">{{ v.missionLabel }} <span class="font-normal text-ink-soft">· {{ v.clientName }}</span></span>
                    <span class="text-xs font-semibold" [class]="v.status === 'VALIDE' ? 'text-emerald-700' : v.status === 'REJETE' ? 'text-red-700' : 'text-amber-700'">
                      {{ v.status === 'VALIDE' ? 'Validé' : v.status === 'REJETE' ? 'Rejeté' : 'En attente' }}@if (v.decidedAt) { le {{ v.decidedAt | date: 'dd/MM/yyyy' }} }
                    </span>
                  </p>
                  @if (v.comment) { <p class="mt-1 text-xs text-ink-soft">« {{ v.comment }} »</p> }
                </li>
              }
            </ul>
          }

          @if (d.timesheet.comment) {
            <h3 class="mt-6 mb-2 text-sm font-semibold">Commentaire du consultant</h3>
            <p class="rounded-xl bg-slate-50 px-3 py-2 text-sm whitespace-pre-line">{{ d.timesheet.comment }}</p>
          }

          <h3 class="mt-6 mb-2 text-sm font-semibold">Historique</h3>
          <ol class="relative space-y-3 border-l border-slate-200 pl-4">
            @for (e of events() ?? []; track $index) {
              <li class="text-xs">
                <span class="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-orchid" aria-hidden="true"></span>
                <p class="font-semibold text-ink">{{ eventLabels[e.action] }} <span class="font-normal text-ink-soft">· {{ e.createdAt | date: 'dd/MM/yyyy HH:mm' }}</span></p>
                <p class="text-ink-soft">{{ actor(e) }}@if (e.comment) { — {{ e.comment }} }</p>
              </li>
            } @empty {
              <li class="text-xs text-ink-soft">{{ events() ? 'Aucun événement.' : 'Chargement…' }}</li>
            }
          </ol>
        } @else if (!error()) {
          <p class="flex items-center gap-2 text-ink-soft" role="status"><ng-icon name="lucideLoaderCircle" size="18" class="animate-spin" aria-hidden="true" /> Chargement…</p>
        }
      </div>

      @if (detail(); as d) {
        <footer class="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <a class="btn-secondary mr-auto" [href]="api.adminPdfUrl(d.id)"><ng-icon name="lucideDownload" size="16" aria-hidden="true" /> PDF</a>
          @if (d.timesheet.status === 'SOUMIS') {
            <button type="button" class="btn-secondary" (click)="resend()" [disabled]="busy()"><ng-icon name="lucideMail" size="16" aria-hidden="true" /> Relancer le client</button>
          }
          @if (['SOUMIS', 'VALIDE', 'REJETE', 'CLOTURE'].includes(d.timesheet.status)) {
            <button type="button" class="btn-secondary" (click)="reopen()" [disabled]="busy()"><ng-icon name="lucideRotateCcw" size="16" aria-hidden="true" /> Rouvrir</button>
          }
          @if (d.timesheet.status === 'VALIDE') {
            <button type="button" class="btn-primary" (click)="close()" [disabled]="busy()"><ng-icon name="lucideLock" size="16" aria-hidden="true" /> Clôturer</button>
          }
        </footer>
      }
    </aside>
  `,
})
export class TimesheetDrawer implements OnInit {
  protected readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly data = inject<DrawerData>(DIALOG_DATA);

  protected readonly headers = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  protected readonly eventLabels = EVENT_LABELS;
  protected readonly monthTitle = monthTitle;
  protected readonly fmt = formatDays;
  protected readonly actor = actorLabel;

  protected readonly detail = signal<AdminTimesheetDetail | null>(null);
  protected readonly events = signal<TimesheetEvent[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected changed = false;

  private readonly byId = computed(() => new Map((this.detail()?.activities ?? []).map((a) => [a.id, a])));
  private readonly kindOf = (e: Entry) => this.byId().get(e.activityId)?.kind;
  protected readonly worked = computed(() => (this.detail()?.timesheet.entries ?? []).filter((e) => this.kindOf(e) !== 'absence').reduce((s, e) => s + e.quantity, 0));
  protected readonly absent = computed(() => (this.detail()?.timesheet.entries ?? []).filter((e) => this.kindOf(e) === 'absence').reduce((s, e) => s + e.quantity, 0));

  protected readonly totals = computed(() => {
    const map = new Map<string, number>();
    for (const e of this.detail()?.timesheet.entries ?? []) map.set(e.activityId, (map.get(e.activityId) ?? 0) + e.quantity);
    return [...map].map(([id, days]) => ({ activity: this.activity(id), days })).sort((a, b) => (a.activity.kind === b.activity.kind ? b.days - a.days : a.activity.kind === 'travail' ? -1 : 1));
  });

  protected readonly blanks = computed(() => {
    const m = this.detail()?.timesheet.month;
    return m ? Array(monthDays(m)[0].weekday - 1).fill(0) : [];
  });

  protected readonly cells = computed(() => {
    const d = this.detail();
    if (!d) return [];
    return monthDays(d.timesheet.month).map((day) => {
      const entries = d.timesheet.entries.filter((e) => e.date === day.date);
      const [a, b] = entries;
      const color = (e: Entry) => this.activity(e.activityId).color;
      const background = !a ? null : a.quantity === 1 ? tint(color(a), 30) : `linear-gradient(to bottom, ${tint(color(a), 35)} 50%, ${b ? tint(color(b), 35) : 'white'} 50%)`;
      const label = entries.map((e) => `${this.name(e.activityId)} : ${formatDays(e.quantity)}`).join(', ');
      const title = `${day.day} : ${label || (day.holiday ?? (day.weekend ? 'week-end' : 'non renseigné'))}`;
      return { date: day.date, day: day.day, entries, total: entries.reduce((s, e) => s + e.quantity, 0), nonWorking: day.weekend || !!day.holiday, background, title };
    });
  });

  ngOnInit(): void {
    void this.load();
  }

  private activity(id: string): Activity {
    return this.byId().get(id) ?? { id, missionId: null, missionLabel: null, clientName: null, label: 'Activité inconnue', code: '?', kind: 'travail', color: '#9AA0A6', startDate: null, endDate: null, rules: { weekend: 'INTERDIT', holidays: 'INTERDIT', workedHolidays: [], region: 'metropole' } };
  }

  private name(id: string): string {
    const a = this.activity(id);
    return a.missionLabel ? `${a.missionLabel} · ${a.label}` : a.label;
  }

  private async load(): Promise<void> {
    try {
      const [detail, events] = await Promise.all([this.api.timesheetDetail(this.data.id), this.api.timesheetEvents(this.data.id)]);
      this.detail.set(detail);
      this.events.set(events);
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.changed = true;
      await this.load();
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }

  async close(): Promise<void> {
    const d = this.detail()!;
    if (await this.confirm.ask({ title: `Clôturer le CRA de ${d.consultant.name} ?`, message: 'Le CRA ne sera plus modifiable (paie, facturation).', confirmLabel: 'Clôturer' })) {
      await this.run(() => this.api.closeTimesheet(d.id));
    }
  }

  async reopen(): Promise<void> {
    const d = this.detail()!;
    const comment = await this.confirm.prompt({
      title: `Rouvrir le CRA de ${d.consultant.name} ?`,
      message: 'Le CRA repasse en brouillon ; les demandes de validation en cours sont annulées.',
      confirmLabel: 'Rouvrir',
      input: { label: 'Motif (visible dans l’historique)' },
    });
    if (comment !== null) await this.run(() => this.api.reopenTimesheet(d.id, comment || undefined));
  }

  async resend(): Promise<void> {
    if (await this.confirm.ask({ title: 'Relancer le valideur ?', message: 'Un nouveau lien est envoyé ; l’ancien devient invalide.', confirmLabel: 'Relancer' })) {
      await this.run(() => this.api.resendValidation(this.detail()!.id));
    }
  }
}
