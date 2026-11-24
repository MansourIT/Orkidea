import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { Dialog } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { AdminTimesheetBoard, AdminTimesheetRow, TimesheetListStatus } from '@shared/types';
import { WEEKDAY_NAMES, addMonths, frDate, monthOf, todayInParis } from '@shared/dates';
import { Api, apiError } from '../../core/api';
import { formatDays, monthTitle } from '../../core/format';
import { Confirm } from '../../ui/confirm-dialog';
import { StatusBadge } from '../../ui/status-badge';
import { type DrawerData, TimesheetDrawer } from './timesheet-drawer';

type Filter = 'A_SAISIR' | 'SOUMIS' | 'REJETE' | 'VALIDE' | 'CLOTURE' | 'RETARD';

interface Kpi {
  id: Filter;
  label: string;
  hint: string;
  tone: string;
  match: (r: AdminTimesheetRow) => boolean;
}

const KPIS: Kpi[] = [
  { id: 'A_SAISIR', label: 'À saisir', hint: 'non commencés ou en brouillon', tone: 'text-slate-700 bg-slate-100', match: (r) => r.status === 'NON_COMMENCE' || r.status === 'BROUILLON' },
  { id: 'SOUMIS', label: 'En attente client', hint: 'soumis, validation en cours', tone: 'text-amber-800 bg-amber-50', match: (r) => r.status === 'SOUMIS' },
  { id: 'REJETE', label: 'Rejetés', hint: 'à corriger par le consultant', tone: 'text-red-700 bg-red-50', match: (r) => r.status === 'REJETE' },
  { id: 'VALIDE', label: 'Validés', hint: 'prêts à être clôturés', tone: 'text-emerald-800 bg-emerald-50', match: (r) => r.status === 'VALIDE' },
  { id: 'CLOTURE', label: 'Clôturés', hint: 'paie / facturation', tone: 'text-orchid-700 bg-orchid-50', match: (r) => r.status === 'CLOTURE' },
  { id: 'RETARD', label: 'En retard', hint: 'date limite dépassée', tone: 'text-red-700 bg-red-50', match: (r) => r.late },
];

