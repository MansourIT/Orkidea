-- Orkidea CRA — schéma initial (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('consultant', 'admin')),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE clients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  siret       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Une mission = un contrat consultant / client.
-- client_validation = 1 si le contrat impose la validation du CRA par le client.
CREATE TABLE missions (
  id                 TEXT PRIMARY KEY,
  consultant_id      TEXT NOT NULL REFERENCES users(id),
  client_id          TEXT NOT NULL REFERENCES clients(id),
  label              TEXT NOT NULL,
  start_date         TEXT NOT NULL,
  end_date           TEXT,
  tjm                REAL,              -- utilisé par la facturation (phase 2)
  client_validation  INTEGER NOT NULL DEFAULT 0,
  validator_name     TEXT,
  validator_email    TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (client_validation = 0 OR validator_email IS NOT NULL)
);
CREATE INDEX idx_missions_consultant ON missions(consultant_id);

-- Activités : rattachées à une mission (travail) ou communes (mission_id NULL = absences).
CREATE TABLE activities (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT REFERENCES missions(id),
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('travail', 'absence')),
  color       TEXT NOT NULL DEFAULT '#7C5CBF',
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_activities_mission ON activities(mission_id);

-- Ordre d'affichage des activités choisi par chaque consultant (glisser-déposer).
CREATE TABLE activity_order (
  user_id      TEXT NOT NULL REFERENCES users(id),
  activity_id  TEXT NOT NULL REFERENCES activities(id),
  position     INTEGER NOT NULL,
  PRIMARY KEY (user_id, activity_id)
);

-- Un CRA par consultant et par mois.
CREATE TABLE timesheets (
  id            TEXT PRIMARY KEY,
  consultant_id TEXT NOT NULL REFERENCES users(id),
  month         TEXT NOT NULL,           -- YYYY-MM
  status        TEXT NOT NULL DEFAULT 'BROUILLON'
                CHECK (status IN ('BROUILLON', 'SOUMIS', 'VALIDE', 'REJETE', 'CLOTURE')),
  comment       TEXT,
  submitted_at  TEXT,
  validated_at  TEXT,
  closed_at     TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (consultant_id, month)
);

CREATE TABLE entries (
  timesheet_id TEXT NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  activity_id  TEXT NOT NULL REFERENCES activities(id),
  quantity     REAL NOT NULL CHECK (quantity IN (0.5, 1)),
  PRIMARY KEY (timesheet_id, date, activity_id)
);

-- Demandes de validation client (une par mission concernée, seulement si client_validation = 1).
CREATE TABLE validations (
  id              TEXT PRIMARY KEY,
  timesheet_id    TEXT NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  mission_id      TEXT NOT NULL REFERENCES missions(id),
  token_hash      TEXT NOT NULL UNIQUE,
  validator_email TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'EN_ATTENTE'
                  CHECK (status IN ('EN_ATTENTE', 'VALIDE', 'REJETE', 'ANNULE')),
  comment         TEXT,
  expires_at      TEXT NOT NULL,
  decided_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_validations_timesheet ON validations(timesheet_id);

-- Authentification par lien magique.
CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Types d'absence communs à tous les consultants.
INSERT INTO activities (id, mission_id, label, kind, color) VALUES
  ('abs-cp',      NULL, 'Congés payés', 'absence', '#F2A93B'),
  ('abs-rtt',     NULL, 'RTT',          'absence', '#E9C46A'),
  ('abs-maladie', NULL, 'Maladie',      'absence', '#E76F51'),
  ('abs-autre',   NULL, 'Absence autre','absence', '#9AA0A6');

