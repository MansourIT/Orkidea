import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { todayInParis } from '@shared/dates';
import type { ContractDetail, ContractSummary } from '@shared/types';
import { Api, apiError } from '../../core/api';

export interface SignedUploadData {
  contract: ContractSummary;
}

const MAX = 10 * 1024 * 1024;

/** Dépôt du PDF signé par le client, avec la date de signature. Se ferme avec le contrat à jour. */
@Component({
  selector: 'app-signed-upload-dialog',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="w-[min(94vw,30rem)] rounded-2xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="signe-titre" (submit)="$event.preventDefault(); upload()" novalidate>
      <h2 id="signe-titre" class="text-lg font-bold">{{ replacing ? 'Remplacer le PDF signé' : 'Déposer le PDF signé' }}</h2>
      <p class="mt-1 text-sm text-ink-soft">Contrat {{ c.number }} · {{ c.client }}. Le contrat passe au statut « Signé ».</p>

      <label for="signe-fichier" class="label mt-5">PDF signé (10 Mo au plus)</label>
      <label for="signe-fichier" class="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orchid"
             [class]="file() ? 'border-orchid bg-orchid-50' : 'border-slate-300 hover:border-orchid-200'"
             (dragover)="$event.preventDefault()" (drop)="drop($event)">
        <ng-icon [name]="file() ? 'lucideCircleCheck' : 'lucideDownload'" size="20" [class]="file() ? 'text-orchid' : 'text-ink-soft rotate-180'" aria-hidden="true" />
        @if (file(); as f) { <span class="font-medium text-ink">{{ f.name }}</span><span class="text-xs text-ink-soft">{{ size(f.size) }} · cliquer pour changer</span> }
        @else { <span class="font-medium text-ink">Choisir un fichier</span><span class="text-xs text-ink-soft">ou le glisser ici</span> }
        <input id="signe-fichier" type="file" accept="application/pdf,.pdf" class="sr-only" (change)="pick($any($event.target).files?.[0])" />
      </label>

      <label for="signe-date" class="label mt-4">Date de signature</label>
      <input id="signe-date" type="date" class="input w-48" [value]="signedOn()" [max]="today" [min]="minDate" (input)="signedOn.set($any($event.target).value)" />

      @if (error()) { <p class="alert-error mt-4" role="alert">{{ error() }}</p> }

      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close()">Annuler</button>
        <button type="submit" class="btn-primary" [disabled]="busy()">
          <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideCircleCheck'" size="16" [class.animate-spin]="busy()" aria-hidden="true" /> {{ replacing ? 'Remplacer' : 'Marquer signé' }}
        </button>
      </div>
    </form>
  `,
})
export class SignedUploadDialog {
  private readonly data = inject<SignedUploadData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<ContractDetail>>(DialogRef);
  private readonly api = inject(Api);
  protected readonly c = this.data.contract;
  protected readonly replacing = this.c.status === 'SIGNE';
  protected readonly today = todayInParis();
  protected readonly minDate = this.c.issuedAt?.slice(0, 10) ?? '';

  protected readonly file = signal<File | null>(null);
  protected readonly signedOn = signal(this.c.signedOn ?? this.today);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);

  pick(f: File | undefined): void {
    this.error.set(null);
    if (!f) return;
    if (f.type && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return this.error.set('Choisissez un fichier PDF.');
    if (f.size > MAX) return this.error.set('Fichier trop volumineux (10 Mo au plus).');
    this.file.set(f);
  }

  drop(e: DragEvent): void {
    e.preventDefault();
    this.pick(e.dataTransfer?.files?.[0]);
  }

  async upload(): Promise<void> {
    const f = this.file();
    if (!f) return this.error.set('Choisissez le PDF signé.');
    if (!this.signedOn()) return this.error.set('Indiquez la date de signature.');
    this.busy.set(true);
    this.error.set(null);
    try {
      this.ref.close(await this.api.uploadSignedContract(this.c.id, f, this.signedOn()));
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }
}
