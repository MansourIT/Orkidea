import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ContractList } from '../contracts/contract-list';
import { TemplateList } from '../contracts/template-list';
import { Segmented, type SegmentOption } from '../../ui/segmented';
import { ContractReadiness } from './contract-readiness';

type View = 'contrats' | 'modeles' | 'donnees';

const VIEWS: SegmentOption<View>[] = [
  { value: 'contrats', label: 'Contrats' },
  { value: 'modeles', label: 'Modèles' },
  { value: 'donnees', label: 'Données à compléter' },
];

/** Onglet Contrats : modèles (« contrats mères ») et données nécessaires aux contrats. */
@Component({
  selector: 'app-admin-contracts',
  imports: [Segmented, ContractList, TemplateList, ContractReadiness],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Contrats de prestation</h2>
        <p class="text-sm text-ink-soft">Modèles en Markdown avec variables, remplis avec les données des missions.</p>
      </div>
      <app-segmented label="Vue" [options]="views" [value]="view()" (valueChange)="select($event)" />
    </div>
    @switch (view()) {
      @case ('contrats') { <app-contract-list /> }
      @case ('modeles') { <app-template-list /> }
      @case ('donnees') { <app-contract-readiness /> }
    }
  `,
})
export class AdminContracts {
  protected readonly views = VIEWS;
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** Vue dans l'URL (?vue=modeles) pour y revenir depuis l'éditeur. */
  protected readonly view = signal<View>(VIEWS.find((v) => v.value === this.route.snapshot.queryParamMap.get('vue'))?.value ?? 'contrats');

  protected select(view: View): void {
    this.view.set(view);
    void this.router.navigate([], { queryParams: { vue: view === 'contrats' ? null : view }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
