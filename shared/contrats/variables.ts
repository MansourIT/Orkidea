// Dictionnaire des variables utilisables dans les modèles de contrat, et calcul de leurs valeurs.
import type { CompanySettings } from '../company';
import { MONTH_NAMES } from '../dates';
import type { Client, Mission } from '../types';
import { eurosInWords, formatEuros } from './nombres';

export type VariableGroup = 'societe' | 'client' | 'consultant' | 'mission' | 'contrat';

export const GROUP_LABELS: Record<VariableGroup, string> = {
  societe: 'Orkidea',
  client: 'Client',
  consultant: 'Consultant',
  mission: 'Mission',
  contrat: 'Contrat et dates',
};

export interface VariableDef {
  key: string;
  label: string;
  group: VariableGroup;
  /** Vrai / faux : utilisable seulement dans {{#si …}} (affichée « oui » / « non » sinon). */
  boolean?: boolean;
}

const v = (group: VariableGroup, key: string, label: string, boolean?: boolean): VariableDef => ({ key: `${group}.${key}`, label, group, ...(boolean ? { boolean } : {}) });

export const VARIABLES: VariableDef[] = [
  v('societe', 'raison_sociale', 'Raison sociale'),
  v('societe', 'forme', 'Forme juridique'),
  v('societe', 'capital', 'Capital social'),
  v('societe', 'siret', 'SIRET'),
  v('societe', 'rcs', 'RCS'),
  v('societe', 'tva', 'N° de TVA'),
  v('societe', 'adresse', 'Adresse complète'),
  v('societe', 'representant.nom', 'Représentant légal'),
  v('societe', 'representant.fonction', 'Fonction du représentant'),
  v('societe', 'garantie_financiere', 'Garantie financière'),

  v('client', 'raison_sociale', 'Raison sociale'),
  v('client', 'siret', 'SIRET'),
  v('client', 'adresse', 'Adresse complète'),
  v('client', 'representant.nom', 'Représentant légal'),
  v('client', 'representant.fonction', 'Fonction du représentant'),
  v('client', 'email_contrats', 'Email pour les contrats'),

  v('consultant', 'nom', 'Nom complet'),
  v('consultant', 'email', 'Email'),
  v('consultant', 'qualification', 'Qualification'),

  v('mission', 'intitule', 'Intitulé'),
  v('mission', 'objet', 'Objet de la prestation'),
  v('mission', 'lieu', 'Lieu d’exécution'),
  v('mission', 'modalites', 'Modalités d’exécution'),
  v('mission', 'date_debut', 'Date de début'),
  v('mission', 'date_fin', 'Date de fin'),
  v('mission', 'periode', 'Période (du … au … / à compter du …)'),
  v('mission', 'a_date_fin', 'A une date de fin', true),
  v('mission', 'tjm', 'TJM (€ HT)'),
  v('mission', 'tjm_lettres', 'TJM en toutes lettres'),
  v('mission', 'delai_paiement', 'Délai de paiement (jours)'),
  v('mission', 'validation_client', 'Validation client des CRA', true),
  v('mission', 'validateur.nom', 'Valideur des CRA'),
  v('mission', 'validateur.email', 'Email du valideur'),

  v('contrat', 'numero', 'Numéro du contrat'),
  v('contrat', 'date', 'Date du contrat'),
];

export const VARIABLE_KEYS = new Set(VARIABLES.map((x) => x.key));

/** Valeurs d'un contrat : texte, booléen, ou null si non renseigné. */
export type ContractData = Record<string, string | boolean | null>;

