import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { Entry } from '@shared/types';
import { WEEKDAY_NAMES } from '@shared/dates';
import { formatDays } from '../../core/format';
import { DayDialog, type DayDialogData } from './day-dialog';
import { type DayCell, TimesheetStore } from './timesheet.store';

const HEADERS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Teinte claire d'une couleur d'activité (fond de case). */
export const tint = (color: string, pct = 20) => `color-mix(in srgb, ${color} ${pct}%, white)`;

/**
 * Grille mensuelle Lun → Dim.
 * - Pinceau actif : clic ou appui maintenu + glisser (souris et tactile, pointer events) ;
 * - sans pinceau : clic → modale du jour (activités, astreinte) ; avec un pinceau : bouton « + » de la case ou Maj+Entrée ;
 * - clavier : flèches pour se déplacer, Entrée / Espace pour appliquer (ou ouvrir le détail).
 */
@Component({
  selector: 'app-calendar-grid',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="grid"
      [attr.aria-label]="'Calendrier ' + store.month()"
      [attr.aria-readonly]="!store.editable()"
      class="select-none"
      [style.touch-action]="store.brush() ? 'none' : 'auto'"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="endStroke()"
      (pointercancel)="endStroke()"
      (lostpointercapture)="endStroke()"
    >
      <div role="row" class="mb-2 grid grid-cols-7 gap-1.5 sm:gap-2">
        @for (h of headers; track h) {
          <div role="columnheader" class="text-center text-xs font-medium text-ink-soft sm:text-sm">{{ h }}</div>
        }
      </div>
      @for (week of store.weeks(); track $index) {
        <div role="row" class="mb-1.5 grid grid-cols-7 gap-1.5 sm:mb-2 sm:gap-2">
          @for (d of week; track $index) {
            @if (d) {
              <div role="gridcell" class="relative" [attr.aria-selected]="openDate() === d.date">
                <button
                  type="button"
                  [attr.data-date]="d.date"
                  [attr.tabindex]="focusedDate() === d.date ? 0 : -1"
                  [attr.aria-label]="store.dayLabel(d)"
                  [attr.aria-disabled]="isBlocked(d) ? 'true' : null"
                  [title]="tooltip(d)"
                  class="relative flex aspect-square w-full flex-col md:aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border text-sm transition-[opacity,box-shadow] sm:rounded-xl"
                  [class]="cellClass(d)"
                  [style.background]="background(d)"
                  [style.border-color]="borderColor(d)"
                  (click)="onClick(d, $event)"
                  (keydown)="onKeydown($event, d)"
                  (focus)="focused.set(d.date)"
                >
                  <span class="relative z-10 font-medium" [class.text-slate-400]="d.nonWorking && !d.entries.length">{{ d.day }}</span>
                  @if (d.entries.length) {
                    <span class="relative z-10 max-w-full truncate px-0.5 font-mono text-[9px] font-semibold text-ink/80 sm:text-[11px]" aria-hidden="true">{{ codes(d) }}</span>
                  } @else if (d.holiday) {
                    <span class="relative z-10 hidden w-full truncate px-1 text-[10px] leading-tight text-slate-400 md:block">{{ d.holiday }}</span>
                  }
                  @if (onCallAt(d.date); as oc) {
                    <span class="absolute right-0.5 bottom-0.5 z-10 rounded bg-red-600 px-0.5 font-mono text-[8px] font-bold leading-3 text-white sm:right-1 sm:bottom-1 sm:px-1 sm:text-[10px] sm:leading-4" aria-hidden="true">AST</span>
                  }
                </button>
                @if (store.brush() && store.editable()) {
                  <!-- Avec un pinceau, le clic peint : ce bouton ouvre quand même la modale du jour (astreinte). -->
                  <button type="button" class="absolute top-0.5 right-0.5 z-20 hidden h-5 w-5 items-center justify-center rounded-md bg-white/90 text-ink-soft shadow-sm ring-1 ring-slate-200 hover:text-orchid sm:flex"
                          tabindex="-1" [attr.aria-label]="'Détail et astreinte du ' + store.dayLabel(d).split(' :')[0]" title="Détail du jour et astreinte"
                          (pointerdown)="$event.stopPropagation()" (click)="openDay(d.date)">
                    <ng-icon name="lucidePlus" size="12" aria-hidden="true" />
                  </button>
                }
              </div>
            } @else {
              <div role="gridcell" aria-hidden="true"></div>
            }
          }
        </div>
      }
    </div>

  `,
})
export class CalendarGrid {
  protected readonly store = inject(TimesheetStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly headers = HEADERS;
  protected readonly format = formatDays;

  private dragging = false;
  protected readonly focused = signal<string | null>(null);
  /** Jour focusable (tabindex roving) : choisi par l'utilisateur, sinon aujourd'hui, sinon le 1er. */
  protected readonly focusedDate = computed(() => {
    const days = this.store.days();
    const f = this.focused();
    if (f && days.some((d) => d.date === f)) return f;
    return days.find((d) => d.isToday)?.date ?? days[0]?.date ?? null;
  });

  private readonly dialog = inject(Dialog);
  private readonly injector = inject(Injector);
  /** Date dont la modale est ouverte. */
  protected readonly openDate = signal<string | null>(null);

  // ------------------------------------------------------------ rendu
  protected isBlocked(d: DayCell): boolean {
    if (!this.store.editable()) return true;
    const brush = this.store.brush();
    if (!brush) return false;
    return !!this.store.refusals().get(d.date);
  }

  protected cellClass(d: DayCell): string {
    const c: string[] = [];
    const brush = this.store.brush();
    if (d.isToday) c.push('ring-2 ring-orchid ring-offset-1');
    if (!d.entries.length) c.push(d.nonWorking ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200');
    if (!this.store.editable()) c.push('cursor-default');
    else if (brush && this.store.refusals().get(d.date)) c.push('cursor-not-allowed opacity-40');
    else if (brush) c.push('cursor-pointer hover:shadow-md');
    else c.push('cursor-pointer hover:border-slate-300');
    // Jour non ouvré rendu saisissable par la mission du pinceau : hachuré.
    if (brush?.kind === 'activity' && d.nonWorking && !this.store.refusals().get(d.date) && !d.entries.length) c.push('cell-hatched');
    return c.join(' ');
  }

  protected color(e: Entry): string {
    return this.store.activityById().get(e.activityId)?.color ?? '#9AA0A6';
  }

  /** 1 j : fond teinté ; ½ j : moitié haute ; deux demi-journées : moitié haute / moitié basse. */
  protected background(d: DayCell): string | null {
    const [a, b] = d.entries;
    if (!a) return null;
    if (a.quantity === 1) return tint(this.color(a));
    const top = tint(this.color(a), 28);
    const bottom = b ? tint(this.color(b), 28) : 'white';
    return `linear-gradient(to bottom, ${top} 50%, ${bottom} 50%)`;
  }

  protected borderColor(d: DayCell): string | null {
    const [a] = d.entries;
    return a ? `color-mix(in srgb, ${this.color(a)} 65%, white)` : null;
  }

  /** Codes des activités du jour (DEV, ou DEV·CP pour deux demi-journées). */
  protected codes(d: DayCell): string {
    return d.entries.map((e) => this.store.activityById().get(e.activityId)?.code ?? '?').join('·');
  }

  /** Astreinte du jour (indicateur AST), null s'il n'y en a pas. */
  protected onCallAt(date: string): { missions: string[]; minutes: number } | null {
    const oc = this.store.onCallByDate().get(date);
    return oc?.missions.length ? oc : null;
  }

  /** « 2h30 » (infobulle d'astreinte). */
  protected hours(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }

  protected tooltip(d: DayCell): string {
    const lines = d.entries.map((e) => `${this.store.activityName(e.activityId)} : ${formatDays(e.quantity)}`);
    const oc = this.store.onCallByDate().get(d.date);
    if (oc?.missions.length) lines.push(`Astreinte${oc.minutes ? ` · interventions ${this.hours(oc.minutes)}` : ''}`);
    if (d.holiday) lines.unshift(`Férié : ${d.holiday}`);
    const refusal = this.store.brush() ? this.store.refusals().get(d.date) : null;
    if (refusal) lines.push(refusal);
    return lines.join('\n');
  }

  protected weekday(d: DayCell): string {
    return WEEKDAY_NAMES[d.weekday];
  }

  // ------------------------------------------------------------ pointeur (souris + tactile)
  private dateAt(target: EventTarget | Element | null): string | null {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-date]') : null;
    return el && this.host.nativeElement.contains(el) ? el.dataset['date']! : null;
  }

  onPointerDown(e: PointerEvent): void {
    if (!this.store.brush() || !this.store.editable() || e.button > 0) return;
    const date = this.dateAt(e.target);
    if (!date) return;
    e.preventDefault(); // pas de sélection de texte ni de défilement pendant le trait
    this.dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.focused.set(date);
    this.store.beginStroke(date);
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    // Avec la capture du pointeur (et au toucher), e.target reste l'élément de départ : on cherche la case sous le doigt.
    const date = this.dateAt(document.elementFromPoint(e.clientX, e.clientY));
    if (date) this.store.continueStroke(date);
  }

  endStroke(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.store.endStroke();
  }

  onClick(d: DayCell, e: MouseEvent): void {
    // Avec un pinceau, l'application se fait au pointerdown ; le clic ne sert qu'au mode « détail ».
    if (this.store.brush() && this.store.editable()) return;
    this.openDay(d.date);
  }

  /** Modale du jour : activités, astreinte et interventions. */
  openDay(date: string): void {
    this.openDate.set(date);
    const ref = this.dialog.open<void, DayDialogData>(DayDialog, {
      data: { date },
      injector: this.injector, // le store de la page (fourni par le composant parent)
      ariaLabelledBy: 'jour-titre',
      autoFocus: 'first-tabbable',
    });
    ref.closed.subscribe(() => {
      this.openDate.set(null);
      this.focusCell(date);
    });
  }

  // ------------------------------------------------------------ clavier
  onKeydown(e: KeyboardEvent, d: DayCell): void {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      const days = this.store.days();
      const i = Math.min(days.length - 1, Math.max(0, d.day - 1 + moves[e.key]));
      this.focusCell(days[i].date);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const days = this.store.days();
      this.focusCell((e.key === 'Home' ? days[0] : days[days.length - 1]).date);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // Maj+Entrée : modale du jour même avec un pinceau (équivalent clavier du bouton « + » de la case).
      if (this.store.brush() && this.store.editable() && !e.shiftKey) this.store.applyAt(d.date);
      else this.openDay(d.date);
    }
  }

  private focusCell(date: string): void {
    this.focused.set(date);
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus());
  }
}
