import { Dialog } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { frDate } from '@shared/dates';
import { CONTRACT_STATUS_LABELS, type ContractStatus, type ContractSummary, type Mission } from '@shared/types';
import { Api, apiError } from '../../core/api';
import { ContractDrawer } from './contract-drawer';
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

type Filter = 'TOUS' | Exclude<ContractStatus, 'ANNULE'> | 'SANS_CONTRAT';

const KPIS: Array<{ id: Exclude<Filter, 'TOUS'>; label: string; hint: string }> = [
  { id: 'BROUILLON', label: 'Brouillons', hint: 'à relire et émettre' },
  { id: 'EMIS', label: 'À envoyer', hint: 'PDF à transmettre au client' },
  { id: 'ENVOYE', label: 'En attente de signature', hint: 'envoyés, non signés' },
  { id: 'SIGNE', label: 'Signés', hint: 'PDF signé déposé' },
  { id: 'SANS_CONTRAT', label: 'Missions sans contrat signé', hint: 'missions actives' },
];

/** Contrats générés (tous, ou ceux d'une mission en mode compact). */
@Component({
  selector: 'app-contract-list',
  imports: [NgIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!compact()) {
      <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Filtrer par étape">
        @for (k of kpis; track k.id) {
          <button type="button" class="card p-3 text-left transition-shadow hover:shadow-md" [attr.aria-pressed]="filter() === k.id"
                  [class]="filter() === k.id ? 'ring-2 ring-orchid' : ''" (click)="toggle(k.id)">
            <span class="block text-2xl font-bold" [class.text-amber-700]="k.id === 'SANS_CONTRAT' && counts()[k.id] > 0">{{ counts()[k.id] }}</span>
            <span class="block text-sm font-medium text-ink">{{ k.label }}</span>
            <span class="block text-xs text-ink-soft">{{ k.hint }}</span>
          </button>
        }
      </div>
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" class="input max-w-xs" placeholder="Client, consultant, n°…" aria-label="Rechercher un contrat" [value]="query()" (input)="query.set($any($event.target).value)" />
        <label class="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" class="accent-orchid" [checked]="showCancelled()" (change)="showCancelled.set($any($event.target).checked)" /> Annulés</label>
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
    } @else if (filter() === 'SANS_CONTRAT') {
      <div class="card overflow-x-auto">
        <table class="w-full min-w-[36rem] text-sm">
          <caption class="sr-only">Missions actives sans contrat signé</caption>
          <thead class="bg-slate-50 text-left text-xs text-ink-soft">
            <tr><th scope="col" class="px-4 py-3 font-medium">Mission</th><th scope="col" class="px-4 py-3 font-medium">Consultant</th><th scope="col" class="px-4 py-3 font-medium">Contrat en cours</th><th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            @for (m of withoutSigned(); track m.mission.id) {
              <tr class="border-t border-slate-100">
                <td class="px-4 py-3"><span class="font-medium text-ink">{{ m.mission.client }}</span><span class="block text-xs text-ink-soft">{{ m.mission.label }}</span></td>
                <td class="px-4 py-3">{{ m.mission.consultant }}</td>
                <td class="px-4 py-3">
                  @if (m.current; as c) { <button type="button" class="rounded-full px-2 py-0.5 text-xs font-medium hover:underline" [class]="statusClasses[c.status]" (click)="open(c)">{{ c.number ?? 'Brouillon' }} · {{ statusLabels[c.status] }}</button> }
                  @else { <span class="text-ink-soft">Aucun</span> }
                </td>
                <td class="px-4 py-3 text-right">
                  @if (!m.current) { <button type="button" class="btn-secondary px-3 py-1 text-xs" (click)="generateFor(m.mission.id)">Générer</button> }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="px-4 py-10 text-center text-ink-soft">Toutes les missions actives ont un contrat signé.</td></tr>
            }
          </tbody>
        </table>
      </div>
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
            @for (c of filtered(); track c.id) {
              <tr class="cursor-pointer border-t border-slate-100 hover:bg-slate-50" [class.opacity-60]="c.status === 'ANNULE'" (click)="open(c)">
                <td class="px-4 py-3 font-medium"><button type="button" class="hover:text-orchid hover:underline" (click)="$event.stopPropagation(); open(c)">{{ c.number ?? 'Brouillon' }}</button></td>
                <td class="px-4 py-3"><span class="font-medium text-ink">{{ c.client }}</span><span class="block text-xs text-ink-soft">{{ c.mission.label }}</span></td>
                <td class="px-4 py-3">{{ c.consultant }}</td>
                <td class="px-4 py-3 text-ink-soft">{{ c.template.name }} · v{{ c.template.version }}</td>
                <td class="px-4 py-3"><span class="rounded-full px-2 py-0.5 text-xs font-medium" [class]="statusClasses[c.status]">{{ statusLabels[c.status] }}</span></td>
                <td class="px-4 py-3 text-ink-soft">{{ date(c.signedOn ?? c.sentAt ?? c.issuedAt ?? c.createdAt) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="px-4 py-10 text-center text-ink-soft">{{ contracts()!.length ? 'Aucun contrat ne correspond.' : 'Aucun contrat. Générez-en un depuis une mission ou avec le bouton ci-dessus.' }}</td></tr>
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
  private readonly overlay = inject(Overlay);

  /** Mission dont on affiche les contrats (mode compact du panneau mission). */
  readonly missionId = input<string | null>(null);
  readonly compact = input(false);
  protected readonly statusLabels = CONTRACT_STATUS_LABELS;
  protected readonly statusClasses = STATUS_CLASSES;
  protected readonly contracts = signal<ContractSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly date = (iso: string) => frDate(iso.slice(0, 10));
  protected readonly kpis = KPIS;
  protected readonly filter = signal<Filter>('TOUS');
  protected readonly query = signal('');
  protected readonly showCancelled = signal(false);
  private readonly missions = signal<Mission[]>([]);

  /** Missions actives sans contrat signé, avec leur contrat le plus avancé (hors annulés). */
  protected readonly withoutSigned = computed(() => {
    const contracts = (this.contracts() ?? []).filter((c) => c.status !== 'ANNULE');
    const order: ContractStatus[] = ['ENVOYE', 'EMIS', 'BROUILLON'];
    return this.missions()
      .filter((m) => m.active && !contracts.some((c) => c.mission.id === m.id && c.status === 'SIGNE'))
      .map((mission) => ({
        mission,
        current: contracts.filter((c) => c.mission.id === mission.id).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0] ?? null,
      }));
  });

  protected readonly counts = computed(() => {
    const list = this.contracts() ?? [];
    const n = (s: ContractStatus) => list.filter((c) => c.status === s).length;
    return { BROUILLON: n('BROUILLON'), EMIS: n('EMIS'), ENVOYE: n('ENVOYE'), SIGNE: n('SIGNE'), SANS_CONTRAT: this.withoutSigned().length };
  });

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    return (this.contracts() ?? []).filter(
      (c) =>
        (f === 'TOUS' ? this.showCancelled() || c.status !== 'ANNULE' : c.status === f) &&
        (!q || [c.number, c.client, c.consultant, c.mission.label, c.template.name].some((x) => x?.toLowerCase().includes(q))),
    );
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const [contracts, missions] = await Promise.all([this.api.contracts(this.missionId() ?? undefined), this.compact() ? Promise.resolve([]) : this.api.missions()]);
      this.contracts.set(contracts);
      this.missions.set(missions);
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  protected toggle(f: Exclude<Filter, 'TOUS'>): void {
    this.filter.set(this.filter() === f ? 'TOUS' : f);
  }

  /** Panneau de suivi (liste complète) ; page du contrat en mode compact. */
  open(c: ContractSummary): void {
    if (this.compact()) {
      void this.router.navigate(['/admin/contrats', c.id]);
      return;
    }
    const ref = this.dialog.open<boolean, ContractSummary>(ContractDrawer, {
      data: c,
      positionStrategy: this.overlay.position().global().right('0').top('0'),
      height: '100dvh',
      backdropClass: ['bg-ink/40'],
      ariaLabel: `Contrat ${c.number ?? 'en brouillon'}`,
    });
    ref.closed.subscribe((changed) => {
      if (changed) void this.load();
    });
  }

  protected generateFor(missionId: string): void {
    openGenerateContract(this.dialog, this.router, { missionId });
  }

  generate(): void {
    openGenerateContract(this.dialog, this.router, { missionId: this.missionId() ?? undefined });
  }
}
