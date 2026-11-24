import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

let uid = 0;

/** Commutateur segmenté (groupe de boutons radio natifs : flèches du clavier, lecteurs d'écran). */
@Component({
  selector: 'app-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="radiogroup" [attr.aria-label]="label()" class="inline-grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-slate-100 p-1">
      @for (o of options(); track o.value) {
        <label
          class="relative flex cursor-pointer items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orchid"
          [class]="value() === o.value ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink'"
          [class.!cursor-not-allowed]="disabled()"
          [class.opacity-50]="disabled()"
        >
          <input type="radio" class="sr-only" [name]="name" [value]="o.value" [checked]="value() === o.value" [disabled]="disabled()" (change)="value.set(o.value)" />
          {{ o.label }}
        </label>
      }
    </div>
  `,
})
export class Segmented<T extends string> {
  readonly options = input.required<SegmentOption<T>[]>();
  readonly label = input.required<string>();
  readonly disabled = input(false);
  readonly value = model.required<T>();
  protected readonly name = `segmented-${uid++}`;
}
