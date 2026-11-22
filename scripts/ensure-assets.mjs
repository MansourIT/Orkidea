// Wrangler exige que le dossier d'assets existe (dev, tests, deploy).
// Tant que le front n'est pas construit, on crée une page provisoire.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'front', 'dist', 'front', 'browser');
const index = join(dir, 'index.html');
if (!existsSync(index)) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    index,
    '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Orkidea CRA</title>' +
      '<p>Front non construit : lancez <code>npm run build -w front</code>.</p></html>\n',
  );
  console.log(`[ensure-assets] page provisoire créée : ${index}`);
}
