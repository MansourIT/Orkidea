-- Orkidea CRA — facturation : factures et avoirs issus des CRA validés.
-- Paramètres de facturation (préfixe, TVA, IBAN…) : settings.key = 'facturation' (JSON validé par l'API).

-- Client : n° de TVA intracommunautaire et destinataire des factures.
ALTER TABLE clients ADD COLUMN vat_number TEXT;
ALTER TABLE clients ADD COLUMN invoice_email TEXT;

-- Mission : référence de commande du client et tarifs d'astreinte (€ HT).
ALTER TABLE missions ADD COLUMN purchase_order TEXT;
ALTER TABLE missions ADD COLUMN on_call_daily_rate REAL CHECK (on_call_daily_rate IS NULL OR on_call_daily_rate >= 0);
ALTER TABLE missions ADD COLUMN on_call_hourly_rate REAL CHECK (on_call_hourly_rate IS NULL OR on_call_hourly_rate >= 0);
ALTER TABLE missions ADD COLUMN on_call_night_pct REAL CHECK (on_call_night_pct IS NULL OR on_call_night_pct BETWEEN 0 AND 300);
ALTER TABLE missions ADD COLUMN on_call_weekend_pct REAL CHECK (on_call_weekend_pct IS NULL OR on_call_weekend_pct BETWEEN 0 AND 300);

-- Facture ou avoir. Brouillon modifiable ; une fois émise : numérotée, figée, PDF dans R2.
-- Montants en centimes (entiers) pour éviter les arrondis flottants.
CREATE TABLE invoices (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('FACTURE', 'AVOIR')),
  number             TEXT UNIQUE,
  status             TEXT NOT NULL CHECK (status IN ('BROUILLON', 'EMISE', 'ENVOYEE', 'PAYEE')),
  client_id          TEXT NOT NULL REFERENCES clients(id),
  mission_id         TEXT NOT NULL REFERENCES missions(id),
  month              TEXT NOT NULL,                   -- période facturée (YYYY-MM)
  credited_invoice_id TEXT REFERENCES invoices(id),   -- avoir : facture d'origine
  lines_json         TEXT NOT NULL,
  vat_rate           REAL NOT NULL,
  total_ht           INTEGER NOT NULL,
  total_vat          INTEGER NOT NULL,
  total_ttc          INTEGER NOT NULL,
  purchase_order     TEXT,
  notes              TEXT,
  issue_date         TEXT,
  due_date           TEXT,
  data_json          TEXT NOT NULL DEFAULT '{}',      -- instantané vendeur / client / mentions à l'émission
  pdf_key            TEXT,
  pdf_sha256         TEXT,
  sent_at            TEXT,
  paid_on            TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT REFERENCES users(id),
  updated_at         TEXT NOT NULL,
  CHECK (status = 'BROUILLON' OR number IS NOT NULL)
);
CREATE INDEX idx_invoices_mission_month ON invoices(mission_id, month);
CREATE INDEX idx_invoices_status ON invoices(status);

CREATE TABLE invoice_events (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('CREATION', 'MODIFICATION', 'EMISSION', 'ENVOI', 'PAIEMENT', 'AVOIR')),
  actor       TEXT NOT NULL,
  comment     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_invoice_events ON invoice_events(invoice_id, created_at);
