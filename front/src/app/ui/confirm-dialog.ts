import { Dialog, DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primaire' | 'danger';
}

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-[min(92vw,28rem)] rounded-2xl bg-white p-6 shadow-xl" role="alertdialog" aria-labelledby="confirm-titre" aria-describedby="confirm-message">
      <h2 id="confirm-titre" class="text-lg font-bold">{{ data.title }}</h2>
      <p id="confirm-message" class="mt-2 text-sm whitespace-pre-line text-ink-soft">{{ data.message }}</p>
      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close(false)">{{ data.cancelLabel ?? 'Annuler' }}</button>
        <button type="button" [class]="data.tone === 'danger' ? 'btn bg-red-600 text-white hover:bg-red-700' : 'btn-primary'" (click)="ref.close(true)" cdkFocusInitial>
          {{ data.confirmLabel ?? 'Confirmer' }}
        </button>
      </div>
    </div>
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmOptions>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
}

/** Confirmation modale accessible (CDK Dialog : focus piégé, Échap = annuler). */
@Injectable({ providedIn: 'root' })
export class Confirm {
  private readonly dialog = inject(Dialog);

  async ask(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open<boolean>(ConfirmDialog, { data: options, backdropClass: ['bg-ink/40'], autoFocus: 'dialog' });
    return (await firstValueFrom(ref.closed)) === true;
  }
}
