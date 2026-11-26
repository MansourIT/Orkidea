// Modèle de démonstration (régie au TJM) : sert d'exemple et de point de départ en attendant le contrat type
// d'Orkidea. Texte indicatif, à faire valider par un conseil juridique avant tout usage réel.

export const DEMO_TEMPLATE_NAME = 'Prestation en régie (TJM) — démonstration';

export const DEMO_TEMPLATE = `# Contrat commercial de prestation de portage salarial

N° {{contrat.numero}}

**Entre les soussignés**

{{societe.raison_sociale}}, {{societe.forme}} au capital de {{societe.capital}}, immatriculée au RCS de {{societe.rcs}} sous le numéro SIRET {{societe.siret}}, dont le siège est situé {{societe.adresse}}, représentée par {{societe.representant.nom}}, {{societe.representant.fonction}},
ci-après « l’Entreprise de portage »,

**Et**

{{client.raison_sociale}}, SIRET {{client.siret}}, dont le siège est situé {{client.adresse}}, représentée par {{client.representant.nom}}, {{client.representant.fonction}},
ci-après « le Client ».

## Article {{n}} – Objet

L’Entreprise de portage met à la disposition du Client {{consultant.nom}}, salarié porté, en qualité de {{consultant.qualification}}, pour la prestation suivante : {{mission.objet}}.

## Article {{n}} – Durée

La prestation est réalisée {{mission.periode}}.
{{#si non mission.a_date_fin}}
Elle se poursuit jusqu’à ce que l’une des parties y mette fin par écrit, sous réserve d’un préavis d’un mois.
{{/si}}

## Article {{n}} – Conditions d’exécution

Lieu d’exécution : {{mission.lieu}}.
{{#si mission.modalites}}

{{mission.modalites}}
{{/si}}

## Article {{n}} – Prix et facturation

La prestation est facturée au temps passé, sur la base d’un taux journalier de {{mission.tjm}} € HT ({{mission.tjm_lettres}} hors taxes).

La facturation est mensuelle, sur la base du compte rendu d’activité (CRA) du mois. Les factures sont payables à {{mission.delai_paiement}} jours à compter de leur date d’émission.

{{#si mission.validation_client}}
## Article {{n}} – Validation des comptes rendus d’activité

Chaque mois, le CRA est soumis pour validation à {{mission.validateur.nom}} ({{mission.validateur.email}}). Sans réponse sous cinq jours ouvrés, le CRA est réputé validé.
{{/si}}

## Article {{n}} – Garantie financière

L’Entreprise de portage justifie d’une garantie financière : {{societe.garantie_financiere}}.

## Article {{n}} – Responsabilités

Le salarié porté exécute la prestation en toute autonomie. Le Client s’engage à lui fournir les informations et l’accès nécessaires à sa réalisation.

---

Fait en deux exemplaires, le {{contrat.date}}.

**Pour l’Entreprise de portage**
{{societe.representant.nom}}, {{societe.representant.fonction}}

**Pour le Client**
{{client.representant.nom}}, {{client.representant.fonction}}
`;