/** Suivi du mois : compteurs-filtres, recherche, progression, détail latéral, export CSV, clôture groupée. */
@Component({
  selector: 'app-admin-timesheets',
  imports: [NgIcon, StatusBadge, DatePipe, CdkMenuTrigger, CdkMenu, CdkMenuItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Barre d'outils -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Mois">
        <button type="button" class="btn-secondary px-2.5" (click)="month.set(prev())" aria-label="Mois précédent"><ng-icon name="lucideChevronLeft" size="16" /></button>
        <input type="month" class="input w-44" [value]="month()" (change)="setMonth($any($event.target).value)" aria-label="Mois affiché" />
        <button type="button" class="btn-secondary px-2.5" (click)="month.set(next())" aria-label="Mois suivant"><ng-icon name="lucideChevronRight" size="16" /></button>
        @if (month() !== current) { <button type="button" class="btn-ghost text-xs" (click)="month.set(current)">Ce mois-ci</button> }
      </div>
      <div class="flex flex-wrap gap-2">
        <a class="btn-secondary" [href]="api.exportUrl(month())" download><ng-icon name="lucideDownload" size="16" aria-hidden="true" /> Export CSV</a>
        <button type="button" class="btn-primary" (click)="closeAll()" [disabled]="!count('VALIDE') || busy() === 'tous'">
          <ng-icon name="lucideLock" size="16" aria-hidden="true" /> Clôturer les validés ({{ count('VALIDE') }})
        </button>
      </div>
    </div>

    @if (board(); as b) {
      <p class="mt-3 text-sm text-ink-soft">
        <span class="font-semibold text-ink">{{ title() }}</span> · {{ b.workingDays }} jours ouvrés · date limite de soumission : {{ deadline() }}
        @if (deadlinePassed()) { <span class="ml-1 font-medium text-red-700">(dépassée)</span> }
      </p>
    }

    <!-- Compteurs (servent aussi de filtres) -->
    <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" role="group" aria-label="Filtrer par statut">
      @for (k of kpis; track k.id) {
        <button type="button" (click)="toggleFilter(k.id)" [attr.aria-pressed]="filter() === k.id"
                class="card flex flex-col items-start gap-1 p-2.5 text-left transition-shadow hover:shadow-md sm:p-3"
                [class.ring-2]="filter() === k.id" [class.ring-orchid]="filter() === k.id">
          <span class="rounded-md px-1.5 py-0.5 text-xl leading-none font-bold sm:text-2xl" [class]="k.tone">{{ count(k.id) }}</span>
          <span class="text-sm font-semibold text-ink">{{ k.label }}</span>
          <span class="hidden text-[11px] leading-tight text-ink-soft sm:block">{{ k.hint }}</span>
        </button>
      }
    </div>

    <!-- Recherche + filtre actif -->
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <label class="relative block w-full max-w-xs">
        <span class="sr-only">Rechercher un consultant</span>
        <input type="search" class="input" placeholder="Rechercher un consultant…" [value]="query()" (input)="query.set($any($event.target).value)" />
      </label>
      @if (filter(); as f) {
        <button type="button" class="flex items-center gap-1.5 rounded-full bg-orchid-50 px-3 py-1 text-xs font-medium text-orchid-700" (click)="filter.set(null)">
          Filtre : {{ kpiLabel(f) }} <ng-icon name="lucideX" size="12" aria-label="Retirer le filtre" />
        </button>
      }
      <span class="ml-auto text-xs text-ink-soft" aria-live="polite">{{ rows().length }} consultant{{ rows().length > 1 ? 's' : '' }}</span>
    </div>

    @if (error()) { <div class="alert-error mt-4" role="alert">{{ error() }}</div> }
    @if (info()) { <p class="alert-success mt-4" role="status">{{ info() }}</p> }

    <!-- Tableau (écrans larges) -->
    <div class="card mt-4 hidden overflow-hidden md:block">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs text-ink-soft">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">Consultant</th>
            <th scope="col" class="px-4 py-3 font-medium">Statut</th>
            <th scope="col" class="w-72 px-4 py-3 font-medium">Saisie du mois</th>
            <th scope="col" class="px-4 py-3 font-medium">Soumis le</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.consultantId) {
            <tr class="border-t border-slate-100 transition-colors" [class.cursor-pointer]="!!r.id" [class.hover:bg-slate-50]="!!r.id" (click)="open(r)">
              <td class="px-4 py-3">
                <p class="font-medium text-ink">{{ r.consultant }}</p>
                <p class="text-xs text-ink-soft">{{ r.consultantEmail }}</p>
              </td>
              <td class="px-4 py-3">
                <span class="flex flex-wrap items-center gap-1.5">
                  <app-status-badge [status]="r.status" />
                  @if (r.late) { <span class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">En retard</span> }
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex h-2 overflow-hidden rounded-full bg-slate-100" [attr.aria-label]="progressLabel(r)" role="img">
                  <div class="bg-orchid" [style.width.%]="pct(r.workedDays)"></div>
                  <div class="bg-amber" [style.width.%]="pct(r.absenceDays)"></div>
                </div>
                <p class="mt-1 text-xs whitespace-nowrap text-ink-soft">{{ fmt(r.workedDays) }} travaillés · {{ fmt(r.absenceDays) }} d’absence / {{ board()!.workingDays }} j</p>
              </td>
              <td class="px-4 py-3 text-ink-soft">{{ r.submittedAt ? (r.submittedAt | date: 'dd/MM/yyyy') : '—' }}</td>
              <td class="px-4 py-3" (click)="$event.stopPropagation()">
                <span class="flex items-center justify-end gap-1.5">
                  @switch (r.status) {
                    @case ('VALIDE') { <button type="button" class="btn-primary px-3 py-1.5 text-xs" (click)="close(r)" [disabled]="busy() === r.id">Clôturer</button> }
                    @case ('SOUMIS') { <button type="button" class="btn-secondary px-3 py-1.5 text-xs" (click)="resend(r)" [disabled]="busy() === r.id">Relancer</button> }
                  }
                  @if (r.id) {
                    <button type="button" class="btn-ghost px-2 py-1.5" [cdkMenuTriggerFor]="menu" [cdkMenuTriggerData]="{ $implicit: r }" [attr.aria-label]="'Actions pour ' + r.consultant">
                      <span aria-hidden="true" class="text-lg leading-none">⋯</span>
                    </button>
                  }
                </span>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="px-4 py-10 text-center text-ink-soft">{{ board() ? 'Aucun consultant ne correspond.' : 'Chargement…' }}</td></tr>
          }
        </tbody>
      </table>
    </div>

    <!-- Cartes (mobile) -->
    <ul class="mt-4 space-y-3 md:hidden">
      @for (r of rows(); track r.consultantId) {
        <li class="card p-4" (click)="open(r)">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate font-medium text-ink">{{ r.consultant }}</p>
              <p class="truncate text-xs text-ink-soft">{{ r.consultantEmail }}</p>
            </div>
            <app-status-badge [status]="r.status" />
          </div>
          @if (r.late) { <span class="mt-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">En retard</span> }
          <div class="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div class="bg-orchid" [style.width.%]="pct(r.workedDays)"></div><div class="bg-amber" [style.width.%]="pct(r.absenceDays)"></div>
          </div>
          <p class="mt-1 text-xs text-ink-soft">{{ progressLabel(r) }}</p>
          <div class="mt-3 flex flex-wrap gap-2" (click)="$event.stopPropagation()">
            @if (r.status === 'VALIDE') { <button type="button" class="btn-primary px-3 py-1.5 text-xs" (click)="close(r)">Clôturer</button> }
            @if (r.status === 'SOUMIS') { <button type="button" class="btn-secondary px-3 py-1.5 text-xs" (click)="resend(r)">Relancer</button> }
            @if (r.id) { <button type="button" class="btn-ghost px-3 py-1.5 text-xs" (click)="open(r)">Détail</button> }
          </div>
        </li>
      } @empty {
        <li class="card p-8 text-center text-sm text-ink-soft">{{ board() ? 'Aucun consultant ne correspond.' : 'Chargement…' }}</li>
      }
    </ul>

    <ng-template #menu let-r>
      <div cdkMenu class="min-w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
        <button cdkMenuItem type="button" class="menu-item" (cdkMenuItemTriggered)="open(r)"><ng-icon name="lucideFileText" size="16" aria-hidden="true" /> Voir le détail</button>
        <a cdkMenuItem class="menu-item" [href]="api.adminPdfUrl(r.id)"><ng-icon name="lucideDownload" size="16" aria-hidden="true" /> Télécharger le PDF</a>
        @if (r.status === 'SOUMIS') { <button cdkMenuItem type="button" class="menu-item" (cdkMenuItemTriggered)="resend(r)"><ng-icon name="lucideMail" size="16" aria-hidden="true" /> Relancer le client</button> }
        @if (['SOUMIS', 'VALIDE', 'REJETE', 'CLOTURE'].includes(r.status)) {
          <button cdkMenuItem type="button" class="menu-item" (cdkMenuItemTriggered)="reopen(r)"><ng-icon name="lucideRotateCcw" size="16" aria-hidden="true" /> Rouvrir</button>
        }
      </div>
    </ng-template>
  `,
})
export class AdminTimesheets {
  protected readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  private readonly dialog = inject(Dialog);
  private readonly overlay = inject(Overlay);

  protected readonly kpis = KPIS;
  protected readonly current = monthOf(todayInParis());
  protected readonly month = signal(this.current);
  protected readonly board = signal<AdminTimesheetBoard | null>(null);
  protected readonly filter = signal<Filter | null>(null);
  protected readonly query = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);

  protected readonly prev = computed(() => addMonths(this.month(), -1));
  protected readonly next = computed(() => addMonths(this.month(), 1));
  protected readonly title = computed(() => monthTitle(this.month()));
  protected readonly fmt = formatDays;

  protected readonly deadline = computed(() => {
    const d = this.board()?.deadline;
    if (!d) return '';
    const js = new Date(`${d}T00:00:00Z`).getUTCDay();
    return `${WEEKDAY_NAMES[js === 0 ? 7 : js]} ${frDate(d)}`;
  });
  protected readonly deadlinePassed = computed(() => !!this.board() && todayInParis() > this.board()!.deadline);

  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    const match = f ? KPIS.find((k) => k.id === f)!.match : () => true;
    return (this.board()?.rows ?? []).filter((r) => match(r) && (!q || `${r.consultant} ${r.consultantEmail}`.toLowerCase().includes(q)));
  });

  constructor() {
    effect(() => {
      const m = this.month();
      untracked(() => void this.load(m));
    });
  }

  protected count(id: Filter): number {
    const match = KPIS.find((k) => k.id === id)!.match;
    return (this.board()?.rows ?? []).filter(match).length;
  }

  protected kpiLabel(id: Filter): string {
    return KPIS.find((k) => k.id === id)!.label;
  }

  protected toggleFilter(id: Filter): void {
    this.filter.update((f) => (f === id ? null : id));
  }

  protected pct(days: number): number {
    const w = this.board()?.workingDays ?? 0;
    return w ? Math.min(100, (days / w) * 100) : 0;
  }

  protected progressLabel(r: AdminTimesheetRow): string {
    return `${formatDays(r.workedDays)} travaillés, ${formatDays(r.absenceDays)} d’absence sur ${this.board()?.workingDays ?? 0} jours ouvrés`;
  }

  protected setMonth(value: string): void {
    if (/^\d{4}-\d{2}$/.test(value)) this.month.set(value);
  }

  private async load(month: string): Promise<void> {
    this.error.set(null);
    try {
      const b = await this.api.board(month);
      if (month === this.month()) this.board.set(b);
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  /** Exécute une action puis recharge ; `action` renvoie le message de succès. */
  private async run(id: string, action: () => Promise<string>): Promise<void> {
    this.busy.set(id);
    this.error.set(null);
    this.info.set(null);
    try {
      this.info.set(await action());
      await this.load(this.month());
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(null);
    }
  }

  /** Détail dans un panneau latéral (CDK Dialog positionné à droite). */
  async open(r: AdminTimesheetRow): Promise<void> {
    if (!r.id) return;
    const ref = this.dialog.open<boolean, DrawerData>(TimesheetDrawer, {
      data: { id: r.id },
      positionStrategy: this.overlay.position().global().right('0').top('0'),
      height: '100dvh',
      backdropClass: ['bg-ink/40'],
      ariaLabel: `Détail du CRA de ${r.consultant}`,
    });
    ref.closed.subscribe((changed) => {
      if (changed) void this.load(this.month());
    });
  }

  async close(r: AdminTimesheetRow): Promise<void> {
    if (!(await this.confirm.ask({ title: `Clôturer le CRA de ${r.consultant} ?`, message: `${this.title()} : le CRA ne sera plus modifiable (paie, facturation).`, confirmLabel: 'Clôturer' }))) return;
    await this.run(r.id!, async () => (await this.api.closeTimesheet(r.id!), `CRA de ${r.consultant} clôturé.`));
  }

  async closeAll(): Promise<void> {
    const n = this.count('VALIDE');
    const ok = await this.confirm.ask({
      title: `Clôturer ${n} CRA validé${n > 1 ? 's' : ''} ?`,
      message: `${this.title()} : tous les CRA validés deviennent définitifs (paie, facturation). Chaque clôture est tracée dans l’historique.`,
      confirmLabel: 'Tout clôturer',
    });
    if (!ok) return;
    await this.run('tous', async () => {
      const { closed } = await this.api.closeValidated(this.month());
      return `${closed} CRA clôturé${closed > 1 ? 's' : ''}.`;
    });
  }

  async reopen(r: AdminTimesheetRow): Promise<void> {
    const comment = await this.confirm.prompt({
      title: `Rouvrir le CRA de ${r.consultant} ?`,
      message: 'Le CRA repasse en brouillon : le consultant pourra le corriger puis le soumettre à nouveau. Les demandes de validation en cours sont annulées.',
      confirmLabel: 'Rouvrir',
      input: { label: 'Motif (visible dans l’historique)' },
    });
    if (comment === null) return;
    await this.run(r.id!, async () => (await this.api.reopenTimesheet(r.id!, comment || undefined), `CRA de ${r.consultant} rouvert.`));
  }

  async resend(r: AdminTimesheetRow): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Relancer le valideur ?', message: 'Un nouveau lien est envoyé ; l’ancien devient invalide.', confirmLabel: 'Relancer' }))) return;
    await this.run(r.id!, async () => (await this.api.resendValidation(r.id!), `Valideur relancé pour ${r.consultant}.`));
  }
}
