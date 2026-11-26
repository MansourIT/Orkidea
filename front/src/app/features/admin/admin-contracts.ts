import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TemplateList } from '../contracts/template-list';
import { Segmented, type SegmentOption } from '../../ui/segmented';
import { ContractReadiness } from './contract-readiness';

type View = 'modeles' | 'donnees';

const VIEWS: SegmentOption<View>[] = [
  { value: 'modeles', label: 'Modèles' },
  { value: 'donnees', label: 'Données à compléter' },
];

/** Onglet Contrats : modèles (« contrats mères ») et données nécessaires aux contrats. */
@Component({
  selector: 'app-admin-contracts',
  imports: [Segmented, TemplateList, ContractReadiness],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Contrats de prestation</h2>
        <p class="text-sm text-ink-soft">Modèles en Markdown avec variables, remplis avec les données des missions.</p>
      </div>
      <app-segmented label="Vue" [options]="views" [value]="view()" (valueChange)="view.set($event)" />
    </div>
    @if (view() === 'modeles') { <app-template-list /> } @else { <app-contract-readiness /> }
  `,
})
export class AdminContracts {
  protected readonly views = VIEWS;
  protected readonly view = signal<View>('modeles');
}