/** « 1er décembre 2026 », « 15 mars 2027 ». */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d === 1 ? '1er' : d} ${MONTH_NAMES[m - 1]} ${y}`;
}

const txt = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
const joinAddress = (address: string | null, postalCode: string | null, city: string | null) =>
  txt([txt(address), [txt(postalCode), txt(city)].filter(Boolean).join(' ')].filter(Boolean).join(', '));

export interface ContractSources {
  company: CompanySettings;
  client: Client;
  consultant: { name: string; email: string; qualification: string | null };
  mission: Mission;
  /** Numéro attribué à l'émission (absent pour un brouillon ou un aperçu). */
  number?: string | null;
  /** Date du contrat (YYYY-MM-DD). */
  date: string;
}

/** Valeurs de toutes les variables du dictionnaire pour une mission. */
export function contractData(s: ContractSources): ContractData {
  const { company: co, client: cl, mission: m } = s;
  const period = m.endDate ? `du ${longDate(m.startDate)} au ${longDate(m.endDate)}` : `à compter du ${longDate(m.startDate)}`;
  return {
    'societe.raison_sociale': txt(co.legalName),
    'societe.forme': txt(co.legalForm),
    'societe.capital': txt(co.capital),
    'societe.siret': txt(co.siret),
    'societe.rcs': txt(co.rcs),
    'societe.tva': txt(co.vatNumber),
    'societe.adresse': joinAddress(co.address, co.postalCode, co.city),
    'societe.representant.nom': txt(co.representativeName),
    'societe.representant.fonction': txt(co.representativeRole),
    'societe.garantie_financiere': txt(co.financialGuarantee),

    'client.raison_sociale': txt(cl.name),
    'client.siret': txt(cl.siret),
    'client.adresse': joinAddress(cl.address, cl.postalCode, cl.city),
    'client.representant.nom': txt(cl.representativeName),
    'client.representant.fonction': txt(cl.representativeRole),
    'client.email_contrats': txt(cl.contractEmail),

    'consultant.nom': txt(s.consultant.name),
    'consultant.email': txt(s.consultant.email),
    'consultant.qualification': txt(s.consultant.qualification),

    'mission.intitule': txt(m.label),
    'mission.objet': txt(m.purpose),
    'mission.lieu': txt(m.location),
    'mission.modalites': txt(m.terms),
    'mission.date_debut': longDate(m.startDate),
    'mission.date_fin': m.endDate ? longDate(m.endDate) : null,
    'mission.periode': period,
    'mission.a_date_fin': !!m.endDate,
    'mission.tjm': m.tjm === null ? null : formatEuros(m.tjm),
    'mission.tjm_lettres': m.tjm === null ? null : eurosInWords(m.tjm),
    'mission.delai_paiement': m.paymentTermsDays === null ? null : String(m.paymentTermsDays),
    'mission.validation_client': m.clientValidation,
    'mission.validateur.nom': m.clientValidation ? txt(m.validatorName) : null,
    'mission.validateur.email': m.clientValidation ? txt(m.validatorEmail) : null,

    'contrat.numero': txt(s.number),
    'contrat.date': longDate(s.date),
  };
}

/** Données fictives pour l'aperçu d'un modèle quand aucune mission n'est choisie. */
export function sampleContractData(date: string): ContractData {
  return contractData({
    company: {
      legalName: 'Orkidea', legalForm: 'SASU', capital: '1 000 €', siret: '00000000000000', rcs: 'Paris 000 000 000', vatNumber: 'FR00000000000',
      address: '1 avenue de l’Exemple', postalCode: '75008', city: 'Paris', representativeName: 'Camille Martin', representativeRole: 'Président',
      financialGuarantee: 'Garantie financière n° 0000 souscrite auprès de la Banque Exemple', contractNumberPrefix: 'CS',
    },
    client: {
      id: 'exemple', name: 'Société Exemple SA', siret: '11111111111111', address: '10 rue du Client', postalCode: '69002', city: 'Lyon',
      representativeName: 'Dominique Durand', representativeRole: 'Directeur des achats', contractEmail: 'contrats@exemple.fr',
    },
    consultant: { name: 'Alex Consultant', email: 'alex@exemple.fr', qualification: 'Architecte logiciel' },
    mission: {
      id: 'exemple', consultantId: 'exemple', consultant: 'Alex Consultant', clientId: 'exemple', client: 'Société Exemple SA', label: 'Mission exemple',
      startDate: date, endDate: null, tjm: 650, clientValidation: true, validatorName: 'Claude Valideur', validatorEmail: 'valideur@exemple.fr', active: true,
      weekendPolicy: null, holidayPolicy: null, workedHolidays: null, holidayRegion: null,
      purpose: 'Accompagnement à la refonte du système d’information', location: 'Lyon, deux jours de télétravail par semaine',
      terms: null, paymentTermsDays: 30, activities: [],
    },
    date,
  });
}
