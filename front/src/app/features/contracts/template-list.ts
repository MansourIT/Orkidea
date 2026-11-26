import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { frDate } from '@shared/dates';
import type { ContractTemplateSummary } from '@shared/types';
import { Api, apiError } from '../../core/api';
import { Confirm } from '../../ui/confirm-dialog';
import { NewTemplateDialog, type NewTemplateData } from './new-template-dialog';
import { downloadMarkdown, slug } from './template-editor-page';

/** Modèles de contrat : cartes avec versions, ouverture dans l'éditeur, duplication, export, archivage. */
@Component({
  selector: 'app-template-list',
  imports: [NgIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <p class="text-sm text-ink-soft">Les « contrats mères » : texte en Markdown avec variables. Seule une version publiée sert à générer les contrats.</p>
      <button type="button" class="btn-primary ml-auto" (click)="create()"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Nouveau modèle</button>
    </div>

    @if (error()) { <div class="alert-error mb-4" role="alert">{{ error() }}</div> }

    @if (!templates()) {
      <p class="card flex items-center gap-2 p-8 text-sm text-ink-soft" role="status"><ng-icon name="lucideLoaderCircle" size="16" class="animate-spin" aria-hidden="true" /> Chargement…</p>
    } @else {
      <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Modèles de contrat">
        @for (t of visible(); track t.id) {
          <li class="card flex flex-col gap-3 p-4" [class.opacity-70]="t.archived">
            <div class="flex items-start gap-3">
              <span class="flex h-10 w-9 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-orchid" aria-hidden="true"><ng-icon name="lucideFileText" size="18" /></span>
              <div class="min-w-0">
                <a [routerLink]="['/admin/modeles', t.id]" class="block truncate font-semibold text-ink hover:text-orchid hover:underline">{{ t.name }}</a>
                <p class="truncate text-xs text-ink-soft">{{ t.description || 'Créé le ' + date(t.createdAt) }}</p>
              </div>
            </div>
            <div class="flex flex-wrap gap-1.5 text-[11px] font-medium">
              @if (t.archived) { <span class="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Archivé</span> }
              @if (t.published) { <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">● v{{ t.published.version }} publiée</span> }
              @else { <span class="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">Jamais publié</span> }
              @if (t.draft) { <span class="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">v{{ t.draft.version }} brouillon · {{ date(t.draft.updatedAt) }}</span> }
            </div>
            <div class="mt-auto flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3">
              <span class="mr-auto text-xs text-ink-soft">{{ t.contractsCount ? t.contractsCount + ' contrat' + (t.contractsCount > 1 ? 's' : '') : 'Aucun contrat' }}</span>
              <button type="button" class="btn-ghost px-2 py-1 text-xs" (click)="duplicate(t)" [attr.aria-label]="'Dupliquer ' + t.name">Dupliquer</button>
              <button type="button" class="btn-ghost px-2 py-1 text-xs" (click)="exportMd(t)" [attr.aria-label]="'Exporter ' + t.name + ' en .md'"><ng-icon name="lucideDownload" size="13" aria-hidden="true" /> .md</button>
              <button type="button" class="btn-ghost px-2 py-1 text-xs" (click)="toggleArchive(t)">{{ t.archived ? 'Restaurer' : 'Archiver' }}</button>
              <a [routerLink]="['/admin/modeles', t.id]" class="btn-secondary px-3 py-1 text-xs">{{ t.archived ? 'Voir' : 'Modifier' }}</a>
            </div>
          </li>
        } @empty {
          <li class="card flex flex-col items-center gap-3 p-10 text-center sm:col-span-2 xl:col-span-3">
            <ng-icon name="lucideFileText" size="28" class="text-orchid" aria-hidden="true" />
            <p class="font-semibold">Aucun modèle de contrat</p>
            <p class="max-w-md text-sm text-ink-soft">Partez du modèle de démonstration ou importez votre contrat type au format .md.</p>
            <button type="button" class="btn-primary" (click)="create()"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Créer un modèle</button>
          </li>
        }
      </ul>
      @if (archivedCount()) {
        <button type="button" class="btn-ghost mt-3 text-xs" (click)="showArchived.set(!showArchived())" [attr.aria-pressed]="showArchived()">
          {{ showArchived() ? 'Masquer' : 'Afficher' }} les modèles archivés ({{ archivedCount() }})
        </button>
      }
    }
  `,
})
export class TemplateList implements OnInit {
  private readonly api = inject(Api);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);
  private readonly confirm = inject(Confirm);

  protected readonly templates = signal<ContractTemplateSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly showArchived = signal(false);
  protected readonly archivedCount = computed(() => this.templates()?.filter((t) => t.archived).length ?? 0);
  protected readonly visible = computed(() => (this.templates() ?? []).filter((t) => this.showArchived() || !t.archived));
  protected readonly date = (iso: string) => frDate(iso.slice(0, 10));

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.templates.set(await this.api.templates());
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  private open(data: NewTemplateData): void {
    const ref = this.dialog.open<string, NewTemplateData>(NewTemplateDialog, { data, ariaLabel: 'Nouveau modèle de contrat' });
    ref.closed.subscribe((id) => {
      if (id) void this.router.navigate(['/admin/modeles', id]);
    });
  }

  create(): void {
    this.open({});
  }

  async duplicate(t: ContractTemplateSummary): Promise<void> {
    try {
      const d = await this.api.template(t.id);
      this.open({ duplicate: { name: t.name, body: d.draftBody ?? d.publishedBody ?? '' } });
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  async exportMd(t: ContractTemplateSummary): Promise<void> {
    try {
      const d = await this.api.template(t.id);
      // Version publiée de préférence (celle qui sert aux contrats), sinon le brouillon.
      const version = d.published?.version ?? d.draft!.version;
      downloadMarkdown(`${slug(t.name)}-v${version}.md`, d.publishedBody ?? d.draftBody ?? '');
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  async toggleArchive(t: ContractTemplateSummary): Promise<void> {
    if (!t.archived) {
      const ok = await this.confirm.ask({
        title: `Archiver « ${t.name} » ?`,
        message: 'Le modèle ne sera plus proposé pour générer des contrats. Les contrats déjà générés ne changent pas. Vous pourrez le restaurer.',
        confirmLabel: 'Archiver',
      });
      if (!ok) return;
    }
    try {
      await this.api.updateTemplate(t.id, { archived: !t.archived });
      await this.load();
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }
}
