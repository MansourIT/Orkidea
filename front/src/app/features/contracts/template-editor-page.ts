import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { type CompanySettings } from '@shared/company';
import { type ContractData, VARIABLES, type VariableDef, contractData, parseMarkdown, parseTemplate, renderTemplate, sampleContractData } from '@shared/contrats';
import { todayInParis } from '@shared/dates';
import type { AdminUser, Client, ContractTemplateDetail, Mission } from '@shared/types';
import { Api, apiError } from '../../core/api';
import type { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { Confirm } from '../../ui/confirm-dialog';
import { ContractPreview } from './contract-preview';
import { TemplateSource } from './template-source';
import { VariablePalette } from './variable-palette';
import { VersionCompare, type VersionCompareData } from './version-compare';

const LABELS = new Map(VARIABLES.map((v) => [v.key, v.label]));
const SAMPLE = 'exemple';

/** Télécharge un texte en fichier .md. */
export function downloadMarkdown(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'modele';

/** Éditeur d'un modèle de contrat : variables, texte Markdown, aperçu en direct sur une mission. */
@Component({
  selector: 'app-template-editor-page',
  imports: [RouterLink, NgIcon, TemplateSource, VariablePalette, ContractPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    @if (!template()) {
      <div class="card flex items-center justify-center gap-2 p-16 text-ink-soft" role="status">
        @if (loadError()) { <span class="text-red-700">{{ loadError() }}</span> }
        @else { <ng-icon name="lucideLoaderCircle" size="20" class="animate-spin" aria-hidden="true" /> Chargement… }
      </div>
    } @else {
      @let t = template()!;
      <!-- En-tête -->
      <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <a routerLink="/admin" [queryParams]="{ onglet: 'contrats' }" class="btn-ghost -ml-2 px-2 text-sm"><ng-icon name="lucideChevronLeft" size="16" aria-hidden="true" /> Modèles</a>
        <div class="min-w-0">
          <h1 class="flex items-center gap-2 text-xl font-bold">
            <span class="truncate">{{ t.name }}</span>
            @if (!t.archived) { <button type="button" class="btn-ghost p-1" (click)="rename()" aria-label="Renommer le modèle"><ng-icon name="lucidePencil" size="14" /></button> }
          </h1>
        </div>
        <span class="rounded-full px-2.5 py-0.5 text-xs font-medium" [class]="statusClass()">{{ statusLabel() }}</span>
        @if (savedAt()) { <span class="text-xs text-ink-soft" aria-live="polite">Enregistré à {{ savedAt() }}</span> }

        <div class="ml-auto flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2 text-xs text-ink-soft">
            Aperçu avec
            <select class="input w-auto max-w-56 py-1.5 text-sm" [value]="previewId()" (change)="previewId.set($any($event.target).value)" aria-label="Mission utilisée pour l’aperçu">
              <option [value]="sample" [selected]="previewId() === sample">Exemple fictif</option>
              @for (m of missions(); track m.id) { <option [value]="m.id" [selected]="previewId() === m.id">{{ m.label }} — {{ m.client }}</option> }
            </select>
          </label>
          @if (t.versions.length > (dirty() || t.draft ? 0 : 1)) {
            <button type="button" class="btn-secondary py-1.5 text-sm" (click)="compare()"><ng-icon name="lucideLayoutGrid" size="14" aria-hidden="true" /> Comparer</button>
          }
          <button type="button" class="btn-secondary py-1.5 text-sm" (click)="exportMd()" title="Télécharger le texte en .md"><ng-icon name="lucideDownload" size="14" aria-hidden="true" /> .md</button>
          @if (t.archived) {
            <button type="button" class="btn-primary py-1.5 text-sm" (click)="restore()">Restaurer le modèle</button>
          } @else {
            @if (t.draft && t.published && !dirty()) {
              <button type="button" class="btn-ghost py-1.5 text-sm text-red-700" (click)="discard()">Abandonner le brouillon</button>
            }
            <button type="button" class="btn-secondary py-1.5 text-sm" (click)="save()" [disabled]="busy() || !dirty()">
              <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideSave'" size="14" [class.animate-spin]="busy()" aria-hidden="true" /> Enregistrer
            </button>
            <button type="button" class="btn-primary py-1.5 text-sm" (click)="publish()" [disabled]="busy() || errors().length > 0 || (!dirty() && !t.draft)"
                    [title]="errors().length ? 'Corrigez les erreurs avant de publier' : ''">
              <ng-icon name="lucideSend" size="14" aria-hidden="true" /> Publier la v{{ nextVersion() }}
            </button>
          }
        </div>
      </div>

      @if (error()) { <div class="alert-error mb-3 whitespace-pre-line" role="alert">{{ error() }}</div> }
      @if (t.archived) { <div class="alert-info mb-3" role="status">Modèle archivé : lecture seule. Restaurez-le pour le modifier.</div> }
      @else if (!t.draft && t.published && !dirty()) {
        <p class="mb-3 text-xs text-ink-soft">La v{{ t.published.version }} est publiée et ne change plus : vos modifications créeront la v{{ t.published.version + 1 }} en brouillon.</p>
      }

      <!-- Éditeur : variables | texte | aperçu -->
      <div class="card grid overflow-hidden lg:h-[calc(100dvh-13rem)] lg:min-h-[32rem] lg:grid-cols-[15rem_minmax(0,1fr)_minmax(0,1fr)]">
        <aside class="max-h-72 border-b border-slate-200 bg-slate-50/60 lg:max-h-none lg:border-b-0 lg:border-r" aria-label="Variables">
          <app-variable-palette [data]="data()" [used]="used()" (picked)="insertVariable($event)" />
        </aside>
        <section class="flex h-[60dvh] min-h-0 flex-col border-b border-slate-200 lg:h-auto lg:border-b-0 lg:border-r" aria-label="Texte du modèle">
          <app-template-source class="min-h-0 flex-1" [(value)]="source" [readonly]="t.archived" (variableRequested)="palette().focusSearch()" (saveRequested)="save()" />
          @if (issues().length) {
            <ul class="max-h-36 overflow-y-auto border-t border-slate-200 bg-amber-50/60 text-xs" aria-label="Erreurs et avertissements" aria-live="polite">
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
        <section class="flex min-h-0 flex-col bg-slate-100" aria-label="Aperçu">
          <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            @if (missing().length) {
              <span class="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700" [title]="missingLabels()">{{ missing().length }} donnée{{ missing().length > 1 ? 's' : '' }} manquante{{ missing().length > 1 ? 's' : '' }}</span>
            } @else {
              <span class="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">Données complètes</span>
            }
            <label class="ml-auto flex cursor-pointer items-center gap-1.5 text-ink-soft">
              <input type="checkbox" class="accent-orchid" [checked]="highlight()" (change)="highlight.set($any($event.target).checked)" /> Surligner les variables
            </label>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-4">
            @if (missing().length) { <p class="mb-3 text-xs text-red-700">Manque pour cette mission : {{ missingLabels() }}.</p> }
            <app-contract-preview [blocks]="blocks()" [highlight]="highlight()" />
          </div>
        </section>
      </div>
    }
  `,
})
export class TemplateEditorPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  private readonly dialog = inject(Dialog);

  readonly id = input.required<string>();
  protected readonly sample = SAMPLE;
  protected readonly palette = viewChild.required(VariablePalette);
  protected readonly editor = viewChild.required(TemplateSource);

  protected readonly template = signal<ContractTemplateDetail | null>(null);
  /** Texte enregistré (brouillon, sinon dernière version publiée) et texte en cours. */
  private readonly savedSource = signal('');
  protected readonly source = signal('');
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly savedAt = signal<string | null>(null);
  protected readonly highlight = signal(true);

  protected readonly missions = signal<Mission[]>([]);
  private readonly clients = signal<Client[]>([]);
  private readonly users = signal<AdminUser[]>([]);
  private readonly company = signal<CompanySettings | null>(null);
  protected readonly previewId = signal(SAMPLE);

  protected readonly dirty = computed(() => this.source() !== this.savedSource());
  protected readonly parsed = computed(() => parseTemplate(this.source()));
  protected readonly issues = computed(() => this.parsed().issues);
  protected readonly errors = computed(() => this.issues().filter((i) => i.severity === 'erreur'));
  protected readonly used = computed(() => new Set(this.parsed().keys));

  /** Données de la mission d'aperçu (ou données fictives). */
  protected readonly data = computed<ContractData>(() => {
    const today = todayInParis();
    const m = this.missions().find((x) => x.id === this.previewId());
    const client = m && this.clients().find((c) => c.id === m.clientId);
    const consultant = m && this.users().find((u) => u.id === m.consultantId);
    const company = this.company();
    if (!m || !client || !consultant || !company) return sampleContractData(today);
    return contractData({ company, client, consultant, mission: m, date: today });
  });
  private readonly rendered = computed(() => renderTemplate(this.parsed(), this.data()));
  protected readonly blocks = computed(() => parseMarkdown(this.rendered().text));
  protected readonly missing = computed(() => this.rendered().missing);
  protected readonly missingLabels = computed(() => this.missing().map((k) => LABELS.get(k) ?? k).join(', '));

  protected readonly nextVersion = computed(() => {
    const t = this.template();
    if (!t) return 1;
    return t.draft?.version ?? (t.published ? t.published.version + 1 : 1);
  });
  protected readonly statusLabel = computed(() => {
    const t = this.template()!;
    if (t.archived) return 'Archivé';
    if (t.draft) return `v${t.draft.version} brouillon${this.dirty() ? ' · modifié' : ''}`;
    return this.dirty() ? `v${this.nextVersion()} brouillon · non enregistré` : `v${t.published?.version} publiée`;
  });
  protected readonly statusClass = computed(() => {
    const t = this.template()!;
    if (t.archived) return 'bg-slate-100 text-slate-600';
    if (this.dirty()) return 'bg-amber-50 text-amber-800';
    return t.draft ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-700';
  });

  async ngOnInit(): Promise<void> {
    try {
      const [t, missions, clients, users, company] = await Promise.all([
        this.api.template(this.id()),
        this.api.missions(),
        this.api.clients(),
        this.api.users(),
        this.api.company(),
      ]);
      this.setTemplate(t);
      const active = missions.filter((m) => m.active);
      this.missions.set(active);
      this.clients.set(clients);
      this.users.set(users);
      this.company.set(company);
      if (active[0]) this.previewId.set(active[0].id);
    } catch (err) {
      this.loadError.set(apiError(err).error);
    }
  }

  private setTemplate(t: ContractTemplateDetail): void {
    this.template.set(t);
    const text = t.draftBody ?? t.publishedBody ?? '';
    this.savedSource.set(text);
    this.source.set(text);
  }

  protected insertVariable(v: VariableDef): void {
    if (v.boolean) this.editor().insert(`{{#si ${v.key}}}\n\n{{/si}}`);
    else this.editor().insert(`{{${v.key}}}`);
  }

  private fail(err: unknown): void {
    const e = apiError(err);
    this.error.set(e.details?.length ? `${e.error} :\n${e.details.join('\n')}` : e.error);
  }

  async save(): Promise<boolean> {
    const t = this.template();
    if (!t || t.archived || !this.dirty() || this.busy()) return !this.dirty();
    this.busy.set(true);
    this.error.set(null);
    try {
      this.setTemplate(await this.api.saveTemplateDraft(t.id, this.source(), t.draft?.updatedAt ?? null));
      this.savedAt.set(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async publish(): Promise<void> {
    const t = this.template();
    if (!t || this.errors().length) return;
    const version = this.nextVersion();
    const ok = await this.confirm.ask({
      title: `Publier la v${version} ?`,
      message: `La v${version} servira à générer les nouveaux contrats et ne pourra plus être modifiée. Les contrats déjà générés gardent leur version.${
        this.issues().length ? ` Il reste ${this.issues().length} avertissement(s).` : ''
      }`,
      confirmLabel: 'Publier',
    });
    if (!ok || !(await this.save())) return;
    this.busy.set(true);
    try {
      this.setTemplate(await this.api.publishTemplate(t.id));
      this.savedAt.set(null);
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  async discard(): Promise<void> {
    const t = this.template();
    if (!t?.draft || !t.published) return;
    const ok = await this.confirm.ask({
      title: `Abandonner le brouillon v${t.draft.version} ?`,
      message: `Le texte revient à la v${t.published.version} publiée. Les modifications du brouillon sont perdues.`,
      confirmLabel: 'Abandonner',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      this.setTemplate(await this.api.discardTemplateDraft(t.id));
    } catch (err) {
      this.fail(err);
    }
  }

  async rename(): Promise<void> {
    const t = this.template();
    if (!t) return;
    const name = (await this.confirm.prompt({ title: 'Renommer le modèle', message: t.name, confirmLabel: 'Renommer', input: { label: 'Nom du modèle', required: true, initial: t.name } }))?.trim();
    if (!name || name === t.name) return;
    try {
      const updated = await this.api.updateTemplate(t.id, { name });
      this.template.set({ ...t, name: updated.name });
    } catch (err) {
      this.fail(err);
    }
  }

  async restore(): Promise<void> {
    const t = this.template();
    if (!t) return;
    try {
      this.template.set({ ...t, archived: false });
      await this.api.updateTemplate(t.id, { archived: false });
    } catch (err) {
      this.template.set(t);
      this.fail(err);
    }
  }

  protected compare(): void {
    const t = this.template()!;
    const initial = t.published?.version ?? t.versions[0].version;
    this.dialog.open<void, VersionCompareData>(VersionCompare, { data: { templateId: t.id, versions: t.versions, current: this.source(), initial }, ariaLabel: 'Comparer les versions' });
  }

  protected exportMd(): void {
    downloadMarkdown(`${slug(this.template()!.name)}-v${this.nextVersion()}.md`, this.source());
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.dirty()) return true;
    return this.confirm.ask({
      title: 'Modèle non enregistré',
      message: 'Vos modifications du modèle seront perdues.',
      confirmLabel: 'Quitter sans enregistrer',
      cancelLabel: 'Rester',
      tone: 'danger',
    });
  }

  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) e.preventDefault();
  }
}
