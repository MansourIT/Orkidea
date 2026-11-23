-- Orkidea CRA — historique des changements de statut, paramétrage, surcharges de calendrier par mission.

-- Trace de chaque étape du cycle de vie d'un CRA (donnée de paie : qui, quand, quoi).
CREATE TABLE timesheet_events (
  id            TEXT PRIMARY KEY,
  timesheet_id  TEXT NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('SOUMISSION', 'VALIDATION_CLIENT', 'REJET_CLIENT', 'VALIDATION', 'CLOTURE', 'REOUVERTURE', 'RELANCE')),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('consultant', 'admin', 'client', 'systeme')),
  actor         TEXT NOT NULL,          -- id utilisateur, ou email du valideur client
  from_status   TEXT,
  to_status     TEXT,
  comment       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_events_timesheet ON timesheet_events(timesheet_id, created_at);

-- Paramétrage global (une ligne 'app', valeur JSON validée par l'API).
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  TEXT REFERENCES users(id)
);

-- Surcharges de calendrier par mission (NULL = hérite du paramétrage global).
ALTER TABLE missions ADD COLUMN weekend_policy TEXT CHECK (weekend_policy IN ('INTERDIT', 'AUTORISE'));
ALTER TABLE missions ADD COLUMN holiday_policy TEXT CHECK (holiday_policy IN ('INTERDIT', 'AUTORISE'));
ALTER TABLE missions ADD COLUMN worked_holidays TEXT;   -- tableau JSON de codes, ex. ["lundi-pentecote"]
ALTER TABLE missions ADD COLUMN holiday_region TEXT CHECK (holiday_region IN ('metropole', 'alsace-moselle'));

CREATE INDEX idx_entries_activity ON entries(activity_id);
CREATE INDEX idx_timesheets_month ON timesheets(month);
CREATE INDEX idx_login_tokens_user ON login_tokens(user_id, expires_at);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
