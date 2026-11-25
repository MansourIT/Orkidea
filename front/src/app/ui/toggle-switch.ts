import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/** Interrupteur (role="switch"). */
@Component({
  selector: 'app-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      role="switch"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label()"
      [disabled]="disabled()"
      (click)="checked.set(!checked())"
      class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      [class]="checked() ? 'bg-orchid' : 'bg-slate-300'"
    >
      <span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" [class]="checked() ? 'translate-x-5.5' : 'translate-x-0.5'"></span>
    </button>
  `,
})
export class ToggleSwitch {
  readonly label = input.required<string>();
  readonly disabled = input(false);
  readonly checked = model.required<boolean>();
}
