import { DEFAULT_COMPANY, type CompanySettings } from '../../../../shared/company';
import { DEFAULT_SETTINGS, type AppSettings } from '../../../../shared/settings';
import { nowIso } from '../../core/clock';
import { AppSettingsSchema, CompanySettingsSchema, InvoiceSettingsSchema } from './settings.schemas';
import { DEFAULT_INVOICE_SETTINGS, type InvoiceSettings } from '../../../../shared/factures';

/** Paramétrage global : valeurs enregistrées fusionnées avec les valeurs par défaut. */
export async function loadSettings(db: D1Database): Promise<AppSettings> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'app'`).first<{ value: string }>();
  if (!row) return DEFAULT_SETTINGS;
  try {
    const stored = JSON.parse(row.value) as Partial<AppSettings>;
    const merged = {
      calendar: { ...DEFAULT_SETTINGS.calendar, ...stored.calendar },
      submission: { ...DEFAULT_SETTINGS.submission, ...stored.submission },
    };
    const parsed = AppSettingsSchema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(db: D1Database, settings: AppSettings, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('app', ?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2, updated_by = ?3`,
    )
    .bind(JSON.stringify(settings), nowIso(), userId)
    .run();
}

/** Identité d'Orkidea pour les contrats (clé 'societe'), complétée par les valeurs par défaut. */
export async function loadCompany(db: D1Database): Promise<CompanySettings> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'societe'`).first<{ value: string }>();
  if (!row) return DEFAULT_COMPANY;
  try {
    const parsed = CompanySettingsSchema.safeParse({ ...DEFAULT_COMPANY, ...(JSON.parse(row.value) as Partial<CompanySettings>) });
    return parsed.success ? parsed.data : DEFAULT_COMPANY;
  } catch {
    return DEFAULT_COMPANY;
  }
}

export async function saveCompany(db: D1Database, company: CompanySettings, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('societe', ?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2, updated_by = ?3`,
    )
    .bind(JSON.stringify(company), nowIso(), userId)
    .run();
}

/** Paramètres de facturation (clé 'facturation'), complétés par les valeurs par défaut. */
export async function loadInvoiceSettings(db: D1Database): Promise<InvoiceSettings> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'facturation'`).first<{ value: string }>();
  if (!row) return DEFAULT_INVOICE_SETTINGS;
  try {
    const parsed = InvoiceSettingsSchema.safeParse({ ...DEFAULT_INVOICE_SETTINGS, ...(JSON.parse(row.value) as Partial<InvoiceSettings>) });
    return parsed.success ? parsed.data : DEFAULT_INVOICE_SETTINGS;
  } catch {
    return DEFAULT_INVOICE_SETTINGS;
  }
}

export async function saveInvoiceSettings(db: D1Database, settings: InvoiceSettings, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('facturation', ?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2, updated_by = ?3`,
    )
    .bind(JSON.stringify(settings), nowIso(), userId)
    .run();
}
