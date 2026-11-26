import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, output, viewChild } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { VARIABLE_KEYS } from '@shared/contrats';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Coloration du texte source (même métrique que le champ de saisie, posé par-dessus). */
export function highlightSource(source: string): string {
  return (
    source
      .split('\n')
      .map((line) => {
        const heading = /^#{1,3}\s/.test(line);
        const html = escapeHtml(line).replace(/\{\{([^{}]*)\}\}/g, (all, raw: string) => {
          const tag = raw.trim();
          const cls =
            tag === 'n' || tag === 'saut_de_page'
              ? 'tok-special'
              : /^[#/]/.test(tag)
                ? 'tok-block'
                : VARIABLE_KEYS.has(tag)
                  ? 'tok-var'
                  : 'tok-bad';
          return `<span class="${cls}">${all}</span>`;
        });
        return heading ? `<span class="tok-heading">${html}</span>` : html;
      })
      .join('\n') + '\n '
  );
}

type Action = 'h2' | 'article' | 'bold' | 'italic' | 'list' | 'if' | 'pageBreak';

/** Éditeur du texte Markdown d'un modèle : barre d'outils, coloration des variables, insertion au curseur. */
@Component({
  selector: 'app-template-source',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    .src { font: 13px/1.7 ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace; padding: 12px 14px; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; }
    .tb { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 6px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #5b6275; }
    .tb:hover { filter: brightness(0.96); background-color: #f1f5f9; }
    :host ::ng-deep .tok-var { color: #5a3d96; background: #ece4f8; border-radius: 3px; }
    :host ::ng-deep .tok-block { color: #8a5300; background: #fef3e2; border-radius: 3px; }
    :host ::ng-deep .tok-special { color: #0f766e; background: #ccfbf1; border-radius: 3px; }
    :host ::ng-deep .tok-bad { color: #a2331f; background: #fdecea; border-radius: 3px; text-decoration: underline wavy #e46134; }
    :host ::ng-deep .tok-heading { font-weight: 700; color: #1b2340; }
  `,
  template: `
    <div class="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-2 py-1.5" role="toolbar" aria-label="Mise en forme">
      <button type="button" class="tb" (click)="apply('h2')" title="Titre" aria-label="Titre">T</button>
      <button type="button" class="tb whitespace-nowrap" (click)="apply('article')" title="Nouvel article numéroté" aria-label="Nouvel article numéroté">Art. n</button>
      <span class="mx-1 h-5 w-px bg-slate-200" aria-hidden="true"></span>
      <button type="button" class="tb font-bold" (click)="apply('bold')" title="Gras (Ctrl+B)" aria-label="Gras">B</button>
      <button type="button" class="tb italic" (click)="apply('italic')" title="Italique (Ctrl+I)" aria-label="Italique">I</button>
      <button type="button" class="tb" (click)="apply('list')" title="Liste à puces" aria-label="Liste à puces">•≡</button>
      <span class="mx-1 h-5 w-px bg-slate-200" aria-hidden="true"></span>
      <button type="button" class="tb bg-orchid-50 text-orchid-700" (click)="variableRequested.emit()" title="Insérer une variable" aria-label="Insérer une variable">{{ '{' }}x{{ '}' }}</button>
      <button type="button" class="tb bg-amber-50 text-amber-800" (click)="apply('if')" title="Bloc conditionnel" aria-label="Bloc conditionnel">si</button>
      <button type="button" class="tb" (click)="apply('pageBreak')" title="Saut de page" aria-label="Saut de page"><ng-icon name="lucideFileText" size="14" aria-hidden="true" /></button>
      <span class="ml-auto pr-1 text-[11px] font-medium text-ink-soft">Markdown</span>
    </div>
    <div class="relative min-h-0 flex-1 overflow-hidden bg-white">
      <pre #pre class="src pointer-events-none absolute inset-0 m-0 overflow-hidden text-slate-700" aria-hidden="true" [innerHTML]="highlighted()"></pre>
      <textarea
        #area
        class="src absolute inset-0 h-full w-full resize-none border-0 bg-transparent text-transparent caret-ink outline-none selection:bg-orchid-200/60"
        spellcheck="false"
        [attr.aria-label]="label()"
        [readOnly]="readonly()"
        [value]="value()"
        (input)="value.set(area.value)"
        (scroll)="pre.scrollTop = area.scrollTop; pre.scrollLeft = area.scrollLeft"
        (keydown)="onKey($event)"
      ></textarea>
    </div>
  `,
})
export class TemplateSource {
  readonly value = model.required<string>();
  readonly readonly = input(false);
  readonly label = input('Texte du modèle');
  readonly variableRequested = output<void>();
  readonly saveRequested = output<void>();

  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');
  protected readonly highlighted = computed(() => highlightSource(this.value()));

  /** Remplace la sélection par `text` (ou l'entoure de `before` / `after`), puis replace le curseur. */
  private edit(fn: (selected: string) => { text: string; caret?: number }): void {
    if (this.readonly()) return;
    const el = this.area().nativeElement;
    const { selectionStart: start, selectionEnd: end } = el;
    const { text, caret } = fn(el.value.slice(start, end));
    el.focus();
    el.setRangeText(text, start, end, 'end');
    if (caret !== undefined) el.setSelectionRange(start + caret, start + caret);
    this.value.set(el.value);
  }

  /** Insère du texte au curseur (variables de la palette). */
  insert(text: string): void {
    this.edit(() => ({ text }));
  }

  /** Place le curseur au début d'une ligne (clic sur une erreur). */
  goToLine(line: number): void {
    const el = this.area().nativeElement;
    const lines = el.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    const lineHeight = 13 * 1.7;
    el.scrollTop = Math.max(0, (line - 4) * lineHeight);
  }

  focus(): void {
    this.area().nativeElement.focus();
  }

  apply(action: Action): void {
    const atLineStart = () => {
      const el = this.area().nativeElement;
      return el.selectionStart === 0 || el.value[el.selectionStart - 1] === '\n';
    };
    const nl = atLineStart() ? '' : '\n';
    switch (action) {
      case 'h2':
        return this.edit((s) => ({ text: `${nl}## ${s || 'Titre'}` }));
      case 'article':
        return this.edit((s) => ({ text: `${nl}## Article {{n}} – ${s || 'Intitulé'}\n\n` }));
      case 'bold':
        return this.edit((s) => (s ? { text: `**${s}**` } : { text: '****', caret: 2 }));
      case 'italic':
        return this.edit((s) => (s ? { text: `*${s}*` } : { text: '**', caret: 1 }));
      case 'list':
        return this.edit((s) => ({ text: nl + (s || 'Élément').split('\n').map((l) => `- ${l}`).join('\n') }));
      case 'if':
        return this.edit((s) => ({ text: `${nl}{{#si mission.validation_client}}\n${s || 'Texte affiché seulement si la condition est vraie.'}\n{{/si}}\n` }));
      case 'pageBreak':
        return this.edit(() => ({ text: `${nl}\n{{saut_de_page}}\n\n` }));
    }
  }

  protected onKey(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.saveRequested.emit();
    } else if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      this.apply('bold');
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      this.apply('italic');
    }
  }
}
