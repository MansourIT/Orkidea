import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { frDate } from '@shared/dates';
import { CONTRACT_STATUS_LABELS, type ContractSummary } from '@shared/types';
import { Api, apiError } from '../../core/api';
import { STATUS_CLASSES } from './contract-page';
import { GenerateContractDialog, type GenerateContractData } from './generate-contract-dialog';

/** Ouvre la génération d'un contrat puis le brouillon créé. */
export function openGenerateContract(dialog: Dialog, router: Router, data: GenerateContractData): void {
  dialog
    .open<string, GenerateContractData>(GenerateContractDialog, { data, ariaLabel: 'Générer un contrat' })
    .closed.subscribe((id) => {
      if (id) void router.navigate(['/admin/contrats', id]);
    });
}

/** Contrats générés (tous, ou ceux d'une mission en mode compact). */
@Component({
  selector: 'app-contract-list',
  imports: [NgIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!compact()) {
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <p class="text-sm text-ink-soft">Brouillons à relire, contrats émis à transmettre au client.</p>
        <button type="button" class="btn-primary ml-auto" (click)="generate()"><ng-icon name="lucideFileText" size="16" aria-hidden="true" /> Générer un contrat</button>
      </div>
    }
    @if (error()) { <div class="alert-error mb-3" role="alert">{{ error() }}</div> }

    @if (!contracts()) {
      <p class="flex items-center gap-2 p-4 text-sm text-ink-soft" role="status"><ng-icon name="lucideLoaderCircle" size="16" class="animate-spin" aria-hidden="true" /> Chargement…</p>
    } @else if (compact()) {
      <ul class="space-y-1.5">
        @for (c of contracts(); track c.id) {
          <li>
            <a [routerLink]="['/admin/contrats', c.id]" class="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-orchid-200 hover:bg-orchid-50/40">
              <ng-icon name="lucideFileText" size="14" class="text-ink-soft" aria-hidden="true" />
              <span class="font-medium">{{ c.number ?? 'Brouillon' }}</span>
              <span class="truncate text-xs text-ink-soft">{{ c.template.name }} v{{ c.template.version }}</span>
              <span class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" [class]="statusClasses[c.status]">{{ statusLabels[c.status] }}</span>
            </a>
          </li>
        } @empty {
          <li class="text-sm text-ink-soft">Aucun contrat pour cette mission.</li>
        }
      </ul>
    } @else {
      <div class="card overflow-x-auto">
        <table class="w-full min-w-[46rem] text-sm">
          <thead class="bg-slate-50 text-left text-xs text-ink-soft">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">N°</th>
              <th scope="col" class="px-4 py-3 font-medium">Client · mission</th>
              <th scope="col" class="px-4 py-3 font-medium">Consultant</th>
              <th scope="col" class="px-4 py-3 font-medium">Modèle</th>
              <th scope="col" class="px-4 py-3 font-medium">Statut</th>
              <th scope="col" class="px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            @for (c of contracts(); track c.id) {
              <tr class="cursor-pointer border-t border-slate-100 hover:bg-slate-50" (click)="open(c)">
                <td class="px-4 py-3 font-medium"><a [routerLink]="['/admin/contrats', c.id]" class="hover:text-orchid hover:underline" (click)="$event.stopPropagation()">{{ c.number ?? 'Brouillon' }}</a></td>
                <td class="px-4 py-3"><span class="font-medium text-ink">{{ c.client }}</span><span class="block text-xs text-ink-soft">{{ c.mission.label }}</span></td>
                <td class="px-4 py-3">{{ c.consultant }}</td>
                <td class="px-4 py-3 text-ink-soft">{{ c.template.name }} · v{{ c.template.version }}</td>
                <td class="px-4 py-3"><span class="rounded-full px-2 py-0.5 text-xs font-medium" [class]="statusClasses[c.status]">{{ statusLabels[c.status] }}</span></td>
                <td class="px-4 py-3 text-ink-soft">{{ date(c.issuedAt ?? c.createdAt) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="px-4 py-10 text-center text-ink-soft">Aucun contrat. Générez-en un depuis une mission ou avec le bouton ci-dessus.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class ContractList implements OnInit {
  private readonly api = inject(Api);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  /** Mission dont on affiche les contrats (mode compact du panneau mission). */
  readonly missionId = input<string | null>(null);
  readonly compact = input(false);
  protected readonly statusLabels = CONTRACT_STATUS_LABELS;
  protected readonly statusClasses = STATUS_CLASSES;
  protected readonly contracts = signal<ContractSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly date = (iso: string) => frDate(iso.slice(0, 10));

  async ngOnInit(): Promise<void> {
    try {
      this.contracts.set(await this.api.contracts(this.missionId() ?? undefined));
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  open(c: ContractSummary): void {
    void this.router.navigate(['/admin/contrats', c.id]);
  }

  generate(): void {
    openGenerateContract(this.dialog, this.router, { missionId: this.missionId() ?? undefined });
  }
}
