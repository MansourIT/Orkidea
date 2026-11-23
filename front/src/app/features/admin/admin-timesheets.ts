import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { AdminTimesheetBoard, AdminTimesheetRow, TimesheetEvent } from '@shared/types';
import { addMonths, frDate, monthOf, todayInParis } from '@shared/dates';
import { Api, apiError } from '../../core/api';
import { formatDays, monthTitle } from '../../core/format';
import { Confirm } from '../../ui/confirm-dialog';
import { StatusBadge } from '../../ui/status-badge';

const ACTIONS: Record<TimesheetEvent['action'], string> = {
  SOUMISSION: 'Soumission',
  VALIDATION_CLIENT: 'Validation client',
  REJET_CLIENT: 'Rejet client',
  VALIDATION: 'CRA validé',
  CLOTURE: 'Clôture',
  REOUVERTURE: 'Réouverture',
  RELANCE: 'Relance du valideur',
};

/** Tableau de bord admin du mois : statut de chaque consultant, clôture, réouverture, relance, PDF, historique. */
@Component({
  selector: 'app-admin-timesheets',
  imports: [NgIcon, StatusBadge, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2" role="group" aria-label="Mois">
        <button type="button" class="btn-secondary px-2.5" (click)="month.set(prev())" aria-label="Mois précédent"><ng-icon name="lucideChevronLeft" size="16" /></button>
        <input type="month" class="input w-44" [value]="month()" (change)="setMonth($any($event.target).value)" aria-label="Mois affiché" />
        <button type="button" class="btn-secondary px-2.5" (click)="month.set(next())" aria-label="Mois suivant"><ng-icon name="lucideChevronRight" size="16" /></button>
      </div>
      @if (board(); as b) {
        <p class="text-sm text-ink-soft">{{ title() }} : {{ b.workingDays }} jours ouvrés · date limite {{ fr(b.deadline) }}</p>
      }
    </div>

    @if (error()) { <div class="alert-error mt-4" role="alert">{{ error() }}</div> }

    <div class="card mt-4 overflow-x-auto">
      <table class="w-full min-w-[52rem] text-sm">
        <thead class="bg-slate-50 text-left text-xs text-ink-soft">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">Consultant</th>
            <th scope="col" class="px-4 py-3 font-medium">Statut</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Travaillés</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Absences</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Ouvrés</th>
            <th scope="col" class="px-4 py-3 font-medium">Soumis le</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (r of board()?.rows ?? []; track r.consultantId) {
            <tr class="border-t border-slate-100 align-middle">
              <td class="px-4 py-3 font-medium text-ink">{{ r.consultant }}</td>
              <td class="px-4 py-3">
                <span class="flex flex-wrap items-center gap-1.5">
                  <app-status-badge [status]="r.status" />
                  @if (r.late) { <span class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">En retard</span> }
                </span>
              </td>
              <td class="px-4 py-3 text-right">{{ fmt(r.workedDays) }}</td>
              <td class="px-4 py-3 text-right">{{ fmt(r.absenceDays) }}</td>
              <td class="px-4 py-3 text-right text-ink-soft">{{ board()!.workingDays }} j</td>
              <td class="px-4 py-3 text-ink-soft">{{ r.submittedAt ? (r.submittedAt | date: 'dd/MM/yyyy') : '—' }}</td>
              <td class="px-4 py-3">
                <span class="flex flex-wrap justify-end gap-1.5">
                  @if (r.status === 'VALIDE') {
                    <button type="button" class="btn-primary px-3 py-1.5 text-xs" (click)="close(r)" [disabled]="busy() === r.id"><ng-icon name="lucideLock" size="14" aria-hidden="true" /> Clôturer</button>
                  }
                  @if (r.status === 'SOUMIS') {
                    <button type="button" class="btn-secondary px-3 py-1.5 text-xs" (click)="resend(r)" [disabled]="busy() === r.id"><ng-icon name="lucideMail" size="14" aria-hidden="true" /> Relancer</button>
                  }
                  @if (['SOUMIS', 'VALIDE', 'REJETE', 'CLOTURE'].includes(r.status)) {
                    <button type="button" class="btn-secondary px-3 py-1.5 text-xs" (click)="reopen(r)" [disabled]="busy() === r.id"><ng-icon name="lucideRotateCcw" size="14" aria-hidden="true" /> Rouvrir</button>
                  }
                  @if (r.id) {
                    <a class="btn-ghost px-2 py-1.5 text-xs" [href]="api.adminPdfUrl(r.id)" [attr.aria-label]="'PDF du CRA de ' + r.consultant"><ng-icon name="lucideDownload" size="14" /> PDF</a>
                    <button type="button" class="btn-ghost px-2 py-1.5 text-xs" (click)="toggleEvents(r)" [attr.aria-expanded]="openId() === r.id"><ng-icon name="lucideClock" size="14" aria-hidden="true" /> Historique</button>
                  }
                </span>
              </td>
            </tr>
            @if (openId() === r.id) {
              <tr class="bg-slate-50/60">
                <td colspan="7" class="px-4 py-3">
                  @if (events(); as list) {
                    <ol class="space-y-1.5 text-xs">
                      @for (e of list; track $index) {
                        <li class="flex flex-wrap gap-x-2">
                          <span class="w-32 shrink-0 text-ink-soft">{{ e.createdAt | date: 'dd/MM/yyyy HH:mm' }}</span>
                          <span class="font-semibold text-ink">{{ actionLabel(e) }}</span>
                          <span class="text-ink-soft">par {{ e.actorType === 'client' ? 'le client ' + e.actor : e.actorType === 'systeme' ? 'le système' : e.actorType }}</span>
                          @if (e.comment) { <span class="text-ink">— {{ e.comment }}</span> }
                        </li>
                      } @empty { <li class="text-ink-soft">Aucun événement.</li> }
                    </ol>
                  } @else { <p class="text-xs text-ink-soft">Chargement…</p> }
                </td>
              </tr>
            }
          } @empty {
            <tr><td colspan="7" class="px-4 py-10 text-center text-ink-soft">{{ board() ? 'Aucun consultant actif.' : 'Chargement…' }}</td></tr>
          }
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-xs text-ink-soft" aria-live="polite">{{ info() }}</p>
  `,
})
export class AdminTimesheets {
  protected readonly api = inject(Api);
  private readonly confirm = inject(Confirm);

  protected readonly month = signal(monthOf(todayInParis()));
  protected readonly board = signal<AdminTimesheetBoard | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal('');
  protected readonly busy = signal<string | null>(null);
  protected readonly openId = signal<string | null>(null);
  protected readonly events = signal<TimesheetEvent[] | null>(null);

  protected readonly prev = computed(() => addMonths(this.month(), -1));
  protected readonly next = computed(() => addMonths(this.month(), 1));
  protected readonly title = computed(() => monthTitle(this.month()));
  protected readonly fmt = formatDays;
  protected readonly fr = frDate;

  constructor() {
    effect(() => {
      const m = this.month();
      untracked(() => void this.load(m));
    });
  }

  protected setMonth(value: string): void {
    if (/^\d{4}-\d{2}$/.test(value)) this.month.set(value);
  }

  private async load(month: string): Promise<void> {
    this.error.set(null);
    this.openId.set(null);
    try {
      const b = await this.api.board(month);
      if (month === this.month()) this.board.set(b);
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  private async run(r: AdminTimesheetRow, action: () => Promise<unknown>, done: string): Promise<void> {
    this.busy.set(r.id);
    this.error.set(null);
    try {
      await action();
      this.info.set(done);
      await this.load(this.month());
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(null);
    }
  }

  async close(r: AdminTimesheetRow): Promise<void> {
    if (!(await this.confirm.ask({ title: `Clôturer le CRA de ${r.consultant} ?`, message: `${this.title()} : le CRA ne sera plus modifiable (paie, facturation).`, confirmLabel: 'Clôturer' }))) return;
    await this.run(r, () => this.api.closeTimesheet(r.id!), `CRA de ${r.consultant} clôturé.`);
  }

  async reopen(r: AdminTimesheetRow): Promise<void> {
    const comment = await this.confirm.prompt({
      title: `Rouvrir le CRA de ${r.consultant} ?`,
      message: 'Le CRA repasse en brouillon : le consultant pourra le corriger puis le soumettre à nouveau. Les demandes de validation en cours sont annulées.',
      confirmLabel: 'Rouvrir',
      input: { label: 'Motif (visible dans l’historique)' },
    });
    if (comment === null) return;
    await this.run(r, () => this.api.reopenTimesheet(r.id!, comment || undefined), `CRA de ${r.consultant} rouvert.`);
  }

  async resend(r: AdminTimesheetRow): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Relancer le valideur ?', message: 'Un nouveau lien est envoyé ; l’ancien devient invalide.', confirmLabel: 'Relancer' }))) return;
    await this.run(r, () => this.api.resendValidation(r.id!), `Valideur relancé pour ${r.consultant}.`);
  }

  async toggleEvents(r: AdminTimesheetRow): Promise<void> {
    if (this.openId() === r.id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(r.id);
    this.events.set(null);
    try {
      this.events.set(await this.api.timesheetEvents(r.id!));
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  protected actionLabel(e: TimesheetEvent): string {
    return ACTIONS[e.action];
  }
}
