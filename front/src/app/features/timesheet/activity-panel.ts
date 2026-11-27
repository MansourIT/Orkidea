import { CdkDrag, CdkDragHandle, type CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { NgIcon } from '@ng-icons/core';
import { map } from 'rxjs';
import type { Activity } from '@shared/types';
import { TimesheetStore } from './timesheet.store';

/** Panneau « Liste de projets/activités » : choix du pinceau, case Partiel, ordre par glisser-déposer. */
@Component({
  selector: 'app-activity-panel',
  imports: [NgIcon, NgTemplateOutlet, CdkDropList, CdkDrag, CdkDragHandle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // min-w-0 : dans la grille de la page, la colonne ne doit pas s'élargir au contenu (liste horizontale défilante sur mobile).
  host: { class: 'block min-w-0' },
  template: `
    <section class="card p-4 lg:p-5" aria-labelledby="activites-titre">
      <h2 id="activites-titre" class="flex items-center gap-2 text-base font-semibold">
        <ng-icon name="lucideBriefcase" size="18" aria-hidden="true" /> Liste de projets/activités
      </h2>
      <p class="mt-1 mb-4 text-xs text-ink-soft">
        @if (store.editable()) { Cliquez pour sélectionner, puis cliquez sur les dates } @else { Légende des activités }
      </p>

      <ng-template #item let-a>
        <div
          class="group relative flex shrink-0 flex-col gap-1.5 rounded-xl border bg-white p-3 transition-colors w-52 lg:w-auto"
          [class]="store.selectedId() === a.id ? 'border-orchid bg-orchid-50 ring-1 ring-orchid' : 'border-slate-200 hover:border-slate-300'"
        >
          <div class="flex items-start gap-2">
            @if (store.editable()) {
              <span cdkDragHandle class="mt-0.5 cursor-grab text-slate-400 hover:text-ink-soft" title="Glisser pour réordonner" aria-hidden="true">
                <ng-icon name="lucideGripVertical" size="16" />
              </span>
            }
            <button
              type="button"
              class="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-default"
              [disabled]="!store.editable()"
              [attr.aria-pressed]="store.selectedId() === a.id"
              [attr.aria-label]="'Pinceau : ' + name(a)"
              (click)="store.select(a.id)"
            >
              <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" [style.background]="a.color" aria-hidden="true"></span>
              <span class="min-w-0">
                <span class="flex items-center gap-1.5"><span class="shrink-0 rounded bg-slate-100 px-1 font-mono text-[10px] font-semibold leading-4 text-ink">{{ a.code }}</span><span class="truncate text-sm font-semibold text-ink">{{ a.missionLabel ?? a.label }}</span></span>
                <span class="block truncate text-xs text-ink-soft">{{ a.missionLabel ? a.label : 'Absence' }}</span>
              </span>
            </button>
          </div>
          @if (store.editable()) {
            <label class="flex w-fit cursor-pointer items-center gap-2 pl-6 text-xs text-ink-soft select-none">
              <input
                type="checkbox"
                class="h-3.5 w-3.5 rounded border-slate-300 accent-orchid"
                [checked]="!!store.partial()[a.id]"
                (change)="store.setPartial(a.id, $any($event.target).checked)"
              />
              Partiel
            </label>
          }
        </div>
      </ng-template>

      <div
        cdkDropList
        [cdkDropListData]="store.workActivities()"
        [cdkDropListOrientation]="orientation()"
        [cdkDropListDisabled]="!store.editable()"
        (cdkDropListDropped)="drop($event, 'travail')"
        class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible"
        aria-label="Activités de mission"
      >
        @for (a of store.workActivities(); track a.id) {
          <div cdkDrag [cdkDragData]="a" class="shrink-0">
            <ng-container *ngTemplateOutlet="item; context: { $implicit: a }" />
          </div>
        } @empty {
          <p class="text-sm text-ink-soft">Aucune mission active.</p>
        }
      </div>

      <h3 class="mt-5 mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Absences</h3>
      <div
        cdkDropList
        [cdkDropListData]="store.absenceActivities()"
        [cdkDropListOrientation]="orientation()"
        [cdkDropListDisabled]="!store.editable()"
        (cdkDropListDropped)="drop($event, 'absence')"
        class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible"
        aria-label="Absences"
      >
        @for (a of store.absenceActivities(); track a.id) {
          <div cdkDrag [cdkDragData]="a" class="shrink-0">
            <ng-container *ngTemplateOutlet="item; context: { $implicit: a }" />
          </div>
        }
      </div>
    </section>
  `,
})
export class ActivityPanel {
  protected readonly store = inject(TimesheetStore);
  private readonly desktop = toSignal(inject(BreakpointObserver).observe('(min-width: 1024px)').pipe(map((s) => s.matches)), { initialValue: true });
  protected readonly orientation = computed(() => (this.desktop() ? 'vertical' : 'horizontal'));

  protected name(a: Activity): string {
    return a.missionLabel ? `${a.missionLabel} – ${a.label}` : a.label;
  }

  drop(event: CdkDragDrop<Activity[]>, group: 'travail' | 'absence'): void {
    if (event.previousIndex === event.currentIndex) return;
    const work = [...this.store.workActivities()];
    const abs = [...this.store.absenceActivities()];
    moveItemInArray(group === 'travail' ? work : abs, event.previousIndex, event.currentIndex);
    void this.store.reorder([...work, ...abs].map((a) => a.id));
  }
}
