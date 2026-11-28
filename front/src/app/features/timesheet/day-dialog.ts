import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { Entry } from '@shared/types';
import { WEEKDAY_NAMES, MONTH_NAMES } from '@shared/dates';
import { formatDays } from '../../core/format';
import { OnCallEditor } from './on-call-editor';
import { TimesheetStore } from './timesheet.store';

export interface DayDialogData {
  date: string;
}

/** Modale d'un jour : saisies (avec suppression) et astreinte (ajout, interventions). */
@Component({
  selector: 'app-day-dialog',
  imports: [NgIcon, OnCallEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (day(); as d) {
      <div class="flex max-h-[90dvh] w-[min(94vw,26rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header class="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="jour-titre" class="text-lg font-bold">{{ title() }}</h2>
            @if (d.holiday) { <p class="text-xs text-ink-soft">Férié : {{ d.holiday }}</p> }
            @else if (d.weekend) { <p class="text-xs text-ink-soft">Week-end</p> }
          </div>
          <button type="button" class="btn-ghost -mr-2 p-2" (click)="ref.close()" aria-label="Fermer"><ng-icon name="lucideX" size="18" /></button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-4">
          <h3 class="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Activités</h3>
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
              <li class="text-sm text-ink-soft">Aucune activité saisie.</li>
            }
          </ul>
          @if (store.editable()) {
            <p class="mt-2 text-xs text-ink-soft">Pour saisir une activité, sélectionnez-la dans la liste puis cliquez sur les dates.</p>
          }

          @if (store.onCallMissions().length) {
            <app-on-call-editor [date]="d.date" />
          }
        </div>

        <footer class="flex justify-end border-t border-slate-100 px-5 py-3">
          <button type="button" class="btn-primary" (click)="ref.close()">Terminé</button>
        </footer>
      </div>
    }
  `,
})
export class DayDialog {
  private readonly data = inject<DayDialogData>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  protected readonly store = inject(TimesheetStore);
  protected readonly format = formatDays;

  protected readonly day = computed(() => this.store.days().find((d) => d.date === this.data.date) ?? null);
  protected readonly title = computed(() => {
    const d = this.day();
    if (!d) return '';
    const label = `${WEEKDAY_NAMES[d.weekday]} ${d.day} ${MONTH_NAMES[Number(d.date.slice(5, 7)) - 1]}`;
    return label.charAt(0).toUpperCase() + label.slice(1);
  });

  protected color(e: Entry): string {
    return this.store.activityById().get(e.activityId)?.color ?? '#9AA0A6';
  }
}
