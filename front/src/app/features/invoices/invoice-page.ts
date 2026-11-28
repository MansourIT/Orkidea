import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { frDate, todayInParis } from '@shared/dates';
import { INVOICE_STATUS_LABELS, formatCents, invoiceTotals, lineTotal, monthLabel, type InvoiceLine, type InvoiceUnit } from '@shared/factures';
import type { InvoiceDetail } from '@shared/types';
import { Api, apiError } from '../../core/api';
import type { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { Confirm } from '../../ui/confirm-dialog';
import { INVOICE_STATUS_CLASSES } from './admin-invoices';

const EVENT_LABELS: Record<InvoiceDetail['events'][number]['action'], string> = {
  CREATION: 'Brouillon créé',
  MODIFICATION: 'Lignes modifiées',
  EMISSION: 'Émise',
  ENVOI: 'Envoyée',
  PAIEMENT: 'Paiement reçu',
  AVOIR: 'Avoir',
};

/** Ligne en cours d'édition : prix unitaire saisi en euros. */
interface EditLine {
  description: string;
  quantity: number;
  unit: InvoiceUnit;
  price: number;
}

const toEdit = (l: InvoiceLine): EditLine => ({ description: l.description, quantity: l.quantity, unit: l.unit, price: l.unitPrice / 100 });
const toLine = (l: EditLine): InvoiceLine => ({ description: l.description.trim(), quantity: Number(l.quantity), unit: l.unit, unitPrice: Math.round(Number(l.price) * 100) });

/** Facture ou avoir : brouillon modifiable, émission, PDF, envoi, paiement, avoir. */
@Component({
  selector: 'app-invoice-page',
  imports: [NgIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    @if (!invoice()) {
      <div class="card flex items-center justify-center gap-2 p-16 text-ink-soft" role="status">
        @if (loadError()) { <span class="text-red-700">{{ loadError() }}</span> } @else { <ng-icon name="lucideLoaderCircle" size="20" class="animate-spin" aria-hidden="true" /> Chargement… }
      </div>
    } @else {
      @let inv = invoice()!;
      @let draft = inv.status === 'BROUILLON';
      <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <a routerLink="/admin" [queryParams]="{ onglet: 'factures' }" class="btn-ghost -ml-2 px-2 text-sm"><ng-icon name="lucideChevronLeft" size="16" aria-hidden="true" /> Factures</a>
        <div class="min-w-0">
          <h1 class="text-xl font-bold">{{ inv.kind === 'AVOIR' ? 'Avoir' : 'Facture' }} {{ inv.number ?? 'en brouillon' }}</h1>
          <p class="text-sm text-ink-soft">{{ inv.client.name }} · {{ inv.mission.label }} · {{ inv.consultant }} · {{ label(inv.month) }}</p>
        </div>
        <span class="rounded-full px-2.5 py-0.5 text-xs font-medium" [class]="statusClasses[inv.status]">{{ statusLabels[inv.status] }}</span>
        @if (inv.overdue) { <span class="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">En retard</span> }
        <div class="ml-auto flex flex-wrap items-center gap-2">
          @if (draft) {
            <button type="button" class="btn-ghost py-1.5 text-sm text-red-700" (click)="remove()">Supprimer le brouillon</button>
            <button type="button" class="btn-secondary py-1.5 text-sm" (click)="save()" [disabled]="busy() || !dirty() || !valid()">
              <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideSave'" size="14" [class.animate-spin]="busy()" aria-hidden="true" /> Enregistrer
            </button>
            <button type="button" class="btn-primary py-1.5 text-sm" (click)="issue()" [disabled]="busy() || inv.missing.length > 0 || !valid()">
              <ng-icon name="lucideLock" size="14" aria-hidden="true" /> Émettre
            </button>
          } @else {
            <a class="btn-secondary py-1.5 text-sm" [href]="pdfUrl()" download><ng-icon name="lucideDownload" size="14" aria-hidden="true" /> PDF</a>
            @if (inv.kind === 'FACTURE' && inv.status === 'EMISE') {
              <button type="button" class="btn-secondary py-1.5 text-sm" (click)="sent()"><ng-icon name="lucideSend" size="14" aria-hidden="true" /> Marquer envoyée</button>
            }
            @if (inv.kind === 'FACTURE' && (inv.status === 'EMISE' || inv.status === 'ENVOYEE')) {
              <button type="button" class="btn-primary py-1.5 text-sm" (click)="paid()"><ng-icon name="lucideCircleCheck" size="14" aria-hidden="true" /> Paiement reçu</button>
            }
            @if (inv.kind === 'FACTURE' && !inv.related) {
              <button type="button" class="btn-ghost py-1.5 text-sm text-red-700" (click)="credit()">Créer un avoir</button>
            }
          }
        </div>
      </div>

      @if (error()) { <div class="alert-error mb-3 whitespace-pre-line" role="alert">{{ error() }}</div> }
      @if (draft && inv.missing.length) {
        <div class="alert-warning mb-3" role="status">
          <ng-icon name="lucideCircleAlert" size="16" aria-hidden="true" />
          <div>
            <p class="font-medium">Mentions obligatoires manquantes avant l’émission :</p>
            <ul class="mt-1 list-disc pl-5 text-sm">@for (m of inv.missing; track m) { <li>{{ m }}</li> }</ul>
            @if (missingSeller()) { <a class="mt-1 mr-3 inline-block text-sm font-medium text-orchid underline" routerLink="/admin" [queryParams]="{ onglet: 'parametres' }" target="_blank">Ouvrir les paramètres ↗</a> }
            @if (missingClient()) { <a class="mt-1 inline-block text-sm font-medium text-orchid underline" routerLink="/admin" [queryParams]="{ onglet: 'clients' }" target="_blank">Ouvrir les clients ↗</a> }
            <button type="button" class="btn-ghost ml-2 px-2 py-0.5 text-xs" (click)="reload()">Actualiser</button>
          </div>
        </div>
      }
      @if (inv.related; as r) {
        <p class="mb-3 text-sm">
          {{ inv.kind === 'AVOIR' ? 'Avoir de la facture' : 'Annulée par l’avoir' }}
          <a class="font-medium text-orchid underline" [routerLink]="['/admin/factures', r.id]">{{ r.number ?? 'en brouillon' }}</a>
        </p>
      }

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <section class="card overflow-hidden" aria-label="Lignes de la facture">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[40rem] text-sm">
              <thead class="bg-slate-50 text-left text-xs text-ink-soft">
                <tr>
                  <th scope="col" class="px-3 py-2 font-medium">Désignation</th>
                  <th scope="col" class="w-24 px-3 py-2 text-right font-medium">Qté</th>
                  <th scope="col" class="w-28 px-3 py-2 font-medium">Unité</th>
                  <th scope="col" class="w-32 px-3 py-2 text-right font-medium">PU HT</th>
                  <th scope="col" class="w-32 px-3 py-2 text-right font-medium">Total HT</th>
                  @if (draft) { <th scope="col" class="w-10"><span class="sr-only">Supprimer</span></th> }
                </tr>
              </thead>
              <tbody>
                @for (l of lines(); track $index; let i = $index) {
                  <tr class="border-t border-slate-100">
                    @if (draft) {
                      <td class="px-2 py-1.5"><input class="input py-1 text-sm" [value]="l.description" (input)="setLine(i, 'description', $any($event.target).value)" [attr.aria-label]="'Désignation ligne ' + (i + 1)" maxlength="200" /></td>
                      <td class="px-2 py-1.5"><input type="number" step="0.25" class="input py-1 text-right text-sm" [value]="l.quantity" (input)="setLine(i, 'quantity', +$any($event.target).value)" [attr.aria-label]="'Quantité ligne ' + (i + 1)" /></td>
                      <td class="px-2 py-1.5">
                        <select class="input py-1 text-sm" [value]="l.unit" (change)="setLine(i, 'unit', $any($event.target).value)" [attr.aria-label]="'Unité ligne ' + (i + 1)">
                          @for (u of units; track u.value) { <option [value]="u.value" [selected]="u.value === l.unit">{{ u.label }}</option> }
                        </select>
                      </td>
                      <td class="px-2 py-1.5"><input type="number" step="0.01" min="0" class="input py-1 text-right text-sm" [value]="l.price" (input)="setLine(i, 'price', +$any($event.target).value)" [attr.aria-label]="'Prix unitaire ligne ' + (i + 1)" /></td>
                    } @else {
                      <td class="px-3 py-2">{{ l.description }}</td>
                      <td class="px-3 py-2 text-right">{{ qty(l.quantity) }}</td>
                      <td class="px-3 py-2">{{ unitLabel(l.unit) }}</td>
                      <td class="px-3 py-2 text-right">{{ money(l.price * 100) }}</td>
                    }
                    <td class="px-3 py-2 text-right font-medium">{{ money(rowTotal(l)) }}</td>
                    @if (draft) {
                      <td class="px-1"><button type="button" class="btn-ghost p-1" (click)="removeLine(i)" [disabled]="lines().length === 1" [attr.aria-label]="'Supprimer la ligne ' + (i + 1)"><ng-icon name="lucideX" size="14" /></button></td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (draft) {
            <div class="border-t border-slate-100 px-3 py-2">
              <button type="button" class="btn-ghost px-2 py-1 text-xs" (click)="addLine()"><ng-icon name="lucidePlus" size="14" aria-hidden="true" /> Ajouter une ligne</button>
            </div>
          }
          <dl class="ml-auto w-full max-w-xs space-y-1 border-t border-slate-100 px-5 py-4 text-sm">
            <div class="flex justify-between"><dt class="text-ink-soft">Total HT</dt><dd>{{ money(totals().ht) }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-soft">TVA {{ inv.vatRate }} %</dt><dd>{{ money(totals().vat) }}</dd></div>
            <div class="flex justify-between text-base font-bold"><dt>Total TTC</dt><dd>{{ money(totals().ttc) }}</dd></div>
          </dl>
        </section>

        <aside class="space-y-4 lg:sticky lg:top-20">
          <section class="card p-4 text-sm" aria-labelledby="infos-facture">
            <h2 id="infos-facture" class="mb-2 font-semibold">Informations</h2>
            <label for="inv-po" class="label">Bon de commande</label>
            <input id="inv-po" class="input py-1.5 text-sm" [value]="purchaseOrder()" (input)="purchaseOrder.set($any($event.target).value)" [readOnly]="!draft" maxlength="80" />
            <label for="inv-notes" class="label mt-3">Note sur la facture</label>
            <textarea id="inv-notes" class="input min-h-16 text-sm" [value]="notes()" (input)="notes.set($any($event.target).value)" [readOnly]="!draft" maxlength="1000"></textarea>
            <dl class="mt-3 space-y-1">
              @if (inv.issueDate) { <div class="flex justify-between gap-2"><dt class="text-ink-soft">Émise le</dt><dd>{{ date(inv.issueDate) }}</dd></div> }
              @if (inv.dueDate) { <div class="flex justify-between gap-2"><dt class="text-ink-soft">Échéance</dt><dd>{{ date(inv.dueDate) }}</dd></div> }
              @if (inv.paidOn) { <div class="flex justify-between gap-2"><dt class="text-ink-soft">Payée le</dt><dd>{{ date(inv.paidOn) }}</dd></div> }
              @if (inv.pdfSha256) { <div class="flex justify-between gap-2"><dt class="text-ink-soft">Empreinte PDF</dt><dd class="font-mono text-xs" [title]="inv.pdfSha256">{{ inv.pdfSha256.slice(0, 10) }}…</dd></div> }
            </dl>
          </section>
          <section class="card p-4 text-sm" aria-labelledby="hist-facture">
            <h2 id="hist-facture" class="mb-2 font-semibold">Historique</h2>
            <ol class="space-y-2">
              @for (e of inv.events; track $index) {
                <li><span class="font-medium">{{ eventLabels[e.action] }}</span>@if (e.comment) { · {{ e.comment }} }<span class="block text-xs text-ink-soft">{{ dateTime(e.createdAt) }} · {{ e.actor }}</span></li>
              }
            </ol>
          </section>
        </aside>
      </div>
    }
  `,
})
export class InvoicePage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  private readonly router = inject(Router);
  readonly id = input.required<string>();

  protected readonly invoice = signal<InvoiceDetail | null>(null);
  protected readonly lines = signal<EditLine[]>([]);
  protected readonly notes = signal('');
  protected readonly purchaseOrder = signal('');
  private readonly saved = signal('');
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly statusLabels = INVOICE_STATUS_LABELS;
  protected readonly statusClasses = INVOICE_STATUS_CLASSES;
  protected readonly eventLabels = EVENT_LABELS;
  protected readonly units: Array<{ value: InvoiceUnit; label: string }> = [
    { value: 'jour', label: 'jour' },
    { value: 'heure', label: 'heure' },
    { value: 'forfait', label: 'forfait' },
  ];
  protected readonly money = formatCents;
  protected readonly label = monthLabel;
  protected readonly date = (iso: string) => frDate(iso.slice(0, 10));
  protected readonly dateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
  protected readonly qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  protected readonly unitLabel = (u: InvoiceUnit) => this.units.find((x) => x.value === u)?.label ?? u;
  protected readonly rowTotal = (l: EditLine) => lineTotal(toLine(l));
  protected readonly pdfUrl = computed(() => this.api.invoicePdfUrl(this.id()));
  protected readonly missingSeller = computed(() => (this.invoice()?.missing ?? []).some((m) => m.includes('Paramètres')));
  protected readonly missingClient = computed(() => (this.invoice()?.missing ?? []).some((m) => m.includes('client')));

  private readonly snapshot = computed(() => JSON.stringify({ l: this.lines().map(toLine), n: this.notes().trim(), p: this.purchaseOrder().trim() }));
  protected readonly dirty = computed(() => this.invoice()?.status === 'BROUILLON' && this.snapshot() !== this.saved());
  protected readonly totals = computed(() => invoiceTotals(this.lines().map(toLine), this.invoice()?.vatRate ?? 0));
  protected readonly valid = computed(() => this.lines().length > 0 && this.lines().every((l) => l.description.trim() && Number.isFinite(Number(l.quantity)) && Number(l.price) >= 0));

  async ngOnInit(): Promise<void> {
    try {
      this.set(await this.api.invoice(this.id()));
    } catch (err) {
      this.loadError.set(apiError(err).error);
    }
  }

  private set(inv: InvoiceDetail): void {
    this.invoice.set(inv);
    this.lines.set(inv.lines.map(toEdit));
    this.notes.set(inv.notes ?? '');
    this.purchaseOrder.set(inv.purchaseOrder ?? '');
    this.saved.set(this.snapshot());
  }

  private fail(err: unknown): void {
    const e = apiError(err);
    this.error.set(e.details?.length ? `${e.error} :\n${e.details.join('\n')}` : e.error);
  }

  async reload(): Promise<void> {
    try {
      const inv = await this.api.invoice(this.id());
      if (this.dirty()) this.invoice.set(inv);
      else this.set(inv);
    } catch (err) {
      this.fail(err);
    }
  }

  protected setLine<K extends keyof EditLine>(i: number, key: K, value: EditLine[K]): void {
    this.lines.update((all) => all.map((l, k) => (k === i ? { ...l, [key]: value } : l)));
  }

  protected addLine(): void {
    this.lines.update((all) => [...all, { description: '', quantity: 1, unit: 'forfait', price: 0 }]);
  }

  protected removeLine(i: number): void {
    this.lines.update((all) => all.filter((_, k) => k !== i));
  }

  async save(): Promise<boolean> {
    const inv = this.invoice();
    if (!inv || !this.dirty()) return true;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.set(
        await this.api.updateInvoice(inv.id, {
          lines: this.lines().map(toLine),
          notes: this.notes().trim() || null,
          purchaseOrder: this.purchaseOrder().trim() || null,
          baseUpdatedAt: inv.updatedAt,
        }),
      );
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async issue(): Promise<void> {
    const inv = this.invoice()!;
    const ok = await this.confirm.ask({
      title: `Émettre ${inv.kind === 'AVOIR' ? 'l’avoir' : 'la facture'} ?`,
      message: `Un numéro lui est attribué et le PDF est produit (${formatCents(this.totals().ttc)} TTC). Elle ne pourra plus être modifiée ni supprimée : une erreur se corrige par un avoir.`,
      confirmLabel: 'Émettre',
    });
    if (!ok || !(await this.save())) return;
    this.busy.set(true);
    try {
      this.set(await this.api.issueInvoice(inv.id, this.invoice()!.updatedAt));
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  async sent(): Promise<void> {
    try {
      this.set(await this.api.markInvoiceSent(this.id()));
    } catch (err) {
      this.fail(err);
    }
  }

  async paid(): Promise<void> {
    const value = await this.confirm.prompt({
      title: 'Paiement reçu',
      message: 'Date à laquelle le paiement a été reçu (AAAA-MM-JJ).',
      confirmLabel: 'Enregistrer',
      input: { label: 'Date du paiement', required: true, initial: todayInParis() },
    });
    const paidOn = value?.trim();
    if (!paidOn) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
      this.error.set('Date invalide : format AAAA-MM-JJ attendu.');
      return;
    }
    try {
      this.set(await this.api.markInvoicePaid(this.id(), paidOn));
    } catch (err) {
      this.fail(err);
    }
  }

  async credit(): Promise<void> {
    const inv = this.invoice()!;
    const ok = await this.confirm.ask({
      title: `Créer un avoir pour ${inv.number} ?`,
      message: 'L’avoir annule la totalité de la facture. Il est créé en brouillon ; une fois émis, la mission pourra être refacturée pour ce mois.',
      confirmLabel: 'Créer l’avoir',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const { id } = await this.api.createCreditNote(inv.id);
      void this.router.navigate(['/admin/factures', id]);
    } catch (err) {
      this.fail(err);
    }
  }

  async remove(): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Supprimer ce brouillon ?', message: 'Le brouillon est supprimé ; la mission redevient « à facturer ».', confirmLabel: 'Supprimer', tone: 'danger' });
    if (!ok) return;
    try {
      await this.api.deleteInvoice(this.id());
      this.saved.set(this.snapshot());
      void this.router.navigate(['/admin'], { queryParams: { onglet: 'factures' } });
    } catch (err) {
      this.fail(err);
    }
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.dirty()) return true;
    return this.confirm.ask({ title: 'Facture non enregistrée', message: 'Vos modifications seront perdues.', confirmLabel: 'Quitter sans enregistrer', cancelLabel: 'Rester', tone: 'danger' });
  }

  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) e.preventDefault();
  }
}
