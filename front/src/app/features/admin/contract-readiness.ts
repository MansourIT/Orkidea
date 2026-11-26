import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { COMPANY_LABELS, type CompanySettings, missingCompanyFields } from '@shared/company';
import type { AdminUser, Client, Mission } from '@shared/types';
import { Api, apiError } from '../../core/api';
import { missingClientFields } from './admin-clients';

/** Champs d'une mission repris dans le contrat. */
function missingMissionFields(m: Mission): string[] {
  const out: string[] = [];
  if (!m.purpose) out.push('objet');
  if (!m.location) out.push('lieu');
  if (m.tjm === null) out.push('TJM');
  if (m.paymentTermsDays === null) out.push('délai de paiement');
  return out;
}

interface Check {
  label: string;
  missing: string[];
  link: string;
}

/** Données à compléter (Orkidea, clients, missions actives) pour pouvoir émettre les contrats. */
@Component({
  selector: 'app-contract-readiness',
  imports: [NgIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-3xl">
      <section class="card overflow-hidden" aria-labelledby="prep-titre">
        <header class="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
          <h3 id="prep-titre" class="font-semibold">Données à compléter</h3>
          <p class="text-xs text-ink-soft">Un contrat ne pourra être émis que si toutes les informations reprises dans le modèle sont renseignées.</p>
        </header>
        @if (error()) {
          <p class="alert-error m-5" role="alert">{{ error() }}</p>
        } @else if (!checks()) {
          <p class="flex items-center gap-2 px-5 py-6 text-sm text-ink-soft" role="status"><ng-icon name="lucideLoaderCircle" size="16" class="animate-spin" aria-hidden="true" /> Chargement…</p>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (c of checks()!; track c.label) {
              <li class="flex items-start gap-3 px-5 py-3">
                @if (c.missing.length) {
                  <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-800"><ng-icon name="lucideCircleAlert" size="13" aria-hidden="true" /></span>
                } @else {
                  <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><ng-icon name="lucideCircleCheck" size="13" aria-hidden="true" /></span>
                }
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-ink">{{ c.label }}</p>
                  <p class="text-xs text-ink-soft">{{ c.missing.length ? 'À compléter : ' + c.missing.join(', ') : 'Complet' }}</p>
                </div>
                @if (c.missing.length) {
                  <a class="shrink-0 text-xs font-medium text-orchid hover:underline" routerLink="/admin" [queryParams]="{ onglet: c.link }">Compléter</a>
                }
              </li>
            } @empty {
              <li class="px-5 py-6 text-sm text-ink-soft">Aucune mission active.</li>
            }
          </ul>
        }
      </section>

    </div>
  `,
})
export class ContractReadiness implements OnInit {
  private readonly api = inject(Api);
  private readonly data = signal<{ company: CompanySettings; clients: Client[]; missions: Mission[]; users: AdminUser[] } | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Une ligne pour Orkidea, puis pour chaque mission active : client, mission, consultant. */
  protected readonly checks = computed<Check[] | null>(() => {
    const d = this.data();
    if (!d) return null;
    const out: Check[] = [{ label: 'Orkidea : Paramètres › Société et contrats', missing: missingCompanyFields(d.company).map((k) => COMPANY_LABELS[k]), link: 'parametres' }];
    const clients = new Map(d.clients.map((c) => [c.id, c]));
    const users = new Map(d.users.map((u) => [u.id, u]));
    const seenClients = new Set<string>();
    for (const m of d.missions.filter((x) => x.active)) {
      const cl = clients.get(m.clientId);
      if (cl && !seenClients.has(cl.id)) {
        seenClients.add(cl.id);
        out.push({ label: `Client : ${cl.name}`, missing: missingClientFields(cl), link: 'clients' });
      }
      const consultant = users.get(m.consultantId);
      out.push({
        label: `Mission : ${m.label} (${m.client})`,
        missing: [...missingMissionFields(m), ...(consultant && !consultant.qualification ? [`qualification de ${consultant.name}`] : [])],
        link: 'missions',
      });
    }
    return out;
  });

  async ngOnInit(): Promise<void> {
    try {
      const [company, clients, missions, users] = await Promise.all([this.api.company(), this.api.clients(), this.api.missions(), this.api.users()]);
      this.data.set({ company, clients, missions, users });
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }
}
