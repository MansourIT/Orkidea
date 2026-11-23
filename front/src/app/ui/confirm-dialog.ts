import { Dialog, DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primaire' | 'danger';
  /** Champ texte facultatif ou obligatoire (ex. motif de réouverture). */
  input?: { label: string; required?: boolean; placeholder?: string; initial?: string; multiline?: boolean };
}

type Result = { value: string } | false;

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-[min(92vw,28rem)] rounded-2xl bg-white p-6 shadow-xl" role="alertdialog" aria-labelledby="confirm-titre" aria-describedby="confirm-message">
      <h2 id="confirm-titre" class="text-lg font-bold">{{ data.title }}</h2>
      <p id="confirm-message" class="mt-2 text-sm whitespace-pre-line text-ink-soft">{{ data.message }}</p>
      @if (data.input; as field) {
        <label for="confirm-input" class="label mt-4">{{ field.label }}@if (!field.required) { <span class="font-normal text-ink-soft"> (facultatif)</span> }</label>
        @if (field.multiline === false) {
          <input id="confirm-input" class="input" maxlength="200" [placeholder]="field.placeholder ?? ''" [value]="value()" (input)="value.set($any($event.target).value)" (keydown.enter)="confirm()" />
        } @else {
          <textarea id="confirm-input" rows="3" maxlength="2000" class="input" [placeholder]="field.placeholder ?? ''" [value]="value()" (input)="value.set($any($event.target).value)"></textarea>
        }
        @if (missing()) { <p class="mt-1 text-sm text-red-700">Ce champ est obligatoire.</p> }
      }
      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close(false)">{{ data.cancelLabel ?? 'Annuler' }}</button>
        <button type="button" [class]="data.tone === 'danger' ? 'btn bg-red-600 text-white hover:bg-red-700' : 'btn-primary'" (click)="confirm()" cdkFocusInitial>
          {{ data.confirmLabel ?? 'Confirmer' }}
        </button>
      </div>
    </div>
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmOptions>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<Result>>(DialogRef);
  protected readonly value = signal(this.data.input?.initial ?? '');
  protected readonly missing = signal(false);

  confirm(): void {
    if (this.data.input?.required && !this.value().trim()) {
      this.missing.set(true);
      return;
    }
    this.ref.close({ value: this.value().trim() });
  }
}

/** Confirmation modale accessible (CDK Dialog : focus piégé, Échap = annuler). */
@Injectable({ providedIn: 'root' })
export class Confirm {
  private readonly dialog = inject(Dialog);

  private open(options: ConfirmOptions): Promise<Result | undefined> {
    const ref = this.dialog.open<Result>(ConfirmDialog, { data: options, backdropClass: ['bg-ink/40'], autoFocus: 'dialog' });
    return firstValueFrom(ref.closed);
  }

  async ask(options: ConfirmOptions): Promise<boolean> {
    return !!(await this.open(options));
  }

  /** Confirmation avec champ texte : la valeur saisie ('' si vide), ou null si annulé. */
  async prompt(options: ConfirmOptions & { input: NonNullable<ConfirmOptions['input']> }): Promise<string | null> {
    const r = await this.open(options);
    return r ? r.value : null;
  }
}
