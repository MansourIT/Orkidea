import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import type { Activity } from '@shared/types';
import { dayRefusal } from '@shared/calendar-rules';
import { formatDays } from '../../core/format';
import { tint } from './calendar-grid';
import { type DayCell, TimesheetStore } from './timesheet.store';

const INITIALS = ['', 'L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Vue tableau : lignes = activités, colonnes = jours du mois.
 * Cellule : clic pour faire défiler vide → ½ → 1, ou clavier (1, 5 / , / . pour ½, 0 / Suppr pour vider, flèches).
 * Même état que la vue calendrier (TimesheetStore).
 */
@Component({
  selector: 'app-table-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.overLimitDays().length) {
      <p class="alert-error mb-3" role="alert">
        Plus d’une journée saisie le {{ overLimitLabel() }} : corrigez avant d’enregistrer.
      </p>
    }
    <div class="overflow-x-auto rounded-xl border border-slate-200">
      <table class="w-max min-w-full border-separate border-spacing-0 text-sm" role="grid" [attr.aria-readonly]="!store.editable()" aria-label="Saisie par activité et par jour">
        <thead>
          <tr>
            <th scope="col" class="sticky left-0 z-20 min-w-28 border-b border-slate-200 bg-white px-2 py-2 sm:min-w-44 sm:px-3 text-left text-xs font-semibold text-ink-soft">Activité</th>
            @for (d of store.days(); track d.date) {
              <th scope="col" class="w-9 min-w-9 border-b border-slate-200 px-0 py-1.5 text-center text-xs font-medium"
                  [class]="d.nonWorking ? 'bg-slate-100 text-slate-400' : 'bg-white text-ink-soft'"
                  [class.!text-orchid]="d.isToday" [title]="d.holiday ?? ''" [attr.aria-label]="store.dayLabel(d).split(' :')[0]">
                <span class="block font-semibold">{{ d.day }}</span>
                <span class="block text-[10px]">{{ initials[d.weekday] }}</span>
              </th>
            }
            <th scope="col" class="sticky right-0 z-20 border-b border-l border-slate-200 bg-white px-2 py-2 sm:px-3 text-right text-xs font-semibold text-ink-soft">Total</th>
          </tr>
        </thead>
        <tbody>
          @for (a of rows(); track a.id; let r = $index) {
            <tr>
              <th scope="row" class="sticky left-0 z-10 border-b border-slate-100 bg-white px-2 py-1.5 text-left font-normal sm:px-3">
                <span class="flex items-center gap-2">
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full" [style.background]="a.color" aria-hidden="true"></span>
                  <span class="min-w-0">
                    <span class="block max-w-24 truncate text-xs font-semibold text-ink sm:max-w-40 sm:text-sm">{{ a.missionLabel ?? a.label }}</span>
                    <span class="block max-w-24 truncate text-xs text-ink-soft sm:max-w-40">{{ a.missionLabel ? a.label : 'Absence' }}{{ a.archived ? ' (archivée)' : '' }}</span>
                  </span>
                </span>
              </th>
              @for (d of store.days(); track d.date; let c = $index) {
                <td class="border-b border-slate-100 p-0.5" [class.bg-slate-50]="d.nonWorking">
                  <button
                    type="button"
                    [attr.data-cell]="r + ':' + c"
                    [attr.tabindex]="isFocus(r, c) ? 0 : -1"
                    [attr.aria-label]="cellLabel(a, d)"
                    [attr.aria-disabled]="!canEdit(a, d) ? 'true' : null"
                    class="h-8 w-8 rounded-md text-xs font-semibold transition-colors"
                    [class]="cellClass(a, d)"
                    [style.background]="qty(a, d) ? tint(a.color, qty(a, d) === 1 ? 35 : 18) : null"
                    (click)="onClick(a, d, r, c)"
                    (keydown)="onKeydown($event, a, d, r, c)"
                    (focus)="focus.set([r, c])"
                  >{{ label(qty(a, d)) }}</button>
                </td>
              }
              <td class="sticky right-0 z-10 border-b border-l border-slate-100 bg-white px-2 text-right text-xs sm:px-3 sm:text-sm font-semibold whitespace-nowrap">{{ format(rowTotal(a)) }}</td>
            </tr>
          }
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" class="sticky left-0 z-10 bg-slate-50 px-2 py-2 text-left text-xs sm:px-3 font-semibold text-ink-soft">Total du jour</th>
            @for (d of store.days(); track d.date) {
              <td class="bg-slate-50 py-2 text-center text-xs font-semibold" [class]="d.total > 1 ? 'text-red-600' : d.total ? 'text-ink' : 'text-slate-300'"
                  [attr.aria-label]="d.total > 1 ? 'Total supérieur à 1 jour : ' + d.total : null">
                {{ d.total ? label(d.total) : '·' }}
              </td>
            }
            <td class="sticky right-0 z-10 border-l border-slate-200 bg-slate-50 px-2 text-right text-xs sm:px-3 sm:text-sm font-bold whitespace-nowrap">{{ format(store.totalDays()) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `,
})
export class TableView {
  protected readonly store = inject(TimesheetStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly initials = INITIALS;
  protected readonly tint = tint;
  protected readonly format = formatDays;

  protected readonly rows = computed(() => this.store.tableActivities());
  protected readonly focus = signal<[number, number]>([0, 0]);

  protected readonly overLimitLabel = computed(() =>
    this.store
      .overLimitDays()
      .map((d) => Number(d.slice(8)))
      .join(', '),
  );

  protected qty(a: Activity, d: DayCell): 0 | 0.5 | 1 {
    return (d.entries.find((e) => e.activityId === a.id)?.quantity ?? 0) as 0 | 0.5 | 1;
  }

  protected label(n: number): string {
    return n === 0 ? '' : n === 0.5 ? '½' : n.toLocaleString('fr-FR');
  }

  protected rowTotal(a: Activity): number {
    return this.store.entries().reduce((s, e) => (e.activityId === a.id ? s + e.quantity : s), 0);
  }

  /** Modifiable : CRA en saisie et jour autorisé (une ligne existante reste toujours effaçable). */
  protected canEdit(a: Activity, d: DayCell): boolean {
    if (!this.store.editable()) return false;
    return !dayRefusal(d.date, a) || this.qty(a, d) > 0;
  }

  protected cellClass(a: Activity, d: DayCell): string {
    const base = this.canEdit(a, d) ? 'cursor-pointer hover:ring-2 hover:ring-orchid-200' : 'cursor-not-allowed';
    const empty = this.qty(a, d) ? 'text-ink' : this.canEdit(a, d) ? 'text-slate-300 hover:bg-slate-100' : 'bg-transparent';
    return `${base} ${empty} ${d.total > 1 && this.qty(a, d) ? 'ring-2 ring-red-400' : ''}`;
  }

  protected cellLabel(a: Activity, d: DayCell): string {
    const q = this.qty(a, d);
    const name = a.missionLabel ? `${a.missionLabel} ${a.label}` : a.label;
    return `${name}, ${this.store.dayLabel(d).split(' :')[0]} : ${q === 0 ? 'vide' : q === 1 ? '1 jour' : 'une demi-journée'}`;
  }

  protected isFocus(r: number, c: number): boolean {
    const [fr, fc] = this.focus();
    return fr === r && fc === c;
  }

  onClick(a: Activity, d: DayCell, r: number, c: number): void {
    this.focus.set([r, c]);
    if (this.store.editable()) this.store.cycleCell(d.date, a.id);
  }

  onKeydown(e: KeyboardEvent, a: Activity, d: DayCell, r: number, c: number): void {
    const moves: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const values: Record<string, 0 | 0.5 | 1> = { '0': 0, Delete: 0, Backspace: 0, '1': 1, '5': 0.5, ',': 0.5, '.': 0.5 };
    if (e.key in moves) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      this.moveTo(Math.min(this.rows().length - 1, Math.max(0, r + dr)), Math.min(this.store.days().length - 1, Math.max(0, c + dc)));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (this.store.editable()) this.store.cycleCell(d.date, a.id);
    } else if (e.key in values) {
      e.preventDefault();
      if (this.store.editable()) this.store.setCell(d.date, a.id, values[e.key]);
    }
  }

  private moveTo(r: number, c: number): void {
    this.focus.set([r, c]);
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`)?.focus());
  }
}
