import type { User } from '../../shared/types';

export interface Bindings {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** URL publique de l'app, ex. https://app.orkidea.fr */
  APP_URL: string;
  /** Expéditeur des emails, ex. "Orkidea <cra@orkidea.fr>" */
  MAIL_FROM: string;
  /** "true" en local : les emails sont affichés dans la console au lieu d'être envoyés. */
  MAIL_DEV_LOG?: string;
  /** Clé API Brevo (secret : wrangler secret put BREVO_API_KEY). */
  BREVO_API_KEY?: string;
}

export interface Variables {
  user: User;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };

