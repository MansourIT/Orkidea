// Lien de connexion de secours (dépannage) : quand l'email ne part pas (Brevo en panne, clé invalide…).
//
//   node scripts/lien-secours.mjs contact@orkidea.fr            → production (base D1 distante)
//   node scripts/lien-secours.mjs jean.dupont@example.com --local → base locale (wrangler dev)
//
// Aucune porte dérobée dans l'API : le script crée un jeton de connexion ordinaire (usage unique, 15 minutes)
// directement dans la base, avec VOS identifiants Cloudflare (wrangler login). Seul quelqu'un qui a déjà
// accès au compte Cloudflare peut donc l'utiliser. Le lien s'affiche dans le terminal : ne le partagez pas.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE = 'orkidea-cra';
const PROD_URL = 'https://app.orkidea.fr';
const LOCAL_URL = 'http://localhost:8787';
const TTL_MINUTES = 15;

const args = process.argv.slice(2);
const local = args.includes('--local');
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();

if (!email || !/^[^@\s'"\\]+@[^@\s'"\\]+\.[^@\s'"\\]+$/.test(email)) {
  console.error('Usage : node scripts/lien-secours.mjs <email> [--local]');
  process.exit(1);
}

// Même format que l'API : jeton aléatoire 256 bits (base64url), seule son empreinte SHA-256 est stockée.
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

const sql =
  `INSERT INTO login_tokens (token_hash, user_id, expires_at) ` +
  `SELECT '${hash}', id, '${expiresAt}' FROM users WHERE email = '${email}' COLLATE NOCASE AND active = 1; ` +
  // Relecture : wrangler ne renvoie pas toujours le nombre de lignes insérées (base locale).
  `SELECT COUNT(*) AS n FROM login_tokens WHERE token_hash = '${hash}'`;

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'api');
console.log(`Création d'un lien pour ${email} (${local ? 'base locale' : 'PRODUCTION'})…`);
// Sous Windows, npx est un script .cmd : lancé via le shell, chaque argument est mis entre guillemets
// (le SQL ne contient jamais de guillemet double : l'email est contrôlé plus haut).
const windows = process.platform === 'win32';
const wranglerArgs = ['wrangler', 'd1', 'execute', DATABASE, local ? '--local' : '--remote', '--json', '--command', sql];
const res = spawnSync('npx', windows ? wranglerArgs.map((a) => `"${a}"`) : wranglerArgs, { cwd: apiDir, encoding: 'utf8', shell: windows });

if (res.status !== 0) {
  console.error(res.stderr || res.stdout);
  console.error('Échec de wrangler. Vérifiez « npx wrangler login » (et sur un réseau d’entreprise : $env:NODE_OPTIONS="--use-system-ca").');
  process.exit(1);
}

let changes = 0;
try {
  const out = JSON.parse(res.stdout.slice(res.stdout.indexOf('[')));
  changes = out.at(-1)?.results?.[0]?.n ?? 0;
} catch {
  console.error(res.stdout);
  console.error('Réponse de wrangler illisible : le lien n’a peut-être pas été créé.');
  process.exit(1);
}

if (!changes) {
  console.error(`Aucun compte actif avec l’email ${email}. Comptes : npx wrangler d1 execute ${DATABASE} --remote --command "SELECT email, role, active FROM users"`);
  process.exit(1);
}

const url = `${local ? LOCAL_URL : PROD_URL}/connexion?token=${encodeURIComponent(token)}`;
console.log(`\nLien valable ${TTL_MINUTES} minutes, utilisable une seule fois :\n\n  ${url}\n`);
console.log('Ouvrez-le dans votre navigateur puis cliquez sur « Se connecter ».');
