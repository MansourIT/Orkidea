export function newId(): string {
  return crypto.randomUUID();
}

/** Jeton aléatoire URL-safe (256 bits). */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Empreinte SHA-256 (hexadécimal) : jetons (jamais stockés en clair), fichiers PDF. */
export async function sha256(value: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
