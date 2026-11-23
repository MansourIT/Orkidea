import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { addMonths, monthName } from '@shared/dates';
import { formatDays, monthTitle } from '../../core/format';
import type { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { Api } from '../../core/api';
import { Confirm } from '../../ui/confirm-dialog';
import { StatusBadge } from '../../ui/status-badge';
import { ActivityPanel } from './activity-panel';
import { CalendarGrid } from './calendar-grid';
import { StatusBanners } from './status-banners';
import { TableView } from './table-view';
import { TimesheetStore } from './timesheet.store';

type View = 'calendrier' | 'tableau';

/** Écran « Saisie des temps » (maquette TimeFlow adaptée aux règles CRA). */
@Component({
  selector: 'app-timesheet-page',
  imports: [RouterLink, NgIcon, StatusBadge, ActivityPanel, CalendarGrid, StatusBanners, TableView],
  providers: [TimesheetStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    <!-- En-tête -->
    <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div>
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-bold sm:text-3xl">Saisie des temps</h1>
          @if (store.timesheet()) { <app-status-badge [status]="store.status()" /> }
        </div>
        <p class="mt-1 text-sm text-ink-soft">
          {{ monthLower() }} • {{ store.subtitleDays() }}
          @if (store.dirty()) {
            <span class="ml-2 inline-flex items-center gap-1 font-medium text-amber-700" role="status">
              <span class="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden="true"></span> Modifications non enregistrées
            </span>
          }
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        @if (store.editable()) {
          <button type="button" class="btn-secondary" (click)="store.save()" [disabled]="!store.dirty() || !!store.busy()">
            <ng-icon [name]="store.busy() === 'enregistrement' ? 'lucideLoaderCircle' : 'lucideSave'" size="16" [class.animate-spin]="store.busy() === 'enregistrement'" aria-hidden="true" />
            Enregistrer brouillon
          </button>
        }
        <a class="btn-secondary" [href]="pdfUrl()" (click)="downloadPdf($event)" [class.pointer-events-none]="!store.timesheet()">
          <ng-icon name="lucideDownload" size="16" aria-hidden="true" /> Télécharger le PDF
        </a>
        @if (store.editable()) {
          <button
            type="button"
            class="btn-primary"
            (click)="submit()"
            [disabled]="!!store.busy() || !!submitBlocked()"
            [title]="submitBlocked() ?? ''"
          >
            <ng-icon [name]="store.busy() === 'soumission' ? 'lucideLoaderCircle' : 'lucideSend'" size="16" [class.animate-spin]="store.busy() === 'soumission'" aria-hidden="true" />
            Soumettre
          </button>
        }
      </div>
    </div>

    <!-- Navigation mois -->
    <nav class="mt-5 flex items-center justify-between gap-2" aria-label="Changer de mois">
      <a class="btn-secondary px-3" [routerLink]="['/saisie', prevMonth()]">
        <ng-icon name="lucideChevronLeft" size="16" aria-hidden="true" /> <span class="hidden sm:inline">Mois précédent</span>
      </a>
      <h2 class="text-base font-semibold sm:text-lg" aria-live="polite">{{ title() }}</h2>
      <a class="btn-secondary px-3" [routerLink]="['/saisie', nextMonth()]">
        <span class="hidden sm:inline">Mois suivant</span> <ng-icon name="lucideChevronRight" size="16" aria-hidden="true" />
      </a>
    </nav>

    @switch (store.loadState()) {
      @case ('chargement') {
        <div class="card mt-6 flex items-center justify-center gap-2 p-16 text-ink-soft" role="status">
          <ng-icon name="lucideLoaderCircle" size="20" class="animate-spin" aria-hidden="true" /> Chargement du CRA…
        </div>
      }
      @case ('erreur') {
        <div class="alert-error mt-6" role="alert">
          <ng-icon name="lucideCircleAlert" size="18" aria-hidden="true" />
          <span>{{ store.loadError() }}</span>
          <button type="button" class="btn-secondary ml-auto" (click)="store.load(month())">Réessayer</button>
        </div>
      }
      @default {
        <app-status-banners class="mt-5" />

        <div class="mt-5 grid gap-5 lg:grid-cols-[17rem_1fr] lg:items-start">
          <app-activity-panel />

          <section class="card min-w-0 p-4 sm:p-6" aria-labelledby="saisie-titre">
            <h2 id="saisie-titre" class="mb-4 text-lg font-semibold">Mode de saisie</h2>

            <div class="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Affichage">
              <button type="button" role="tab" [attr.aria-selected]="view() === 'calendrier'" (click)="view.set('calendrier')" [class]="tabClass('calendrier')">
                <ng-icon name="lucideCalendar" size="16" aria-hidden="true" /> Vue calendrier
              </button>
              <button type="button" role="tab" [attr.aria-selected]="view() === 'tableau'" (click)="view.set('tableau')" [class]="tabClass('tableau')">
                <ng-icon name="lucideLayoutGrid" size="16" aria-hidden="true" /> Vue tableau
              </button>
            </div>

            @if (view() === 'tableau') {
              <p class="my-4 text-xs text-ink-soft">
                @if (store.editable()) { Cliquez sur une case pour faire défiler vide → ½ → 1, ou tapez 1, 5 (½) ou 0 au clavier. } @else { Lecture seule. }
              </p>
            } @else {
            <div class="my-4 flex min-h-9 flex-wrap items-center justify-between gap-2">
              <p class="text-xs text-ink-soft" aria-live="polite">
                @switch (brushKind()) {
                  @case ('activity') {
                    Pinceau : <span class="font-semibold text-ink">{{ brushName() }}</span> ({{ brushQty() }}) – cliquez ou glissez sur les jours.
                  }
                  @case ('eraser') { Gomme active : cliquez ou glissez sur les jours à vider. }
                  @default {
                    @if (store.editable()) { Aucun pinceau : cliquez sur un jour pour voir son détail. }
                  }
                }
              </p>
              @if (store.editable()) {
                <button type="button" class="btn-secondary px-3 py-1.5" [class.!border-orchid]="store.selectedId() === 'gomme'" [class.!bg-orchid-50]="store.selectedId() === 'gomme'" [attr.aria-pressed]="store.selectedId() === 'gomme'" (click)="store.select('gomme')">
                  <ng-icon name="lucideEraser" size="16" aria-hidden="true" /> Gomme
                </button>
              }
            </div>
            }

            @if (view() === 'calendrier') {
              <app-calendar-grid />
            } @else {
              <app-table-view />
            }

            <div class="mt-6">
              <label for="commentaire" class="label">Commentaire</label>
              <textarea
                id="commentaire"
                rows="3"
                maxlength="2000"
                class="input resize-y"
                placeholder="Précisions pour Orkidea ou le client (facultatif)"
                [value]="store.comment() ?? ''"
                [disabled]="!store.editable()"
                (input)="store.setComment($any($event.target).value)"
              ></textarea>
            </div>
          </section>
        </div>
      }
    }

    <!-- Annonces (lecteurs d'écran + toast visuel) -->
    <div class="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4" aria-live="polite" aria-atomic="true">
      @if (store.notice(); as n) {
        <p class="pointer-events-auto rounded-full px-4 py-2 text-sm font-medium shadow-lg"
           [class]="n.tone === 'erreur' ? 'bg-red-600 text-white' : n.tone === 'succes' ? 'bg-emerald-600 text-white' : 'bg-ink text-white'">
          {{ n.text }}
        </p>
      }
    </div>
  `,
})
export class TimesheetPage implements HasUnsavedChanges {
  protected readonly store = inject(TimesheetStore);
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);

  readonly month = input.required<string>();
  protected readonly view = signal<View>('calendrier');

  protected readonly title = computed(() => monthTitle(this.month()));
  protected readonly monthLower = computed(() => monthName(this.month()));
  protected readonly prevMonth = computed(() => addMonths(this.month(), -1));
  protected readonly nextMonth = computed(() => addMonths(this.month(), 1));
  protected readonly pdfUrl = computed(() => this.api.pdfUrl(this.month()));
  protected readonly submitBlocked = computed(
    () => this.store.timesheet()?.submissionBlockedReason ?? (this.store.overLimitDays().length ? 'Plus d’une journée saisie sur certains jours' : null),
  );

  protected readonly brushKind = computed(() => this.store.brush()?.kind ?? null);
  protected readonly brushName = computed(() => {
    const b = this.store.brush();
    return b?.kind === 'activity' ? this.store.activityName(b.activityId) : '';
  });
  protected readonly brushQty = computed(() => {
    const b = this.store.brush();
    return b?.kind === 'activity' ? formatDays(b.quantity) : '';
  });

  constructor() {
    // Chargement à chaque changement de mois (le composant est réutilisé par le routeur).
    effect(() => {
      const m = this.month();
      untracked(() => void this.store.load(m));
    });
    // Les annonces disparaissent après quelques secondes.
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      if (!this.store.notice()) return;
      clearTimeout(timer);
      timer = setTimeout(() => this.store.notice.set(null), 4000);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  protected tabClass(v: View): string {
    const base = 'flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors';
    return this.view() === v ? `${base} bg-white text-ink shadow-sm` : `${base} text-ink-soft hover:text-ink`;
  }

  async submit(): Promise<void> {
    const missing = this.store.missingSummary();
    const ok = await this.confirm.ask(
      missing
        ? { title: 'Jours non renseignés', message: `${missing}\nSoumettre quand même ?`, confirmLabel: 'Soumettre quand même' }
        : {
            title: `Soumettre le CRA de ${monthName(this.month())} ?`,
            message: 'Après soumission, la saisie est verrouillée. Si votre contrat le prévoit, votre client reçoit une demande de validation.',
            confirmLabel: 'Soumettre',
          },
    );
    if (ok) await this.store.submit();
  }

  /** Le PDF reflète la version enregistrée : on enregistre d'abord si besoin. */
  async downloadPdf(e: MouseEvent): Promise<void> {
    if (!this.store.dirty()) return;
    e.preventDefault();
    if (await this.store.save()) window.location.href = this.pdfUrl();
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.store.dirty()) return true;
    return this.confirm.ask({
      title: 'Modifications non enregistrées',
      message: 'Vos modifications seront perdues si vous quittez cette page.',
      confirmLabel: 'Quitter sans enregistrer',
      cancelLabel: 'Rester',
      tone: 'danger',
    });
  }

  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.store.dirty()) e.preventDefault();
  }
}
