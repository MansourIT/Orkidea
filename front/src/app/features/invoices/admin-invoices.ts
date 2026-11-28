import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { addMonths, frDate, monthOf, todayInParis } from '@shared/dates';
import { INVOICE_STATUS_LABELS, formatCents, monthLabel, type InvoiceStatus } from '@shared/factures';
import { formatMinutes } from '@shared/astreintes';
import type { BillableItem, InvoiceSummary } from '@shared/types';
import { Api, apiError } from '../../core/api';

export const INVOICE_STATUS_CLASSES: Record<InvoiceStatus, string> = {
  BROUILLON: 'bg-slate-100 text-slate-700',
  EMISE: 'bg-orchid-50 text-orchid-700',
  ENVOYEE: 'bg-sky-50 text-sky-700',
  PAYEE: 'bg-emerald-50 text-emerald-700',
};

type Filter = 'TOUTES' | 'BROUILLON' | 'A_ENVOYER' | 'ATTENTE' | 'RETARD' | 'PAYEE';

/** Onglet Factures : missions à facturer du mois (CRA validés), factures et avoirs, suivi des paiements. */
@Component({
  selector: 'app-admin-invoices',
  imports: [NgIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Factures</h2>
        <p class="text-sm text-ink-soft">Générées depuis les CRA validés : jours × TJM, astreintes et interventions.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-ghost p-2" (click)="shift(-1)" aria-label="Mois précédent"><ng-icon name="lucideChevronLeft" size="16" /></button>
        <input type="month" class="input w-40 py-1.5" aria-label="Mois facturé" [value]="month()" (change)="setMonth($any($event.target).value)" />
        <button type="button" class="btn-ghost p-2" (click)="shift(1)" aria-label="Mois suivant"><ng-icon name="lucideChevronRight" size="16" /></button>
        <a class="btn-secondary py-1.5 text-sm" [href]="journalUrl()" download><ng-icon name="lucideDownload" size="14" aria-hidden="true" /> Journal des ventes {{ month().slice(0, 4) }}</a>
      </div>
    </div>

    @if (error()) { <div class="alert-error mb-4" role="alert">{{ error() }}</div> }

    <!-- À facturer -->
    <section class="card mb-6 overflow-hidden" aria-labelledby="a-facturer-titre">
      <header class="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
        <h3 id="a-facturer-titre" class="font-semibold">À facturer · {{ label(month()) }}</h3>
        <span class="text-xs text-ink-soft">CRA validés ou clôturés, pas encore facturés</span>
      </header>
      @if (!billable()) {
        <p class="flex items-center gap-2 px-5 py-5 text-sm text-ink-soft" role="status"><ng-icon name="lucideLoaderCircle" size="16" class="animate-spin" aria-hidden="true" /> Chargement…</p>
      } @else {
        <ul class="divide-y divide-slate-100">
          @for (b of billable(); track b.missionId) {
            <li class="flex flex-wrap items-center gap-3 px-5 py-3">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-ink">{{ b.client }} · {{ b.mission }}</p>
                <p class="text-xs text-ink-soft">
                  {{ b.consultant }} · {{ days(b.days) }}@if (b.onCallDays) { · {{ b.onCallDays }} j d’astreinte }@if (b.interventionMinutes) { · {{ minutes(b.interventionMinutes) }} d’intervention }
                </p>
                @for (p of b.problems; track p) { <p class="mt-1 text-xs text-red-700">{{ p }} – <a class="font-medium underline" routerLink="/admin" [queryParams]="{ onglet: 'missions' }">compléter la mission</a></p> }
              </div>
              @if (!b.problems.length) { <span class="text-sm font-semibold">{{ money(b.totalHt) }} HT</span> }
              <button type="button" class="btn-primary px-3 py-1.5 text-sm" (click)="create(b)" [disabled]="busy() || b.problems.length > 0">Créer la facture</button>
            </li>
          } @empty {
            <li class="px-5 py-6 text-sm text-ink-soft">Rien à facturer pour {{ label(month()) }}. Les missions apparaissent ici dès que le CRA du consultant est validé.</li>
          }
        </ul>
      }
    </section>

    <!-- Factures -->
    <div class="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Filtrer les factures">
      @for (k of kpis(); track k.id) {
        <button type="button" class="card p-3 text-left transition-shadow hover:shadow-md" [attr.aria-pressed]="filter() === k.id" [class]="filter() === k.id ? 'ring-2 ring-orchid' : ''" (click)="toggle(k.id)">
          <span class="block text-lg font-bold" [class.text-red-700]="k.id === 'RETARD' && k.count > 0">{{ k.value }}</span>
          <span class="block text-sm font-medium text-ink">{{ k.label }}</span>
          <span class="block text-xs text-ink-soft">{{ k.count }} pièce{{ k.count > 1 ? 's' : '' }}</span>
        </button>
      }
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full min-w-[48rem] text-sm">
        <thead class="bg-slate-50 text-left text-xs text-ink-soft">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">N°</th>
            <th scope="col" class="px-4 py-3 font-medium">Client · mission</th>
            <th scope="col" class="px-4 py-3 font-medium">Période</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">TTC</th>
            <th scope="col" class="px-4 py-3 font-medium">Statut</th>
            <th scope="col" class="px-4 py-3 font-medium">Échéance</th>
          </tr>
        </thead>
        <tbody>
          @for (i of filtered(); track i.id) {
            <tr class="cursor-pointer border-t border-slate-100 hover:bg-slate-50" (click)="open(i)">
              <td class="px-4 py-3 font-medium">
                <a [routerLink]="['/admin/factures', i.id]" class="hover:text-orchid hover:underline" (click)="$event.stopPropagation()">{{ i.number ?? 'Brouillon' }}</a>
                @if (i.kind === 'AVOIR') { <span class="ml-1 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-800">AVOIR</span> }
              </td>
              <td class="px-4 py-3"><span class="font-medium text-ink">{{ i.client.name }}</span><span class="block text-xs text-ink-soft">{{ i.mission.label }} · {{ i.consultant }}</span></td>
              <td class="px-4 py-3 text-ink-soft">{{ label(i.month) }}</td>
              <td class="px-4 py-3 text-right font-medium">{{ money(i.totalTtc) }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" [class]="statusClasses[i.status]">{{ statusLabels[i.status] }}</span>
                @if (i.overdue) { <span class="ml-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">En retard</span> }
              </td>
              <td class="px-4 py-3 text-ink-soft">{{ i.paidOn ? 'Payée le ' + date(i.paidOn) : i.dueDate ? date(i.dueDate) : '—' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="px-4 py-10 text-center text-ink-soft">Aucune facture.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminInvoices implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  /** Par défaut : le mois précédent (on facture le mois écoulé). */
  protected readonly month = signal(addMonths(monthOf(todayInParis()), -1));
  protected readonly billable = signal<BillableItem[] | null>(null);
  protected readonly invoices = signal<InvoiceSummary[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly filter = signal<Filter>('TOUTES');
  protected readonly statusLabels = INVOICE_STATUS_LABELS;
  protected readonly statusClasses = INVOICE_STATUS_CLASSES;
  protected readonly money = formatCents;
  protected readonly label = monthLabel;
  protected readonly minutes = formatMinutes;
  protected readonly date = (iso: string) => frDate(iso.slice(0, 10));
  protected readonly days = (n: number) => `${n.toLocaleString('fr-FR')} j`;
  protected readonly journalUrl = computed(() => this.api.salesJournalUrl(this.month().slice(0, 4)));

  private readonly match: Record<Filter, (i: InvoiceSummary) => boolean> = {
    TOUTES: () => true,
    BROUILLON: (i) => i.status === 'BROUILLON',
    A_ENVOYER: (i) => i.status === 'EMISE' && i.kind === 'FACTURE',
    ATTENTE: (i) => i.kind === 'FACTURE' && (i.status === 'EMISE' || i.status === 'ENVOYEE'),
    RETARD: (i) => i.overdue,
    PAYEE: (i) => i.status === 'PAYEE',
  };
  protected readonly filtered = computed(() => this.invoices().filter(this.match[this.filter()]));
  protected readonly kpis = computed(() => {
    const all = this.invoices();
    const sum = (f: Filter) => all.filter(this.match[f]).reduce((n, i) => n + i.totalTtc, 0);
    const count = (f: Filter) => all.filter(this.match[f]).length;
    const ids: Array<[Exclude<Filter, 'TOUTES'>, string]> = [
      ['BROUILLON', 'Brouillons'],
      ['A_ENVOYER', 'À envoyer'],
      ['ATTENTE', 'En attente de paiement'],
      ['RETARD', 'En retard'],
      ['PAYEE', 'Payées'],
    ];
    return ids.map(([id, label]) => ({ id, label, count: count(id), value: formatCents(sum(id)) }));
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.billable.set(null);
    this.error.set(null);
    try {
      const [billable, invoices] = await Promise.all([this.api.billable(this.month()), this.api.invoices()]);
      this.billable.set(billable);
      this.invoices.set(invoices);
    } catch (err) {
      this.error.set(apiError(err).error);
      this.billable.set([]);
    }
  }

  protected setMonth(m: string): void {
    if (!/^\d{4}-\d{2}$/.test(m)) return;
    this.month.set(m);
    void this.load();
  }

  protected shift(n: number): void {
    this.setMonth(addMonths(this.month(), n));
  }

  protected toggle(f: Exclude<Filter, 'TOUTES'>): void {
    this.filter.set(this.filter() === f ? 'TOUTES' : f);
  }

  open(i: InvoiceSummary): void {
    void this.router.navigate(['/admin/factures', i.id]);
  }

  async create(b: BillableItem): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const { id } = await this.api.createInvoice(b.missionId, b.month);
      void this.router.navigate(['/admin/factures', id]);
    } catch (err) {
      const e = apiError(err);
      this.error.set(e.details?.length ? `${e.error} : ${e.details.join(' ; ')}` : e.error);
    } finally {
      this.busy.set(false);
    }
  }
}
