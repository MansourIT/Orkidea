import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

/** Compteur − / + borné (plus lisible qu'un champ numérique pour de petites valeurs). */
@Component({
  selector: 'app-stepper',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="inline-flex items-center rounded-lg border border-slate-300 bg-white" role="group" [attr.aria-label]="label()">
      <button type="button" class="flex h-9 w-9 items-center justify-center rounded-l-lg text-ink-soft hover:bg-slate-50 disabled:opacity-40" [disabled]="value() <= min()" (click)="set(value() - 1)" [attr.aria-label]="'Diminuer : ' + label()">
        <span aria-hidden="true" class="text-lg leading-none">−</span>
      </button>
      <input
        type="number"
        class="h-9 w-12 [appearance:textfield] border-x border-slate-200 text-center text-sm font-semibold text-ink focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
        [min]="min()"
        [max]="max()"
        [value]="value()"
        [attr.aria-label]="label()"
        (change)="set(+$any($event.target).value)"
      />
      <button type="button" class="flex h-9 w-9 items-center justify-center rounded-r-lg text-ink-soft hover:bg-slate-50 disabled:opacity-40" [disabled]="value() >= max()" (click)="set(value() + 1)" [attr.aria-label]="'Augmenter : ' + label()">
        <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
      </button>
    </div>
  `,
})
export class Stepper {
  readonly label = input.required<string>();
  readonly min = input(0);
  readonly max = input(99);
  readonly value = model.required<number>();

  set(n: number): void {
    const v = Number.isFinite(n) ? Math.round(n) : this.value();
    this.value.set(Math.min(this.max(), Math.max(this.min(), v)));
  }
}
