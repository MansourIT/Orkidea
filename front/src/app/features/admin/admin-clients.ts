import { Dialog } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { Client } from '@shared/types';
import { Api, apiError } from '../../core/api';
import { ClientDrawer } from './client-drawer';

/** Informations du client reprises dans les contrats de prestation. */
const CONTRACT_FIELDS: Array<[keyof Client, string]> = [
  ['siret', 'SIRET'],
  ['address', 'adresse'],
  ['postalCode', 'code postal'],
  ['city', 'ville'],
  ['representativeName', 'représentant'],
  ['representativeRole', 'fonction'],
];

/** Fiche client manquante pour un contrat (liste des champs vides). */
export function missingClientFields(c: Client): string[] {
  return CONTRACT_FIELDS.filter(([k]) => !c[k]).map(([, label]) => label);
}

/** Clients : coordonnées et signataire repris dans les contrats. */
@Component({
  selector: 'app-admin-clients',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Clients</h2>
        <p class="text-sm text-ink-soft">Coordonnées et signataire, repris dans les contrats de prestation.</p>
      </div>
      <button type="button" class="btn-primary" (click)="open(null)"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Nouveau client</button>
    </div>

    @if (error()) { <div class="alert-error mb-4" role="alert">{{ error() }}</div> }

    <div class="card overflow-x-auto">
      <table class="w-full min-w-[44rem] text-sm">
        <thead class="bg-slate-50 text-left text-xs text-ink-soft">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">Client</th>
            <th scope="col" class="px-4 py-3 font-medium">Ville</th>
            <th scope="col" class="px-4 py-3 font-medium">Signataire</th>
            <th scope="col" class="px-4 py-3 font-medium">Fiche contrat</th>
            <th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          @for (c of clients(); track c.id) {
            @let missing = missingFields(c);
            <tr class="cursor-pointer border-t border-slate-100 hover:bg-slate-50" (click)="open(c)">
              <td class="px-4 py-3"><span class="font-medium text-ink">{{ c.name }}</span>@if (c.siret) { <span class="block text-xs text-ink-soft">SIRET {{ c.siret }}</span> }</td>
              <td class="px-4 py-3 text-ink-soft">{{ c.city ?? '—' }}</td>
              <td class="px-4 py-3">
                @if (c.representativeName) { {{ c.representativeName }}@if (c.representativeRole) { <span class="block text-xs text-ink-soft">{{ c.representativeRole }}</span> } }
                @else { <span class="text-ink-soft">—</span> }
              </td>
              <td class="px-4 py-3">
                @if (missing.length) {
                  <span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800" [title]="'Manque : ' + missing.join(', ')">
                    <ng-icon name="lucideCircleAlert" size="12" aria-hidden="true" /> {{ missing.length }} manquant{{ missing.length > 1 ? 's' : '' }}
                  </span>
                  <span class="sr-only">: {{ missing.join(', ') }}</span>
                } @else {
                  <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><ng-icon name="lucideCircleCheck" size="12" aria-hidden="true" /> Complète</span>
                }
              </td>
              <td class="px-4 py-3 text-right">
                <button type="button" class="btn-ghost px-3 py-1.5 text-xs" (click)="$event.stopPropagation(); open(c)" [attr.aria-label]="'Modifier ' + c.name"><ng-icon name="lucidePencil" size="14" aria-hidden="true" /> Modifier</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="px-4 py-10 text-center text-ink-soft">Aucun client.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminClients implements OnInit {
  private readonly api = inject(Api);
  private readonly dialog = inject(Dialog);
  private readonly overlay = inject(Overlay);
  protected readonly clients = signal<Client[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly missingFields = missingClientFields;

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.clients.set(await this.api.clients());
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  open(c: Client | null): void {
    const ref = this.dialog.open<boolean, Client | null>(ClientDrawer, {
      data: c,
      positionStrategy: this.overlay.position().global().right('0').top('0'),
      height: '100dvh',
      backdropClass: ['bg-ink/40'],
      ariaLabel: c ? `Modifier le client ${c.name}` : 'Nouveau client',
    });
    ref.closed.subscribe((saved) => {
      if (saved) void this.load();
    });
  }
}
