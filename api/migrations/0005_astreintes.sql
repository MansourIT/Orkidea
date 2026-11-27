-- Orkidea CRA — astreintes : missions concernées, jours d'astreinte (forfait) et interventions (heures).
ALTER TABLE missions ADD COLUMN on_call INTEGER NOT NULL DEFAULT 0;

-- Le consultant est d'astreinte ce jour-là pour cette mission.
CREATE TABLE on_call_days (
  timesheet_id  TEXT NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  mission_id    TEXT NOT NULL REFERENCES missions(id),
  date          TEXT NOT NULL,
  PRIMARY KEY (timesheet_id, mission_id, date)
);

-- Intervention pendant l'astreinte : end_time <= start_time signifie une fin le lendemain.
CREATE TABLE interventions (
  id            TEXT PRIMARY KEY,
  timesheet_id  TEXT NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  mission_id    TEXT NOT NULL REFERENCES missions(id),
  date          TEXT NOT NULL,
  start_time    TEXT NOT NULL,
  end_time      TEXT NOT NULL,
  minutes       INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  reason        TEXT
);
CREATE INDEX idx_interventions_timesheet ON interventions(timesheet_id, date);
