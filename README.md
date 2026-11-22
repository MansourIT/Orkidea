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

Le mode de développement complet (front Angular sur le port 4200 avec proxy `/api`) suppose `APP_URL=http://localhost:4200` dans `api/.dev.vars` (valeur de `.dev.vars.example`) : les liens des emails et le contrôle d'origine s'appuient dessus. Pour tester l'API seule avec curl, mettez `APP_URL=http://localhost:8787`.

Documentation interactive de l'API (Swagger) : http://localhost:8787/api/docs (uniquement si `API_DOCS=true`).

## Vérifications

```bash
npm run typecheck
npm test            # tests d'intégration de l'API (D1 local, migrations + seed avant chaque test)
```

## Organisation de l'API

```
api/src/
  index.ts            assemblage : en-têtes de sécurité, contrôle d'origine, modules, docs OpenAPI, tâche planifiée
  cron.ts             purge quotidienne des sessions et liens expirés
  core/               erreurs (AppError → JSON), routeur Zod/OpenAPI, emails Brevo, historique, horloge (Europe/Paris)
  modules/
    auth/             lien magique en deux temps, sessions, middlewares requireUser / requireAdmin
    timesheets/       saisie, soumission, PDF, tableau de bord consultant (routes / service / repository)
    validation/       liens publics des valideurs clients
    admin/            tableau de bord, clôture, réouverture, relance, référentiels, paramétrage
    settings/         paramétrage global (table settings)
shared/               types, jours fériés, règles de calendrier et de soumission (utilisés aussi par le front)
```

Chaque module suit le même découpage : `*.routes.ts` (contrat HTTP validé par Zod et documenté en OpenAPI), `*.service.ts` (règles métier, sans HTTP), `*.repository.ts` (requêtes D1).

## Connexion

1. `POST /api/auth/login {email}` : réponse identique que le compte existe ou non. Au plus 3 liens valides en attente par compte, 10 demandes / minute / IP.
2. L'email contient `https://app.orkidea.fr/connexion?token=…` (page du front).
3. La page envoie `POST /api/auth/callback {token}` : le jeton est consommé (usage unique, 15 min) et un cookie de session `HttpOnly` est posé (`__Host-ork_session` en HTTPS, 30 jours).

Les antivirus de messagerie qui ouvrent les liens à l'avance (GET) ne consomment donc pas le jeton.

## Paramétrage (admin → `PUT /api/admin/settings`)

| Réglage | Valeurs | Défaut |
|---|---|---|
| `calendar.weekendPolicy` / `holidayPolicy` | `INTERDIT`, `AUTORISE` | `INTERDIT` |
| `calendar.workedHolidays` | codes de fériés travaillés (ex. `lundi-pentecote`) | `[]` |
| `calendar.holidayRegion` | `metropole`, `alsace-moselle` | `metropole` |
| `submission.opening` | `TOUJOURS`, `DERNIERS_JOURS_OUVRES` (+ `opensDays`), `FIN_DE_MOIS` | 3 derniers jours ouvrés |
| `submission.futureMonths` | soumission des mois futurs | non |
| `submission.completeness` | `AVERTIR`, `BLOQUER` (jours ouvrés non renseignés) | `AVERTIR` |
| `submission.pastMonthsLimit` | mois passés encore modifiables (hors CRA rejeté) | 3 |
| `submission.deadlineWorkingDay` | date limite : Nème jour ouvré du mois suivant | 3 |

Les règles de calendrier peuvent être surchargées par mission (`weekendPolicy`, `holidayPolicy`, `workedHolidays`, `holidayRegion` ; `null` = hérite). Les absences ne sont jamais saisissables sur un jour non ouvré. Tous ces contrôles sont faits côté serveur, à l'enregistrement et de nouveau à la soumission.
