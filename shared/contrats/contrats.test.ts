import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPANY } from '../company';
import type { Client, Mission } from '../types';
import {
  DEMO_TEMPLATE,
  MARK,
  contractData,
  eurosInWords,
  formatEuros,
  integerInWords,
  longDate,
  marker,
  parseInline,
  parseMarkdown,
  parseTemplate,
  renderTemplate,
  stripMarkers,
  type ContractData,
} from './index';

describe('nombres en toutes lettres', () => {
  it.each([
    [0, 'zéro'],
    [1, 'un'],
    [16, 'seize'],
    [17, 'dix-sept'],
    [21, 'vingt et un'],
    [22, 'vingt-deux'],
    [70, 'soixante-dix'],
    [71, 'soixante et onze'],
    [77, 'soixante-dix-sept'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [91, 'quatre-vingt-onze'],
    [99, 'quatre-vingt-dix-neuf'],
    [100, 'cent'],
    [101, 'cent un'],
    [200, 'deux cents'],
    [280, 'deux cent quatre-vingts'],
    [650, 'six cent cinquante'],
    [1000, 'mille'],
    [1080, 'mille quatre-vingts'],
    [2000, 'deux mille'],
    [80_000, 'quatre-vingt mille'],
    [200_000, 'deux cent mille'],
    [1_000_000, 'un million'],
    [2_500_000, 'deux millions cinq cent mille'],
    [1_000_000_000, 'un milliard'],
  ])('%i → %s', (n, words) => {
    expect(integerInWords(n)).toBe(words);
  });

  it('montants en euros', () => {
    expect(eurosInWords(650)).toBe('six cent cinquante euros');
    expect(eurosInWords(1)).toBe('un euro');
    expect(eurosInWords(0.5)).toBe('cinquante centimes');
    expect(eurosInWords(1.01)).toBe('un euro et un centime');
    expect(eurosInWords(1250.5)).toBe('mille deux cent cinquante euros et cinquante centimes');
    expect(eurosInWords(1_000_000)).toBe('un million d’euros');
    expect(() => eurosInWords(-1)).toThrow(RangeError);
    expect(formatEuros(1250)).toBe('1 250');
    expect(formatEuros(650.5)).toBe('650,50');
  });

  it('dates longues', () => {
    expect(longDate('2026-12-01')).toBe('1er décembre 2026');
    expect(longDate('2027-03-15')).toBe('15 mars 2027');
  });
});

describe('analyse des modèles', () => {
  it('variables connues, blocs, numérotation : aucune erreur', () => {
    const p = parseTemplate('## Article {{n}}\n{{ client.raison_sociale }}\n{{#si mission.validation_client}}\nA\n{{#sinon}}\nB\n{{/si}}');
    expect(p.issues).toEqual([]);
    expect(p.keys).toEqual(['client.raison_sociale', 'mission.validation_client']);
  });

  it('erreurs : variable inconnue avec suggestion, blocs déséquilibrés, accolades incomplètes', () => {
    const p = parseTemplate(['{{mission.lieux}}', '{{#si mission.validation_client}}', '{{/si}}', '{{/si}}', '{{#sinon}}', '{{#pour x}}', '{{client.nom}', '{{Client.Nom}}', '{{#si client.siret}}'].join('\n'));
    const msgs = p.issues.map((i) => `${i.line}:${i.message}`);
    expect(msgs).toContainEqual('1:Variable inconnue « mission.lieux ». Vouliez-vous dire « mission.lieu » ?');
    expect(msgs).toContainEqual('4:{{/si}} sans {{#si …}} correspondant');
    expect(msgs).toContainEqual('5:{{#sinon}} en dehors d’un bloc {{#si …}}');
    expect(msgs.some((m) => m.startsWith('6:Instruction inconnue'))).toBe(true);
    expect(msgs).toContainEqual('7:Accolades {{ }} incomplètes');
    expect(msgs.some((m) => m.startsWith('8:Variable mal écrite'))).toBe(true);
    expect(msgs).toContainEqual('9:Bloc {{#si client.siret}} jamais fermé par {{/si}}');
    expect(p.issues.every((i) => i.severity === 'erreur')).toBe(true);
  });

  it('avertissements : booléen affiché en texte, saut de page pas seul sur sa ligne', () => {
    const p = parseTemplate('Validation : {{mission.validation_client}}\nTexte {{saut_de_page}}');
    expect(p.issues.map((i) => i.severity)).toEqual(['avertissement', 'avertissement']);
  });

  it('variable sans suggestion si trop éloignée', () => {
    expect(parseTemplate('{{zzz.yyy}}').issues[0].message).toBe('Variable inconnue « zzz.yyy »');
  });
});

describe('rendu', () => {
  const data: ContractData = { 'client.raison_sociale': 'Acme **SA**', 'mission.validation_client': false, 'client.siret': '', 'mission.objet': 'Ligne 1\nLigne 2' };

  it('numérotation après évaluation des blocs, valeurs entourées de marqueurs', () => {
    const tpl = '## Article {{n}} – A\n{{#si mission.validation_client}}\n## Article {{n}} – B\n{{/si}}\n## Article {{n}} – C\n{{client.raison_sociale}}';
    const r = renderTemplate(parseTemplate(tpl), data);
    expect(r.missing).toEqual([]);
    expect(stripMarkers(r.text)).toBe('## Article 1 – A\n## Article 2 – C\nAcme **SA**\n');
    expect(r.text).toContain(marker('client.raison_sociale', 'ok', 'Acme **SA**'));
  });

  it('bloc « si non » et « sinon », sans ligne vide parasite', () => {
    const tpl = 'Début\n{{#si non mission.validation_client}}\nSans validation\n{{#sinon}}\nAvec validation\n{{/si}}\nFin';
    expect(stripMarkers(renderTemplate(parseTemplate(tpl), data).text)).toBe('Début\nSans validation\nFin\n');
    const withValidation = renderTemplate(parseTemplate(tpl), { ...data, 'mission.validation_client': true });
    expect(stripMarkers(withValidation.text)).toBe('Début\nAvec validation\nFin\n');
  });

  it('valeurs manquantes listées une fois, ignorées dans les blocs non retenus ; numéro différé', () => {
    const tpl = 'N° {{contrat.numero}} {{client.siret}} {{client.siret}} {{mission.lieu}}\n{{#si mission.validation_client}}{{mission.validateur.nom}}{{/si}}';
    const r = renderTemplate(parseTemplate(tpl), data);
    expect(r.missing).toEqual(['client.siret', 'mission.lieu']);
    expect(stripMarkers(r.text)).toBe('N° attribué à l’émission ⟨client.siret⟩ ⟨client.siret⟩ ⟨mission.lieu⟩\n');
  });

  it('saut de page', () => {
    const r = renderTemplate(parseTemplate('A\n\n{{saut_de_page}}\n\nB'), {});
    expect(parseMarkdown(r.text).map((b) => b.t)).toEqual(['p', 'pageBreak', 'p']);
  });
});

describe('Markdown des contrats', () => {
  it('blocs : titres, paragraphes avec retours à la ligne, listes, ligne', () => {
    const blocks = parseMarkdown('# Titre\n\nLigne A\nLigne B\n\n- un\n- deux\n  suite\n1. premier\n\n---\n### Sous-titre');
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'ol', 'hr', 'h']);
    expect(blocks[1]).toEqual({ t: 'p', c: [{ t: 'text', v: 'Ligne A' }, { t: 'br' }, { t: 'text', v: 'Ligne B' }] });
    expect(blocks[2]).toEqual({ t: 'ul', items: [[{ t: 'text', v: 'un' }], [{ t: 'text', v: 'deux' }, { t: 'br' }, { t: 'text', v: 'suite' }]] });
    expect(blocks[5]).toMatchObject({ t: 'h', level: 3 });
  });

  it('gras, italique, délimiteur orphelin et échappement', () => {
    expect(parseInline('**Entre** les *parties* 2 * 3 \\*')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'Entre' }] },
      { t: 'text', v: ' les ' },
      { t: 'em', c: [{ t: 'text', v: 'parties' }] },
      { t: 'text', v: ' 2 * 3 *' },
    ]);
  });

  it('une valeur insérée n’est jamais interprétée comme du Markdown', () => {
    const text = `**Client** : ${marker('client.raison_sociale', 'ok', '*Acme* # SA')}\n${marker('mission.objet', 'ok', 'L1\nL2')}`;
    expect(parseMarkdown(text)).toEqual([
      {
        t: 'p',
        c: [
          { t: 'strong', c: [{ t: 'text', v: 'Client' }] },
          { t: 'text', v: ' : ' },
          { t: 'var', key: 'client.raison_sociale', state: 'ok', v: '*Acme* # SA' },
          { t: 'br' },
          { t: 'var', key: 'mission.objet', state: 'ok', v: 'L1\nL2' },
        ],
      },
    ]);
    expect(text).not.toContain('\n2');
    expect(MARK.newline).toBe('');
  });
});

