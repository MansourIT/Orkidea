import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { STATUS_LABELS, type TimesheetListStatus } from '@shared/types';

const STYLES: Record<TimesheetListStatus, string> = {
  NON_COMMENCE: 'bg-slate-100 text-slate-600 ring-slate-200',
  BROUILLON: 'bg-slate-100 text-slate-700 ring-slate-300',
  SOUMIS: 'bg-amber-50 text-amber-800 ring-amber/50',
  VALIDE: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  REJETE: 'bg-red-50 text-red-800 ring-red-200',
  CLOTURE: 'bg-orchid-50 text-orchid-700 ring-orchid-200',
};

/** Badge de statut d'un CRA. */
@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset" [class]="style()">
    <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<TimesheetListStatus>();
  protected readonly label = computed(() => (this.status() === 'NON_COMMENCE' ? 'Non commencé' : STATUS_LABELS[this.status() as keyof typeof STATUS_LABELS]));
  protected readonly style = computed(() => STYLES[this.status()]);
}
