import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { type ContractData, GROUP_LABELS, VARIABLES, type VariableDef, type VariableGroup } from '@shared/contrats';

/** Variables du dictionnaire, groupées ; un clic insère la variable au curseur de l'éditeur. */
@Component({
  selector: 'app-variable-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full min-h-0 flex-col">
      <div class="border-b border-slate-200 p-2">
        <label for="palette-search" class="sr-only">Rechercher une variable</label>
        <input #search id="palette-search" type="search" class="input py-1.5 text-xs" placeholder="Rechercher une variable…" [value]="query()" (input)="query.set(search.value)" />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-2" role="list" aria-label="Variables disponibles">
        @for (g of groups(); track g.group) {
          <p class="mb-1 mt-3 px-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-soft first:mt-1">{{ g.label }}</p>
          @for (v of g.items; track v.key) {
            @let val = valueOf(v);
            <button
              type="button"
              role="listitem"
              class="group flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-orchid-50 focus-visible:bg-orchid-50"
              (click)="picked.emit(v)"
              [title]="v.key + ' — ' + v.label + (val.text ? ' : ' + val.text : '')"
              [attr.aria-label]="'Insérer ' + v.label + ' (' + v.key + ')'"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs text-ink">
                  @if (used().has(v.key)) { <span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-orchid align-middle" aria-hidden="true"></span> }{{ v.label }}
                </span>
                <span class="block truncate font-mono text-[10.5px] text-orchid-700">{{ v.boolean ? '#si ' : '' }}{{ v.key }}</span>
              </span>
              <span class="max-w-[5.5rem] shrink-0 truncate text-[10.5px]" [class]="val.empty ? 'text-red-600' : 'text-ink-soft'">{{ val.empty ? 'vide' : val.text }}</span>
            </button>
          }
        } @empty {
          <p class="px-1.5 py-4 text-xs text-ink-soft">Aucune variable ne correspond.</p>
        }
      </div>
    </div>
  `,
})
export class VariablePalette {
  /** Valeurs de la mission d'aperçu (pour montrer ce qui sera inséré). */
  readonly data = input<ContractData>({});
  /** Variables déjà présentes dans le modèle. */
  readonly used = input<Set<string>>(new Set());
  readonly picked = output<VariableDef>();

  protected readonly query = signal('');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

  protected readonly groups = computed(() => {
    const q = this.query().trim().toLowerCase();
    const items = VARIABLES.filter((v) => !q || v.key.includes(q) || v.label.toLowerCase().includes(q));
    return (Object.keys(GROUP_LABELS) as VariableGroup[])
      .map((group) => ({ group, label: GROUP_LABELS[group], items: items.filter((v) => v.group === group) }))
      .filter((g) => g.items.length);
  });

  protected valueOf(v: VariableDef): { text: string; empty: boolean } {
    const value = this.data()[v.key];
    if (typeof value === 'boolean') return { text: value ? 'oui' : 'non', empty: false };
    if (v.key === 'contrat.numero') return { text: 'à l’émission', empty: false };
    return value ? { text: value, empty: false } : { text: '', empty: true };
  }

  focusSearch(): void {
    this.search().nativeElement.focus();
  }
}