describe('modèle de démonstration', () => {
  const company = {
    ...DEFAULT_COMPANY,
    capital: '1 000 €',
    siret: '98765432100019',
    rcs: 'Paris',
    address: '1 avenue des Orchidées',
    postalCode: '75008',
    city: 'Paris',
    representativeName: 'Camille Bernard',
    financialGuarantee: 'Banque X, n° 123',
  };
  const client: Client = {
    id: 'c', name: 'Client Alpha', siret: '12345678900011', address: '12 rue de la Paix', postalCode: '75002', city: 'Paris',
    representativeName: 'Sophie Bernard', representativeRole: 'Directrice des achats', contractEmail: null,
  };
  const mission: Mission = {
    id: 'm', consultantId: 'u', consultant: 'Jean Dupont', clientId: 'c', client: 'Client Alpha', label: 'Projet Alpha', startDate: '2026-12-01', endDate: null,
    tjm: 650, clientValidation: true, validatorName: 'Marie Martin', validatorEmail: 'marie@alpha.fr', onCall: false, active: true,
    weekendPolicy: null, holidayPolicy: null, workedHolidays: null, holidayRegion: null,
    purpose: 'Refonte de la plateforme de paiement', location: 'Paris', terms: null, paymentTermsDays: 30, activities: [],
  };
  const consultant = { name: 'Jean Dupont', email: 'jd@x.fr', qualification: 'Architecte logiciel' };

  it('sans erreur d’analyse ; rendu complet pour une mission renseignée', () => {
    const parsed = parseTemplate(DEMO_TEMPLATE);
    expect(parsed.issues).toEqual([]);
    const data = contractData({ company, client, consultant, mission, date: '2026-11-27' });
    const r = renderTemplate(parsed, data);
    expect(r.missing).toEqual([]);
    const plain = stripMarkers(r.text);
    expect(plain).toContain('taux journalier de 650 € HT (six cent cinquante euros hors taxes)');
    expect(plain).toContain('réalisée à compter du 1er décembre 2026.\nElle se poursuit');
    expect(plain).toContain('## Article 5 – Validation des comptes rendus d’activité');
    expect(plain).toContain('## Article 7 – Responsabilités');
    expect(plain).toContain('le 27 novembre 2026');
    expect(plain).toContain('siège est situé 12 rue de la Paix, 75002 Paris');
    expect(plain).not.toContain('{{');
  });

  it('mission sans validation client ni lieu : un article de moins, données manquantes signalées', () => {
    const data = contractData({ company: DEFAULT_COMPANY, client, consultant: { ...consultant, qualification: null }, mission: { ...mission, clientValidation: false, location: null, endDate: '2027-05-31' }, date: '2026-11-27' });
    const r = renderTemplate(parseTemplate(DEMO_TEMPLATE), data);
    expect(r.missing).toEqual(['societe.capital', 'societe.rcs', 'societe.siret', 'societe.adresse', 'societe.representant.nom', 'consultant.qualification', 'mission.lieu', 'societe.garantie_financiere']);
    const plain = stripMarkers(r.text);
    expect(plain).toContain('du 1er décembre 2026 au 31 mai 2027.\n\n## Article 3');
    expect(plain).not.toContain('Validation des comptes rendus');
    expect(plain).toContain('## Article 6 – Responsabilités');
    const blocks = parseMarkdown(r.text);
    expect(blocks.filter((b) => b.t === 'h').length).toBe(7); // titre + 6 articles
  });
});

describe('comparaison de versions', () => {
  it('lignes conservées, ajoutées et supprimées, avec leurs numéros', async () => {
    const { lineDiff, diffStats } = await import('./diff');
    const d = lineDiff('A\nB\nC', 'A\nC\nD');
    expect(d).toEqual([
      { op: '=', text: 'A', oldLine: 1, newLine: 1 },
      { op: '-', text: 'B', oldLine: 2, newLine: null },
      { op: '=', text: 'C', oldLine: 3, newLine: 2 },
      { op: '+', text: 'D', oldLine: null, newLine: 3 },
    ]);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
    expect(diffStats(lineDiff('x', 'x'))).toEqual({ added: 0, removed: 0 });
  });
});
