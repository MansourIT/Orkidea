import { Dialog } from '@angular/cdk/dialog';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ContractDetail, ContractSummary } from '@shared/types';
import { Api } from '../../core/api';
import { Confirm } from '../../ui/confirm-dialog';
import { SignedUploadDialog, type SignedUploadData } from './signed-upload-dialog';

/** Actions de suivi communes à la page du contrat et au panneau de la liste. Renvoient le contrat à jour, ou null si abandon. */
@Injectable({ providedIn: 'root' })
export class ContractActions {
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  private readonly dialog = inject(Dialog);

  async markSent(c: ContractSummary): Promise<ContractDetail | null> {
    const comment = await this.confirm.prompt({
      title: `Marquer ${c.number} comme envoyé ?`,
      message: `À faire une fois le PDF transmis à ${c.client}. Le contrat passe « en attente de signature ».`,
      confirmLabel: 'Marquer envoyé',
      input: { label: 'Commentaire (destinataire, moyen d’envoi…)', required: false, multiline: false },
    });
    if (comment === null || comment === undefined) return null;
    return this.api.markContractSent(c.id, comment.trim() || undefined);
  }

  async uploadSigned(c: ContractSummary): Promise<ContractDetail | null> {
    const ref = this.dialog.open<ContractDetail, SignedUploadData>(SignedUploadDialog, { data: { contract: c }, ariaLabel: 'Déposer le PDF signé' });
    return (await firstValueFrom(ref.closed)) ?? null;
  }
}
