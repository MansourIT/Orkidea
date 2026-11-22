export function newId(): string {
  return crypto.randomUUID();
}

/** Jeton aléatoire URL-safe (256 bits). */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** On ne stocke jamais un jeton en clair : uniquement son empreinte SHA-256. */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

