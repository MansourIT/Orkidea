import { CdkConnectedOverlay, type ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { Entry } from '@shared/types';
import { WEEKDAY_NAMES } from '@shared/dates';
import { formatDays } from '../../core/format';
import { type DayCell, TimesheetStore } from './timesheet.store';

const HEADERS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Teinte claire d'une couleur d'activité (fond de case). */
export const tint = (color: string, pct = 20) => `color-mix(in srgb, ${color} ${pct}%, white)`;

/**
 * Grille mensuelle Lun → Dim.
 * - Pinceau actif : clic ou appui maintenu + glisser (souris et tactile, pointer events) ;
 * - sans pinceau : clic → popover de détail du jour ;
 * - clavier : flèches pour se déplacer, Entrée / Espace pour appliquer (ou ouvrir le détail).
 */
@Component({
  selector: 'app-calendar-grid',
  imports: [NgIcon, CdkConnectedOverlay],
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
              <div role="gridcell" [attr.aria-selected]="popoverDate() === d.date">
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
                </button>
              </div>
            } @else {
              <div role="gridcell" aria-hidden="true"></div>
            }
          }
        </div>
      }
    </div>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="popoverOrigin()!"
      [cdkConnectedOverlayOpen]="!!popoverDay()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayHasBackdrop]="true"
      cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
      (backdropClick)="closePopover()"
      (detach)="closePopover()"
      (overlayKeydown)="$event.key === 'Escape' && closePopover()"
    >
      @if (popoverDay(); as d) {
        <div class="w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-lg" role="dialog" [attr.aria-label]="'Détail du ' + store.dayLabel(d)">
          <div class="mb-3 flex items-start justify-between gap-2">
            <div>
              <p class="font-semibold capitalize">{{ weekday(d) }} {{ d.day }}</p>
              @if (d.holiday) { <p class="text-xs text-ink-soft">Férié : {{ d.holiday }}</p> }
              @else if (d.weekend) { <p class="text-xs text-ink-soft">Week-end</p> }
            </div>
            <button type="button" class="btn-ghost -mt-1 -mr-2 p-1" (click)="closePopover()" aria-label="Fermer">
              <ng-icon name="lucideX" size="16" />
            </button>
          </div>
          <ul class="space-y-2">
            @for (e of d.entries; track e.activityId) {
              <li class="flex items-center gap-2 text-sm">
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" [style.background]="color(e)" aria-hidden="true"></span>
                <span class="min-w-0 flex-1 truncate">{{ store.activityName(e.activityId) }}</span>
                <span class="font-medium">{{ format(e.quantity) }}</span>
                @if (store.editable()) {
                  <button type="button" class="btn-ghost p-1" (click)="store.removeEntry(d.date, e.activityId)" [attr.aria-label]="'Retirer ' + store.activityName(e.activityId)">
                    <ng-icon name="lucideX" size="14" />
                  </button>
                }
              </li>
            } @empty {
              <li class="text-sm text-ink-soft">Aucune saisie.</li>
            }
          </ul>
          @if (store.editable()) {
            <p class="mt-3 text-xs text-ink-soft">Sélectionnez une activité à gauche pour saisir ce jour.</p>
          }
        </div>
      }
    </ng-template>
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

  protected readonly popoverDate = signal<string | null>(null);
  protected readonly popoverOrigin = signal<HTMLElement | null>(null);
  protected readonly popoverDay = computed(() => this.store.days().find((d) => d.date === this.popoverDate()) ?? null);
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -6 },
  ];

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

  protected tooltip(d: DayCell): string {
    const lines = d.entries.map((e) => `${this.store.activityName(e.activityId)} : ${formatDays(e.quantity)}`);
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
    this.openPopover(d, e.currentTarget as HTMLElement);
  }

  private openPopover(d: DayCell, el: HTMLElement): void {
    this.popoverOrigin.set(el);
    this.popoverDate.set(d.date);
  }

  closePopover(): void {
    const date = this.popoverDate();
    this.popoverDate.set(null);
    if (date) this.focusCell(date);
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
      if (this.store.brush() && this.store.editable()) this.store.applyAt(d.date);
      else this.openPopover(d, e.currentTarget as HTMLElement);
    }
  }

  private focusCell(date: string): void {
    this.focused.set(date);
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus());
  }
}
