import { DEFAULT_SETTINGS, type AppSettings } from '../../../../shared/settings';
import { nowIso } from '../../core/clock';
import { AppSettingsSchema } from './settings.schemas';

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
