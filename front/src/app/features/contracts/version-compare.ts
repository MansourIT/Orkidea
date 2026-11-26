import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { diffStats, lineDiff } from '@shared/contrats';
import type { TemplateVersionInfo } from '@shared/types';
import { Api, apiError } from '../../core/api';

export interface VersionCompareData {
  templateId: string;
  versions: TemplateVersionInfo[];
  /** Texte en cours dans l'éditeur (éventuellement non enregistré). */
  current: string;
  /** Version proposée par défaut (dernière publiée). */
  initial: number;
}

/** Comparaison du texte en cours avec une version précédente du modèle. */
@Component({
  selector: 'app-version-compare',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex max-h-[85dvh] w-[min(96vw,56rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="compare-titre">
      <header class="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
        <h2 id="compare-titre" class="text-lg font-bold">Comparer les versions</h2>
        <label class="ml-auto flex items-center gap-2 text-sm">
          <span class="text-ink-soft">Texte actuel comparé à</span>
          <select class="input w-auto py-1.5" [value]="version()" (change)="load(+$any($event.target).value)" aria-label="Version de référence">
            @for (v of data.versions; track v.version) {
              <option [value]="v.version" [selected]="v.version === version()">v{{ v.version }} {{ v.status === 'PUBLIEE' ? 'publiée' : 'brouillon enregistré' }}</option>
            }
          </select>
        </label>
        <button type="button" class="btn-ghost p-2" (click)="ref.close()" aria-label="Fermer"><ng-icon name="lucideX" size="18" /></button>
      </header>
      <p class="flex gap-4 border-b border-slate-100 px-5 py-2 text-xs" aria-live="polite">
        @if (stats(); as s) {
          @if (!s.added && !s.removed) { <span class="text-ink-soft">Aucune différence.</span> }
          @else {
            <span class="font-medium text-emerald-700">+{{ s.added }} ligne{{ s.added > 1 ? 's' : '' }} ajoutée{{ s.added > 1 ? 's' : '' }}</span>
            <span class="font-medium text-red-700">−{{ s.removed }} ligne{{ s.removed > 1 ? 's' : '' }} supprimée{{ s.removed > 1 ? 's' : '' }}</span>
          }
        }
      </p>
      <div class="min-h-0 flex-1 overflow-auto bg-slate-50 py-2 font-mono text-xs leading-6">
        @if (error()) { <p class="alert-error mx-5" role="alert">{{ error() }}</p> }
        @else if (!diff()) { <p class="px-5 text-ink-soft" role="status">Chargement…</p> }
        @else {
          <table class="w-full border-collapse">
            <caption class="sr-only">Lignes supprimées (−) et ajoutées (+) par rapport à la v{{ version() }}</caption>
            <tbody>
              @for (d of diff(); track $index) {
                <tr [class]="d.op === '+' ? 'bg-emerald-50' : d.op === '-' ? 'bg-red-50' : ''">
                  <td class="w-10 select-none pr-2 text-right text-slate-400">{{ d.oldLine ?? '' }}</td>
                  <td class="w-10 select-none pr-2 text-right text-slate-400">{{ d.newLine ?? '' }}</td>
                  <td class="w-5 select-none text-center font-bold" [class]="d.op === '+' ? 'text-emerald-700' : d.op === '-' ? 'text-red-700' : 'text-slate-300'">
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
export class VersionCompare implements OnInit {
  protected readonly data = inject<VersionCompareData>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  private readonly api = inject(Api);

  protected readonly version = signal(this.data.initial);
  private readonly base = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly diff = computed(() => (this.base() === null ? null : lineDiff(this.base()!, this.data.current)));
  protected readonly stats = computed(() => (this.diff() ? diffStats(this.diff()!) : null));

  ngOnInit(): void {
    void this.load(this.data.initial);
  }

  async load(version: number): Promise<void> {
    this.version.set(version);
    this.base.set(null);
    this.error.set(null);
    try {
      this.base.set((await this.api.templateVersion(this.data.templateId, version)).body);
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }
}
