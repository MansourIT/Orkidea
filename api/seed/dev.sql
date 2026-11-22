-- Données de démonstration pour le développement local uniquement.
INSERT INTO users (id, email, name, role) VALUES
  ('u-admin', 'contact@orkidea.fr', 'Admin Orkidea', 'admin'),
  ('u-jd',    'jean.dupont@example.com', 'Jean Dupont', 'consultant');

INSERT INTO clients (id, name) VALUES
  ('c-alpha', 'Client Alpha'),
  ('c-beta',  'Client Beta');

-- Mission Alpha : validation client exigée par le contrat. Mission Beta : non.
INSERT INTO missions (id, consultant_id, client_id, label, start_date, tjm, client_validation, validator_name, validator_email) VALUES
  ('m-alpha', 'u-jd', 'c-alpha', 'Projet Alpha', '2026-01-01', 550, 1, 'Marie Martin', 'marie.martin@client-alpha.example'),
  ('m-beta',  'u-jd', 'c-beta',  'Projet Beta',  '2026-01-01', 500, 0, NULL, NULL);

INSERT INTO activities (id, mission_id, label, kind, color) VALUES
  ('a-alpha-dev',  'm-alpha', 'Développement', 'travail', '#3B82F6'),
  ('a-alpha-reu',  'm-alpha', 'Réunion',       'travail', '#3B82F6'),
  ('a-beta-dev',   'm-beta',  'Développement', 'travail', '#A855F7'),
  ('a-beta-doc',   'm-beta',  'Documentation', 'travail', '#A855F7');


-- Mission Gamma (maquette TimeFlow) : sans validation client.
INSERT INTO clients (id, name) VALUES ('c-gamma', 'Client Gamma');

INSERT INTO missions (id, consultant_id, client_id, label, start_date, tjm, client_validation) VALUES
  ('m-gamma', 'u-jd', 'c-gamma', 'Projet Gamma', '2026-01-01', 480, 0);

INSERT INTO activities (id, mission_id, label, kind, color) VALUES
  ('a-gamma-sup',  'm-gamma', 'Support',   'travail', '#22C55E'),
  ('a-gamma-for',  'm-gamma', 'Formation', 'travail', '#22C55E');
