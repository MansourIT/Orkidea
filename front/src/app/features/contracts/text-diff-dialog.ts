import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { diffStats, lineDiff } from '@shared/contrats';

export interface TextDiffData {
  title: string;
  beforeLabel: string;
  before: string;
  after: string;
}

/** Différences ligne à ligne entre deux textes (ajustements d'un contrat par rapport à son modèle). */
@Component({
  selector: 'app-text-diff-dialog',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex max-h-[85dvh] w-[min(96vw,56rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="diff-titre">
      <header class="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
        <div class="min-w-0 flex-1">
          <h2 id="diff-titre" class="text-lg font-bold">{{ data.title }}</h2>
          <p class="text-xs text-ink-soft">
            Par rapport à {{ data.beforeLabel }} :
            <span class="font-medium text-emerald-700">+{{ stats().added }}</span> /
            <span class="font-medium text-red-700">−{{ stats().removed }}</span> ligne(s)
          </p>
        </div>
        <button type="button" class="btn-ghost p-2" (click)="ref.close()" aria-label="Fermer"><ng-icon name="lucideX" size="18" /></button>
      </header>
      <div class="min-h-0 flex-1 overflow-auto bg-slate-50 py-2 font-mono text-xs leading-6">
        @if (!stats().added && !stats().removed) {
          <p class="px-5 text-ink-soft">Aucune différence.</p>
        } @else {
          <table class="w-full border-collapse">
            <tbody>
              @for (d of diff(); track $index) {
                <tr [class]="d.op === '+' ? 'bg-emerald-50' : d.op === '-' ? 'bg-red-50' : ''">
                  <td class="w-10 select-none pr-2 text-right text-slate-400">{{ d.newLine ?? '' }}</td>
                  <td class="w-5 select-none text-center font-bold" [class]="d.op === '+' ? 'text-emerald-700' : 'text-red-700'">
                    <span aria-hidden="true">{{ d.op === '=' ? '' : d.op === '+' ? '+' : '−' }}</span><span class="sr-only">{{ d.op === '+' ? 'ajouté' : d.op === '-' ? 'supprimé' : '' }}</span>
                  </td>
                  <td class="whitespace-pre-wrap break-words pr-5" [class]="d.op === '+' ? 'text-emerald-900' : d.op === '-' ? 'text-red-900 line-through decoration-red-300' : 'text-slate-600'">{{ d.text || ' ' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>
  `,
})
export class TextDiffDialog {
  protected readonly data = inject<TextDiffData>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  protected readonly diff = computed(() => lineDiff(this.data.before, this.data.after));
  protected readonly stats = computed(() => diffStats(this.diff()));
}
