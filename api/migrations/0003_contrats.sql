-- Orkidea CRA — contrats de prestation : données contractuelles et tables des modèles / contrats.
-- L'identité d'Orkidea (raison sociale, SIRET, garantie financière…) est un paramètre JSON : settings.key = 'societe'.

-- Client : coordonnées et signataire du contrat.
ALTER TABLE clients ADD COLUMN address TEXT;
ALTER TABLE clients ADD COLUMN postal_code TEXT;
ALTER TABLE clients ADD COLUMN city TEXT;
ALTER TABLE clients ADD COLUMN representative_name TEXT;
ALTER TABLE clients ADD COLUMN representative_role TEXT;
ALTER TABLE clients ADD COLUMN contract_email TEXT;

-- Mission : objet et conditions d'exécution reprises dans le contrat.
ALTER TABLE missions ADD COLUMN purpose TEXT;
ALTER TABLE missions ADD COLUMN location TEXT;
ALTER TABLE missions ADD COLUMN terms TEXT;
ALTER TABLE missions ADD COLUMN payment_terms_days INTEGER CHECK (payment_terms_days BETWEEN 0 AND 60);

-- Consultant : qualification (mention obligatoire du contrat de portage).
ALTER TABLE users ADD COLUMN qualification TEXT;

-- Modèle de contrat (« contrat mère »).
CREATE TABLE contract_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  created_by   TEXT REFERENCES users(id)
);

-- Versions d'un modèle : texte Markdown avec variables. Une version publiée n'est plus modifiable.
CREATE TABLE contract_template_versions (
  id            TEXT PRIMARY KEY,
  template_id   TEXT NOT NULL REFERENCES contract_templates(id),
  version       INTEGER NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('BROUILLON', 'PUBLIEE')),
  updated_at    TEXT NOT NULL,
  updated_by    TEXT REFERENCES users(id),
  published_at  TEXT,
  published_by  TEXT REFERENCES users(id),
  UNIQUE (template_id, version)
);
-- Au plus un brouillon par modèle.
CREATE UNIQUE INDEX idx_template_one_draft ON contract_template_versions(template_id) WHERE status = 'BROUILLON';

-- Contrat généré pour une mission : texte rendu et instantané des données, PDF dans R2.
CREATE TABLE contracts (
  id                   TEXT PRIMARY KEY,
  mission_id           TEXT NOT NULL REFERENCES missions(id),
  template_version_id  TEXT NOT NULL REFERENCES contract_template_versions(id),
  parent_id            TEXT REFERENCES contracts(id),      -- avenant : contrat d'origine
  number               TEXT UNIQUE,                        -- attribué à l'émission (ex. CS-2026-001)
  status               TEXT NOT NULL CHECK (status IN ('BROUILLON', 'EMIS', 'ENVOYE', 'SIGNE', 'ANNULE')),
  body                 TEXT NOT NULL,
  data_json            TEXT NOT NULL,
  pdf_key              TEXT,
  pdf_sha256           TEXT,
  signed_pdf_key       TEXT,
  signed_pdf_sha256    TEXT,
  signed_on            TEXT,
  cancel_reason        TEXT,
  created_at           TEXT NOT NULL,
  created_by           TEXT REFERENCES users(id),
  issued_at            TEXT,
  sent_at              TEXT,
  updated_at           TEXT NOT NULL,
  CHECK (status = 'BROUILLON' OR status = 'ANNULE' OR number IS NOT NULL)
);
CREATE INDEX idx_contracts_mission ON contracts(mission_id);
CREATE INDEX idx_contracts_status ON contracts(status);

-- Historique d'un contrat (qui, quand, quoi).
CREATE TABLE contract_events (
  id           TEXT PRIMARY KEY,
  contract_id  TEXT NOT NULL REFERENCES contracts(id),
  action       TEXT NOT NULL CHECK (action IN ('CREATION', 'MODIFICATION', 'EMISSION', 'ENVOI', 'SIGNATURE', 'ANNULATION')),
  actor        TEXT NOT NULL,
  comment      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_contract_events ON contract_events(contract_id, created_at);
