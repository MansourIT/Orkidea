import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { monthTitle } from '../../core/format';

/** Écran « Saisie des temps » — implémenté à l'étape 4. */
@Component({
  selector: 'app-timesheet-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-3xl font-bold">Saisie des temps</h1>
    <p class="mt-1 text-ink-soft">{{ title() }}</p>
    <div class="card mt-6 p-8 text-center text-ink-soft">Écran en construction (étape 4).</div>
  `,
})
export class TimesheetPage {
  readonly month = input.required<string>();
  protected readonly title = computed(() => monthTitle(this.month()));
}
