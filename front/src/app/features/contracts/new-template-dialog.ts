import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { DEMO_TEMPLATE } from '@shared/contrats';
import { Api, apiError } from '../../core/api';

type Start = 'demo' | 'blank' | 'file';

export interface NewTemplateData {
  /** Duplication d'un modèle existant : nom et texte de départ imposés. */
  duplicate?: { name: string; body: string };
}

const OPTIONS: Array<{ value: Start; title: string; text: string }> = [
  { value: 'demo', title: 'Modèle de démonstration', text: 'Contrat de régie au TJM, à adapter.' },
  { value: 'file', title: 'Importer un fichier .md', text: 'Votre contrat type au format Markdown.' },
  { value: 'blank', title: 'Page blanche', text: 'Commencer de zéro.' },
];

const MAX_FILE = 200_000;

/** Création d'un modèle (démonstration, import .md, page blanche ou duplication). Se ferme avec l'id créé. */
@Component({
  selector: 'app-new-template-dialog',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="w-[min(94vw,32rem)] rounded-2xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="new-tpl-titre" (submit)="$event.preventDefault(); create()" novalidate>
      <h2 id="new-tpl-titre" class="text-lg font-bold">{{ data.duplicate ? 'Dupliquer le modèle' : 'Nouveau modèle de contrat' }}</h2>
      <p class="mt-1 text-sm text-ink-soft">Le modèle est créé en brouillon v1 ; il servira aux contrats une fois publié.</p>

      <label for="tpl-name" class="label mt-5">Nom du modèle</label>
      <input id="tpl-name" class="input" [value]="name()" (input)="name.set($any($event.target).value)" maxlength="120" placeholder="Ex. : Prestation en régie (TJM)" [attr.aria-invalid]="submitted() && !name().trim()" />

      @if (!data.duplicate) {
        <p class="label mt-4" id="tpl-start">Point de départ</p>
        <div class="grid gap-2" role="radiogroup" aria-labelledby="tpl-start">
          @for (o of options; track o.value) {
            <label class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orchid"
                   [class]="start() === o.value ? 'border-orchid bg-orchid-50' : 'border-slate-200 hover:border-slate-300'">
              <input type="radio" name="tpl-start" class="mt-1 accent-orchid" [checked]="start() === o.value" (change)="start.set(o.value)" />
              <span><span class="block text-sm font-semibold text-ink">{{ o.title }}</span><span class="text-xs text-ink-soft">{{ o.text }}</span></span>
            </label>
          }
        </div>
        @if (start() === 'file') {
          <div class="mt-3">
            <label for="tpl-file" class="label">Fichier Markdown (.md, .txt)</label>
            <input id="tpl-file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-orchid-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-orchid-700" (change)="readFile($event)" />
            @if (fileInfo()) { <p class="mt-1 text-xs text-ink-soft">{{ fileInfo() }}</p> }
          </div>
        }
      }

      @if (error()) { <p class="alert-error mt-4" role="alert">{{ error() }}</p> }

      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close()">Annuler</button>
        <button type="submit" class="btn-primary" [disabled]="busy()">
          <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucidePlus'" size="16" [class.animate-spin]="busy()" aria-hidden="true" /> Créer et ouvrir
        </button>
      </div>
    </form>
  `,
})
export class NewTemplateDialog {
  protected readonly data = inject<NewTemplateData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<string>>(DialogRef);
  private readonly api = inject(Api);
  protected readonly options = OPTIONS;

  protected readonly name = signal(this.data.duplicate ? `${this.data.duplicate.name} (copie)` : '');
  protected readonly start = signal<Start>('demo');
  private readonly fileBody = signal<string | null>(null);
  protected readonly fileInfo = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async readFile(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    this.fileBody.set(null);
    this.fileInfo.set(null);
    this.error.set(null);
    if (!file) return;
    if (file.size > MAX_FILE) {
      this.error.set('Fichier trop volumineux (200 Ko au plus).');
      return;
    }
    const text = (await file.text()).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    this.fileBody.set(text);
    this.fileInfo.set(`${file.name} · ${text.split('\n').length} lignes`);
    if (!this.name().trim()) this.name.set(file.name.replace(/\.(md|markdown|txt)$/i, ''));
  }

  async create(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    const name = this.name().trim();
    if (!name) {
      this.error.set('Donnez un nom au modèle.');
      return;
    }
    let body = this.data.duplicate?.body ?? (this.start() === 'demo' ? DEMO_TEMPLATE : this.start() === 'blank' ? '# Titre du contrat\n\n## Article {{n}} – Objet\n\n' : this.fileBody());
    if (body === null) {
      this.error.set('Choisissez un fichier .md à importer.');
      return;
    }
    body = body.slice(0, MAX_FILE);
    this.busy.set(true);
    try {
      const { id } = await this.api.createTemplate({ name, body });
      this.ref.close(id);
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }
}
