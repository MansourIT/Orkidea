import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { frDate } from '@shared/dates';
import { CONTRACT_STATUS_LABELS, type ContractDetail, type ContractSummary } from '@shared/types';
import { Api, apiError } from '../../core/api';
import { ContractActions } from './contract-actions';
import { EVENT_LABELS, STATUS_CLASSES } from './contract-page';

/** Panneau de suivi d'un contrat : fichiers, prochaines actions, historique. Se ferme avec `true` si le contrat a changé. */
@Component({
  selector: 'app-contract-drawer',
  imports: [NgIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="flex h-dvh w-[min(100vw,26rem)] flex-col bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="contrat-drawer-titre">
      <header class="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
        <div class="min-w-0 flex-1">
          <h2 id="contrat-drawer-titre" class="flex flex-wrap items-center gap-2 text-lg font-bold">
            {{ summary.number ?? 'Brouillon' }}
            <span class="rounded-full px-2 py-0.5 text-xs font-medium" [class]="statusClasses[(contract() ?? summary).status]">{{ statusLabels[(contract() ?? summary).status] }}</span>
          </h2>
          <p class="truncate text-sm text-ink-soft">{{ summary.client }} · {{ summary.mission.label }}</p>
        </div>
        <button type="button" class="btn-ghost p-2" (click)="ref.close(changed)" aria-label="Fermer"><ng-icon name="lucideX" size="18" /></button>
      </header>

      <div class="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
        @if (error()) { <p class="alert-error" role="alert">{{ error() }}</p> }
        @if (!contract()) {
          <p class="flex items-center gap-2 text-ink-soft" role="status"><ng-icon name="lucideLoaderCircle" size="16" class="animate-spin" aria-hidden="true" /> Chargement…</p>
        } @else {
          @let c = contract()!;
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt class="text-ink-soft">Consultant</dt><dd>{{ c.consultant }}</dd>
            <dt class="text-ink-soft">Modèle</dt><dd>{{ c.template.name }} v{{ c.template.version }}</dd>
            @if (c.issuedAt) { <dt class="text-ink-soft">Émis le</dt><dd>{{ date(c.issuedAt) }}</dd> }
            @if (c.sentAt) { <dt class="text-ink-soft">Envoyé le</dt><dd>{{ date(c.sentAt) }}</dd> }
            @if (c.signedOn) { <dt class="text-ink-soft">Signé le</dt><dd>{{ date(c.signedOn) }}</dd> }
            @if (c.cancelReason) { <dt class="text-ink-soft">Motif d’annulation</dt><dd>{{ c.cancelReason }}</dd> }
          </dl>

          @if (c.number) {
            <section aria-labelledby="fichiers-titre">
              <h3 id="fichiers-titre" class="mb-2 font-semibold">Fichiers</h3>
              <a class="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:border-orchid-200" [href]="pdfUrl(c)" download>
                <span class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">PDF</span>
                <span class="min-w-0 flex-1"><span class="block font-medium">Contrat émis</span><span class="block truncate font-mono text-[11px] text-ink-soft" [title]="'SHA-256 ' + c.pdfSha256">{{ c.pdfSha256?.slice(0, 16) }}…</span></span>
                <ng-icon name="lucideDownload" size="16" class="text-ink-soft" aria-hidden="true" />
              </a>
              @if (c.signedPdfSha256) {
                <a class="mt-2 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2 hover:border-emerald-300" [href]="signedUrl(c)" download>
                  <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">PDF</span>
                  <span class="min-w-0 flex-1"><span class="block font-medium">Contrat signé</span><span class="block truncate font-mono text-[11px] text-ink-soft">{{ c.signedPdfSha256.slice(0, 16) }}…</span></span>
                  <ng-icon name="lucideDownload" size="16" class="text-ink-soft" aria-hidden="true" />
                </a>
              } @else if (c.status === 'EMIS' || c.status === 'ENVOYE') {
                <button type="button" class="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-3 text-ink-soft hover:border-orchid hover:text-orchid" (click)="uploadSigned(c)">
                  <ng-icon name="lucideDownload" size="16" class="rotate-180" aria-hidden="true" /> Déposer le PDF signé
                </button>
              }
            </section>
          }

          <section aria-labelledby="historique-drawer-titre">
            <h3 id="historique-drawer-titre" class="mb-2 font-semibold">Historique</h3>
            <ol class="space-y-2">
              @for (e of c.events; track $index) {
                <li class="flex gap-2">
                  <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" [class]="e.action === 'SIGNATURE' ? 'bg-emerald-500' : e.action === 'ANNULATION' ? 'bg-red-500' : e.action === 'MODIFICATION' || e.action === 'CREATION' ? 'bg-slate-300' : 'bg-orchid'" aria-hidden="true"></span>
                  <span><span class="font-medium">{{ eventLabels[e.action] }}</span>@if (e.comment) { · {{ e.comment }} }<span class="block text-xs text-ink-soft">{{ dateTime(e.createdAt) }} · {{ e.actor }}</span></span>
                </li>
              }
            </ol>
          </section>
        }
      </div>

      <footer class="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3">
        <a [routerLink]="['/admin/contrats', summary.id]" class="btn-ghost mr-auto px-2 text-sm" (click)="ref.close(changed)">Ouvrir le contrat</a>
        @if (contract(); as c) {
          @if (c.status === 'BROUILLON') {
            <a [routerLink]="['/admin/contrats', c.id]" class="btn-primary text-sm" (click)="ref.close(changed)">Relire et émettre</a>
          } @else if (c.status === 'EMIS') {
            <button type="button" class="btn-secondary text-sm" (click)="uploadSigned(c)">Déposer signé</button>
            <button type="button" class="btn-primary text-sm" (click)="markSent(c)"><ng-icon name="lucideSend" size="14" aria-hidden="true" /> Marquer envoyé</button>
          } @else if (c.status === 'ENVOYE') {
            <button type="button" class="btn-primary text-sm" (click)="uploadSigned(c)">Déposer le PDF signé</button>
          } @else if (c.status === 'SIGNE') {
            <button type="button" class="btn-ghost text-sm" (click)="uploadSigned(c)">Remplacer le PDF signé</button>
          }
        }
      </footer>
    </aside>
  `,
})
export class ContractDrawer implements OnInit {
  protected readonly summary = inject<ContractSummary>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly api = inject(Api);
  private readonly actions = inject(ContractActions);

  protected readonly statusLabels = CONTRACT_STATUS_LABELS;
  protected readonly statusClasses = STATUS_CLASSES;
  protected readonly eventLabels = EVENT_LABELS;
  protected readonly contract = signal<ContractDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected changed = false;

  protected readonly date = (iso: string) => frDate(iso.slice(0, 10));
  protected readonly dateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
  protected readonly pdfUrl = (c: ContractDetail) => this.api.contractPdfUrl(c.id);
  protected readonly signedUrl = (c: ContractDetail) => this.api.contractSignedPdfUrl(c.id);

  async ngOnInit(): Promise<void> {
    try {
      this.contract.set(await this.api.contract(this.summary.id));
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  private async run(action: Promise<ContractDetail | null>): Promise<void> {
    this.error.set(null);
    try {
      const c = await action;
      if (c) {
        this.contract.set(c);
        this.changed = true;
      }
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  markSent(c: ContractDetail): Promise<void> {
    return this.run(this.actions.markSent(c));
  }

  uploadSigned(c: ContractDetail): Promise<void> {
    return this.run(this.actions.uploadSigned(c));
  }
}
