// Identité d'Orkidea (société de portage), reprise dans les contrats de prestation.

export interface CompanySettings {
  legalName: string;
  legalForm: string;
  /** Capital social tel qu'il doit apparaître, ex. « 1 000 € ». */
  capital: string;
  siret: string;
  /** Ville d'immatriculation et numéro, ex. « Paris 123 456 789 ». */
  rcs: string;
  vatNumber: string;
  address: string;
  postalCode: string;
  city: string;
  representativeName: string;
  representativeRole: string;
  /** Garant et références de la garantie financière (obligatoire en portage salarial). */
  financialGuarantee: string;
  /** Préfixe des numéros de contrat : CS → CS-2026-001. */
  contractNumberPrefix: string;
}

export const DEFAULT_COMPANY: CompanySettings = {
  legalName: 'Orkidea',
  legalForm: 'SASU',
  capital: '',
  siret: '',
  rcs: '',
  vatNumber: '',
  address: '',
  postalCode: '',
  city: '',
  representativeName: '',
  representativeRole: 'Président',
  financialGuarantee: '',
  contractNumberPrefix: 'CS',
};

export const COMPANY_LABELS: Record<keyof CompanySettings, string> = {
  legalName: 'Raison sociale',
  legalForm: 'Forme juridique',
  capital: 'Capital social',
  siret: 'SIRET',
  rcs: 'RCS',
  vatNumber: 'N° de TVA intracommunautaire',
  address: 'Adresse',
  postalCode: 'Code postal',
  city: 'Ville',
  representativeName: 'Représentant légal',
  representativeRole: 'Fonction du représentant',
  financialGuarantee: 'Garantie financière',
  contractNumberPrefix: 'Préfixe des numéros de contrat',
};

/** Champs vides qui manqueront dans un contrat (le préfixe a toujours une valeur). */
export function missingCompanyFields(c: CompanySettings): Array<keyof CompanySettings> {
  return (Object.keys(COMPANY_LABELS) as Array<keyof CompanySettings>).filter((k) => !c[k].trim());
}

/** Numéro de contrat : préfixe, année, rang sur 3 chiffres (CS-2026-001). */
export function contractNumber(prefix: string, year: number, rank: number): string {
  return `${prefix}-${year}-${String(rank).padStart(3, '0')}`;
}
