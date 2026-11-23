import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

export interface Tab<T extends string> {
  id: T;
  label: string;
  icon: string;
}

/** Onglets accessibles (role tablist, flèches gauche / droite). */
@Component({
  selector: 'app-tabs',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="tablist" [attr.aria-label]="label()" class="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      @for (t of tabs(); track t.id; let i = $index) {
        <button
          type="button"
          role="tab"
          [id]="'onglet-' + t.id"
          [attr.aria-selected]="active() === t.id"
          [attr.tabindex]="active() === t.id ? 0 : -1"
          (click)="active.set(t.id)"
          (keydown)="onKey($event, i)"
          class="-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors"
          [class]="active() === t.id ? 'border-orchid text-orchid' : 'border-transparent text-ink-soft hover:text-ink'"
        >
          <ng-icon [name]="t.icon" size="16" aria-hidden="true" /> {{ t.label }}
        </button>
      }
    </div>
  `,
})
export class Tabs<T extends string> {
  readonly tabs = input.required<Tab<T>[]>();
  readonly label = input('Onglets');
  readonly active = model.required<T>();

  onKey(e: KeyboardEvent, i: number): void {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const tabs = this.tabs();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    this.active.set(next.id);
    queueMicrotask(() => document.getElementById(`onglet-${next.id}`)?.focus());
  }
}
