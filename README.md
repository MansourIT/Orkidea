# Orkidea CRA

Outil de comptes rendus d'activité (CRA) d'Orkidea, servi sur **app.orkidea.fr**.
Un seul Cloudflare Worker sert le front Angular (assets statiques) et l'API Hono sous `/api/*`, avec une base D1 (juridiction UE).

## Structure

```
api/      Worker Hono (API), migrations D1, seed de démo
front/    Front Angular (à venir) — build vers front/dist/front/browser
shared/   Types et calcul des jours fériés, partagés API / front
scripts/  Outils (page provisoire tant que le front n'est pas construit)
```

## Prérequis

- Node.js 22 (`.nvmrc`)
- **npm 11** : npm 10.9 plante sur l'installation de ce workspace (`Cannot read properties of null (reading 'edgesOut')`).
  Utiliser `npx npm@11 install` ou mettre npm à jour (`npm i -g npm@11`).

## Démarrage local (API)

```bash
npx npm@11 install
cp api/.dev.vars.example api/.dev.vars
npm run db:migrate:local -w api
npm run db:seed:local -w api
npm run dev:api            # http://localhost:8787
curl http://localhost:8787/api/health
```

En local (`MAIL_DEV_LOG=true`), les emails ne sont pas envoyés : ils sont affichés dans la console de `wrangler dev`, avec les liens de connexion et de validation.

Comptes de démo : `contact@orkidea.fr` (admin), `jean.dupont@example.com` (consultant).

## Vérifications

```bash
npm run typecheck
```
