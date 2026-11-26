import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Block, Inline } from '@shared/contrats';
import { VARIABLES } from '@shared/contrats';

const LABELS = new Map(VARIABLES.map((v) => [v.key, v.label]));

/** Rendu « papier » d'un contrat (blocs Markdown remplis), variables surlignées au besoin. */
@Component({
  selector: 'app-contract-preview',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .paper { font-family: Georgia, 'Times New Roman', serif; }
    .paper h1 { font-size: 1.15rem; font-weight: 700; text-align: center; text-transform: uppercase; letter-spacing: 0.02em; margin: 0 0 1rem; }
    .paper h2 { font-size: 0.98rem; font-weight: 700; margin: 1.25rem 0 0.4rem; }
    .paper h3 { font-size: 0.9rem; font-weight: 700; font-style: italic; margin: 1rem 0 0.3rem; }
    .paper p { margin: 0 0 0.6rem; }
    .paper ul, .paper ol { margin: 0 0 0.6rem 1.25rem; }
    .paper ul { list-style: disc; }
    .paper ol { list-style: decimal; }
    .paper hr { border: 0; border-top: 1px solid #cbd5e1; margin: 1rem 0; }
  `,
  template: `
    <article class="paper rounded-sm bg-white px-8 py-10 text-[13px] leading-relaxed text-[#222] shadow-[0_2px_12px_rgba(27,35,64,0.1)] sm:px-12" [attr.aria-label]="label()">
      @for (b of blocks(); track $index) {
        @switch (b.t) {
          @case ('h') {
            @if (b.level === 1) { <h1><ng-container [ngTemplateOutlet]="inl" [ngTemplateOutletContext]="{ $implicit: b.c }" /></h1> }
            @else if (b.level === 2) { <h2><ng-container [ngTemplateOutlet]="inl" [ngTemplateOutletContext]="{ $implicit: b.c }" /></h2> }
            @else { <h3><ng-container [ngTemplateOutlet]="inl" [ngTemplateOutletContext]="{ $implicit: b.c }" /></h3> }
          }
          @case ('p') { <p><ng-container [ngTemplateOutlet]="inl" [ngTemplateOutletContext]="{ $implicit: b.c }" /></p> }
          @case ('ul') { <ul>@for (item of b.items; track $index) { <li><ng-container [ngTemplateOutlet]="inl" [ngTemplateOutletContext]="{ $implicit: item }" /></li> }</ul> }
          @case ('ol') { <ol>@for (item of b.items; track $index) { <li><ng-container [ngTemplateOutlet]="inl" [ngTemplateOutletContext]="{ $implicit: item }" /></li> }</ol> }
          @case ('hr') { <hr /> }
          @case ('pageBreak') {
            <div class="my-6 flex items-center gap-3 font-sans text-[10px] uppercase tracking-wider text-slate-400" role="separator"><span class="h-px flex-1 border-t border-dashed border-slate-300"></span>Saut de page<span class="h-px flex-1 border-t border-dashed border-slate-300"></span></div>
          }
        }
      } @empty {
        <p class="text-center font-sans text-sm text-slate-400">Le modèle est vide.</p>
      }
    </article>

    <ng-template #inl let-nodes>
      @for (n of asInlines(nodes); track $index) {
        @switch (n.t) {
          @case ('text') {{{ n.v }}}
          @case ('br') {<br />}
          @case ('strong') {<strong><ng-container [ngTemplateOutlet]="inl" [ngTemplateOutletContext]="{ $implicit: n.c }" /></strong>}
          @case ('em') {<em><ng-container [ngTemplateOutlet]="inl" [ngTemplateOutletContext]="{ $implicit: n.c }" /></em>}
          @case ('var') {
            @if (n.state === 'missing') {
              <span class="rounded-sm bg-red-50 px-1 font-sans text-[11px] text-red-700 ring-1 ring-red-200" [title]="n.key">{{ labelOf(n.key) }} manquant</span>
            } @else if (n.state === 'deferred') {
              <span class="rounded-sm bg-slate-100 px-1 font-sans text-[11px] italic text-slate-500" [title]="n.key">{{ n.v }}</span>
            } @else if (highlight()) {
              <mark class="whitespace-pre-line rounded-sm border-b border-dotted border-orchid bg-orchid-50 text-inherit" [title]="n.key">{{ n.v }}</mark>
            } @else {<span class="whitespace-pre-line">{{ n.v }}</span>}
          }
        }
      }
    </ng-template>
  `,
})
export class ContractPreview {
  readonly blocks = input.required<Block[]>();
  readonly highlight = input(true);
  readonly label = input('Aperçu du contrat');
  protected asInlines = (x: unknown) => x as Inline[];
  protected labelOf = (key: string) => LABELS.get(key) ?? key;
}
