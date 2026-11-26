import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { frDate } from '@shared/dates';
import { VARIABLES, type VariableDef, type VariableGroup, diffStats, lineDiff, parseMarkdown, parseTemplate, renderTemplate } from '@shared/contrats';
import { CONTRACT_STATUS_LABELS, type ContractDetail, type ContractEventAction, type ContractStatus } from '@shared/types';
import { Api, apiError } from '../../core/api';
import type { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { Confirm } from '../../ui/confirm-dialog';
import { ContractPreview } from './contract-preview';
import { TemplateSource } from './template-source';
import { ContractActions } from './contract-actions';
import { TextDiffDialog, type TextDiffData } from './text-diff-dialog';
import { VariablePalette } from './variable-palette';

const VARS = new Map(VARIABLES.map((v) => [v.key, v]));

/** Onglet d'administration où se complète chaque groupe de données. */
const FIX_TAB: Record<VariableGroup, { tab: string; label: string }> = {
  societe: { tab: 'parametres', label: 'Paramètres › Société' },
  client: { tab: 'clients', label: 'Fiche client' },
  consultant: { tab: 'consultants', label: 'Consultants' },
  mission: { tab: 'missions', label: 'Mission' },
  contrat: { tab: 'contrats', label: 'Contrat' },
};

export const STATUS_CLASSES: Record<ContractStatus, string> = {
  BROUILLON: 'bg-slate-100 text-slate-700',
  EMIS: 'bg-orchid-50 text-orchid-700',
  ENVOYE: 'bg-sky-50 text-sky-700',
  SIGNE: 'bg-emerald-50 text-emerald-700',
  ANNULE: 'bg-red-50 text-red-700',
};

export const EVENT_LABELS: Record<ContractEventAction, string> = {
  CREATION: 'Brouillon créé',
  MODIFICATION: 'Texte ajusté',
  EMISSION: 'Émis',
  ENVOI: 'Envoyé',
  SIGNATURE: 'Signé',
  ANNULATION: 'Annulé',
};

/** Contrat d'une mission : relecture et ajustement du brouillon, émission, puis consultation du contrat figé. */
@Component({
  selector: 'app-contract-page',
  imports: [RouterLink, NgIcon, TemplateSource, VariablePalette, ContractPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    @if (!contract()) {
      <div class="card flex items-center justify-center gap-2 p-16 text-ink-soft" role="status">
        @if (loadError()) { <span class="text-red-700">{{ loadError() }}</span> }
        @else { <ng-icon name="lucideLoaderCircle" size="20" class="animate-spin" aria-hidden="true" /> Chargement… }
      </div>
    } @else {
      @let c = contract()!;
      <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <a routerLink="/admin" [queryParams]="{ onglet: 'contrats' }" class="btn-ghost -ml-2 px-2 text-sm"><ng-icon name="lucideChevronLeft" size="16" aria-hidden="true" /> Contrats</a>
        <div class="min-w-0">
          <h1 class="text-xl font-bold">{{ c.number ? 'Contrat ' + c.number : 'Contrat en brouillon' }}</h1>
          <p class="text-sm text-ink-soft">{{ c.mission.label }} · {{ c.client }} · {{ c.consultant }} · {{ c.template.name }} v{{ c.template.version }}</p>
        </div>
        <span class="rounded-full px-2.5 py-0.5 text-xs font-medium" [class]="statusClasses[c.status]">{{ statusLabels[c.status] }}</span>

        <div class="ml-auto flex flex-wrap items-center gap-2">
          @if (c.status === 'BROUILLON') {
            <button type="button" class="btn-ghost py-1.5 text-sm text-red-700" (click)="cancel()">Annuler le contrat</button>
            <a class="btn-secondary py-1.5 text-sm" [href]="draftPdfUrl()" target="_blank" rel="noopener"><ng-icon name="lucideFileText" size="14" aria-hidden="true" /> Aperçu PDF</a>
            <button type="button" class="btn-secondary py-1.5 text-sm" (click)="save()" [disabled]="busy() || !dirty()">
              <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideSave'" size="14" [class.animate-spin]="busy()" aria-hidden="true" /> Enregistrer
            </button>
            <button type="button" class="btn-primary py-1.5 text-sm" (click)="issue()" [disabled]="busy() || !ready()" [title]="ready() ? '' : 'Complétez les données et corrigez les erreurs avant d’émettre'">
              <ng-icon name="lucideLock" size="14" aria-hidden="true" /> Émettre le contrat
            </button>
          } @else {
            @if (c.status !== 'ANNULE' && c.status !== 'SIGNE') {
              <button type="button" class="btn-ghost py-1.5 text-sm text-red-700" (click)="cancel()">Annuler le contrat</button>
            }
            @if (c.number) {
              <a class="btn-secondary py-1.5 text-sm" [href]="pdfUrl()" download><ng-icon name="lucideDownload" size="14" aria-hidden="true" /> PDF émis</a>
            }
            @if (c.status === 'EMIS') {
              <button type="button" class="btn-secondary py-1.5 text-sm" (click)="uploadSigned()">Déposer le PDF signé</button>
              <button type="button" class="btn-primary py-1.5 text-sm" (click)="markSent()"><ng-icon name="lucideSend" size="14" aria-hidden="true" /> Marquer envoyé</button>
            } @else if (c.status === 'ENVOYE') {
              <button type="button" class="btn-primary py-1.5 text-sm" (click)="uploadSigned()"><ng-icon name="lucideCircleCheck" size="14" aria-hidden="true" /> Déposer le PDF signé</button>
            } @else if (c.status === 'SIGNE') {
              <button type="button" class="btn-ghost py-1.5 text-sm" (click)="uploadSigned()">Remplacer le PDF signé</button>
              <a class="btn-primary py-1.5 text-sm" [href]="signedPdfUrl()" download><ng-icon name="lucideDownload" size="14" aria-hidden="true" /> PDF signé</a>
            }
          }
        </div>
      </div>

      @if (error()) { <div class="alert-error mb-3 whitespace-pre-line" role="alert">{{ error() }}</div> }
      @if (c.status === 'ANNULE') { <div class="alert-error mb-3" role="status">Contrat annulé : {{ c.cancelReason }}</div> }

      @if (c.status === 'BROUILLON') {
        <!-- Contrôles avant émission -->
        <section class="card mb-4 grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto]" aria-label="Contrôles avant émission">
          <div class="min-w-0">
            @if (ready()) {
              <p class="flex items-center gap-2 text-sm font-medium text-emerald-700"><ng-icon name="lucideCircleCheck" size="16" aria-hidden="true" /> Prêt à émettre : toutes les données sont renseignées.</p>
            } @else {
              @if (errors().length) {
                <p class="flex items-center gap-2 text-sm font-medium text-red-700"><ng-icon name="lucideCircleAlert" size="16" aria-hidden="true" /> {{ errors().length }} erreur{{ errors().length > 1 ? 's' : '' }} dans le texte (voir sous l’éditeur).</p>
              }
              @if (missingGroups().length) {
                <p class="text-sm font-medium text-ink">Données à compléter avant l’émission :</p>
                <ul class="mt-1 space-y-1 text-sm">
                  @for (g of missingGroups(); track g.group) {
                    <li class="flex flex-wrap items-baseline gap-x-2">
                      <span class="text-ink-soft">{{ g.fix.label }} :</span> <span>{{ g.labels.join(', ') }}</span>
                      <a class="text-xs font-medium text-orchid hover:underline" routerLink="/admin" [queryParams]="{ onglet: g.fix.tab }" target="_blank">Compléter ↗</a>
                    </li>
                  }
                </ul>
                <button type="button" class="btn-ghost mt-1 px-2 py-1 text-xs" (click)="reload()" [disabled]="busy()"><ng-icon name="lucideRotateCcw" size="12" aria-hidden="true" /> Actualiser les données</button>
              }
            }
          </div>
          <div class="flex flex-wrap items-start gap-2 text-sm md:flex-col md:items-end">
            @if (adjustments().added || adjustments().removed) {
              <span class="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Ajusté : +{{ adjustments().added }} / −{{ adjustments().removed }} ligne(s) par rapport au modèle</span>
              <span class="flex gap-1">
                <button type="button" class="btn-ghost px-2 py-1 text-xs" (click)="showAdjustments()">Voir les ajustements</button>
                <button type="button" class="btn-ghost px-2 py-1 text-xs" (click)="resetToTemplate()" [disabled]="busy()">Revenir au modèle</button>
              </span>
            } @else {
              <span class="text-xs text-ink-soft">Texte identique au modèle</span>
            }
          </div>
        </section>

        <div class="card grid overflow-hidden lg:h-[calc(100dvh-16rem)] lg:min-h-[32rem] lg:grid-cols-[15rem_minmax(0,1fr)_minmax(0,1fr)]">
          <aside class="max-h-72 border-b border-slate-200 bg-slate-50/60 lg:max-h-none lg:border-b-0 lg:border-r" aria-label="Variables">
            <app-variable-palette [data]="c.data" [used]="used()" (picked)="insertVariable($event)" />
          </aside>
          <section class="flex h-[60dvh] min-h-0 flex-col border-b border-slate-200 lg:h-auto lg:border-b-0 lg:border-r" aria-label="Texte du contrat">
            <app-template-source class="min-h-0 flex-1" label="Texte du contrat" [(value)]="source" (variableRequested)="palette().focusSearch()" (saveRequested)="save()" />
            @if (issues().length) {
              <ul class="max-h-36 overflow-y-auto border-t border-slate-200 bg-amber-50/60 text-xs" aria-label="Erreurs et avertissements">
                @for (i of issues(); track $index) {
                  <li>
                    <button type="button" class="flex w-full gap-2 px-3 py-1.5 text-left hover:bg-amber-100/60" (click)="editor().goToLine(i.line)">
                      <ng-icon [name]="i.severity === 'erreur' ? 'lucideCircleAlert' : 'lucideInfo'" size="14" class="mt-px shrink-0" [class]="i.severity === 'erreur' ? 'text-red-600' : 'text-amber-700'" aria-hidden="true" />
                      <span><span class="font-medium">Ligne {{ i.line }}</span> · {{ i.message }}</span>
                    </button>
                  </li>
                }
              </ul>
            }
          </section>
          <section class="min-h-0 overflow-y-auto bg-slate-100 p-4" aria-label="Aperçu">
            <app-contract-preview [blocks]="blocks()" />
          </section>
        </div>
      } @else {
        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div class="rounded-xl bg-slate-100 p-4 sm:p-6">
            <app-contract-preview [blocks]="blocks()" [highlight]="false" [label]="'Contrat ' + (c.number ?? '')" />
          </div>
          <aside class="space-y-4 lg:sticky lg:top-20">
            <section class="card p-4 text-sm" aria-labelledby="infos-titre">
              <h2 id="infos-titre" class="font-semibold">Contrat</h2>
              <dl class="mt-2 space-y-1.5">
                @if (c.number) { <div class="flex justify-between gap-3"><dt class="text-ink-soft">Numéro</dt><dd class="font-medium">{{ c.number }}</dd></div> }
                @if (c.issuedAt) { <div class="flex justify-between gap-3"><dt class="text-ink-soft">Émis le</dt><dd>{{ dateTime(c.issuedAt) }}</dd></div> }
                <div class="flex justify-between gap-3"><dt class="text-ink-soft">Modèle</dt><dd class="truncate">{{ c.template.name }} v{{ c.template.version }}</dd></div>
                @if (c.sentAt) { <div class="flex justify-between gap-3"><dt class="text-ink-soft">Envoyé le</dt><dd>{{ dateTime(c.sentAt) }}</dd></div> }
                @if (c.signedOn) { <div class="flex justify-between gap-3"><dt class="text-ink-soft">Signé le</dt><dd>{{ date(c.signedOn) }}</dd></div> }
                @if (c.pdfSha256) {
                  <div class="flex justify-between gap-3"><dt class="text-ink-soft">Empreinte PDF émis</dt><dd class="font-mono text-xs" [title]="'SHA-256 ' + c.pdfSha256">{{ c.pdfSha256.slice(0, 8) }}…{{ c.pdfSha256.slice(-4) }}</dd></div>
                }
                @if (c.signedPdfSha256) {
                  <div class="flex justify-between gap-3"><dt class="text-ink-soft">Empreinte PDF signé</dt><dd class="font-mono text-xs" [title]="'SHA-256 ' + c.signedPdfSha256">{{ c.signedPdfSha256.slice(0, 8) }}…{{ c.signedPdfSha256.slice(-4) }}</dd></div>
                }
              </dl>
              @if (c.status === 'EMIS') { <p class="mt-3 rounded-lg bg-orchid-50 px-3 py-2 text-xs text-ink">Prochaine étape : téléchargez le PDF, transmettez-le au client, puis « Marquer envoyé ».</p> }
              @else if (c.status === 'ENVOYE') { <p class="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-ink">En attente de signature : déposez le PDF signé à son retour.</p> }
            </section>
            <section class="card p-4 text-sm" aria-labelledby="historique-titre">
              <h2 id="historique-titre" class="font-semibold">Historique</h2>
              <ol class="mt-2 space-y-2">
                @for (e of c.events; track $index) {
                  <li class="flex gap-2">
                    <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" [class]="e.action === 'EMISSION' ? 'bg-orchid' : e.action === 'ANNULATION' ? 'bg-red-500' : 'bg-slate-300'" aria-hidden="true"></span>
                    <span><span class="font-medium">{{ eventLabels[e.action] }}</span>@if (e.comment) { · {{ e.comment }} }<span class="block text-xs text-ink-soft">{{ dateTime(e.createdAt) }} · {{ e.actor }}</span></span>
                  </li>
                }
              </ol>
            </section>
          </aside>
        </div>
      }
    }
  `,
})
export class ContractPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  private readonly dialog = inject(Dialog);
  private readonly actions = inject(ContractActions);

  readonly id = input.required<string>();
  protected readonly statusLabels = CONTRACT_STATUS_LABELS;
  protected readonly statusClasses = STATUS_CLASSES;
  protected readonly eventLabels = EVENT_LABELS;
  protected readonly palette = viewChild.required(VariablePalette);
  protected readonly editor = viewChild.required(TemplateSource);

  protected readonly contract = signal<ContractDetail | null>(null);
  private readonly saved = signal('');
  protected readonly source = signal('');
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly dirty = computed(() => this.contract()?.status === 'BROUILLON' && this.source() !== this.saved());
  private readonly parsed = computed(() => parseTemplate(this.source()));
  protected readonly issues = computed(() => this.parsed().issues);
  protected readonly errors = computed(() => this.issues().filter((i) => i.severity === 'erreur'));
  protected readonly used = computed(() => new Set(this.parsed().keys));
  private readonly rendered = computed(() => renderTemplate(this.parsed(), this.contract()?.data ?? {}));
  protected readonly blocks = computed(() => parseMarkdown(this.rendered().text));
  protected readonly missing = computed(() => this.rendered().missing);
  protected readonly ready = computed(() => !this.errors().length && !this.missing().length);
  protected readonly adjustments = computed(() => diffStats(lineDiff(this.contract()?.templateBody ?? '', this.source())));

  /** Données manquantes regroupées par écran où les compléter. */
  protected readonly missingGroups = computed(() => {
    const groups = new Map<VariableGroup, string[]>();
    for (const key of this.missing()) {
      const v = VARS.get(key);
      if (!v) continue;
      groups.set(v.group, [...(groups.get(v.group) ?? []), v.label]);
    }
    return [...groups].map(([group, labels]) => ({ group, labels, fix: FIX_TAB[group] }));
  });

  protected readonly pdfUrl = computed(() => this.api.contractPdfUrl(this.id()));
  protected readonly draftPdfUrl = computed(() => this.api.contractDraftPdfUrl(this.id()));
  protected readonly signedPdfUrl = computed(() => this.api.contractSignedPdfUrl(this.id()));
  protected readonly date = (iso: string) => frDate(iso.slice(0, 10));
  protected readonly dateTime = (iso: string) =>
    new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

  async ngOnInit(): Promise<void> {
    try {
      this.set(await this.api.contract(this.id()));
    } catch (err) {
      this.loadError.set(apiError(err).error);
    }
  }

  private set(c: ContractDetail, keepSource = false): void {
    this.contract.set(c);
    this.saved.set(c.body);
    if (!keepSource) this.source.set(c.body);
  }

  private fail(err: unknown): void {
    const e = apiError(err);
    this.error.set(e.details?.length ? `${e.error} :\n${e.details.map((d) => VARS.get(d)?.label ?? d).join('\n')}` : e.error);
  }

  /** Recharge les données (après avoir complété une fiche dans un autre onglet) sans perdre le texte en cours. */
  async reload(): Promise<void> {
    try {
      const c = await this.api.contract(this.id());
      const keep = this.dirty();
      this.contract.set(c);
      if (!keep) this.set(c);
    } catch (err) {
      this.fail(err);
    }
  }

  protected insertVariable(v: VariableDef): void {
    this.editor().insert(v.boolean ? `{{#si ${v.key}}}\n\n{{/si}}` : `{{${v.key}}}`);
  }

  async save(): Promise<boolean> {
    const c = this.contract();
    if (!c || c.status !== 'BROUILLON' || this.busy()) return false;
    if (!this.dirty()) return true;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.set(await this.api.saveContractBody(c.id, this.source(), c.updatedAt));
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async issue(): Promise<void> {
    if (!this.ready()) return;
    const ok = await this.confirm.ask({
      title: 'Émettre le contrat ?',
      message: 'Un numéro lui est attribué, ses données et son texte sont figés et le PDF est produit. Il ne pourra plus être modifié (seulement annulé).',
      confirmLabel: 'Émettre',
    });
    if (!ok || !(await this.save())) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.set(await this.api.issueContract(this.id(), this.contract()!.updatedAt));
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  async markSent(): Promise<void> {
    await this.run(this.actions.markSent(this.contract()!));
  }

  async uploadSigned(): Promise<void> {
    await this.run(this.actions.uploadSigned(this.contract()!));
  }

  private async run(action: Promise<ContractDetail | null>): Promise<void> {
    this.error.set(null);
    try {
      const c = await action;
      if (c) this.set(c);
    } catch (err) {
      this.fail(err);
    }
  }

  async cancel(): Promise<void> {
    const c = this.contract();
    if (!c) return;
    const reason = (
      await this.confirm.prompt({
        title: 'Annuler le contrat ?',
        message: c.number ? `Le contrat ${c.number} restera consultable, avec la mention « annulé ».` : 'Le brouillon restera consultable, avec la mention « annulé ».',
        confirmLabel: 'Annuler le contrat',
        cancelLabel: 'Retour',
        tone: 'danger',
        input: { label: 'Motif', required: true, multiline: true },
      })
    )?.trim();
    if (!reason) return;
    try {
      this.set(await this.api.cancelContract(c.id, reason));
    } catch (err) {
      this.fail(err);
    }
  }

  protected showAdjustments(): void {
    const c = this.contract()!;
    this.dialog.open<void, TextDiffData>(TextDiffDialog, {
      data: { title: 'Ajustements du contrat', beforeLabel: `${c.template.name} v${c.template.version}`, before: c.templateBody, after: this.source() },
      ariaLabel: 'Ajustements du contrat',
    });
  }

  async resetToTemplate(): Promise<void> {
    const c = this.contract()!;
    const ok = await this.confirm.ask({
      title: 'Revenir au texte du modèle ?',
      message: `Les ajustements de ce contrat sont supprimés : le texte redevient celui de ${c.template.name} v${c.template.version}.`,
      confirmLabel: 'Revenir au modèle',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      this.set(await this.api.resetContract(c.id));
    } catch (err) {
      this.fail(err);
    }
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.dirty()) return true;
    return this.confirm.ask({
      title: 'Contrat non enregistré',
      message: 'Vos ajustements du texte seront perdus.',
      confirmLabel: 'Quitter sans enregistrer',
      cancelLabel: 'Rester',
      tone: 'danger',
    });
  }

  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) e.preventDefault();
  }
}
