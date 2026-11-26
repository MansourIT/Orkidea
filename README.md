# Orkidea CRA

Outil de comptes rendus d'activité (CRA) d'Orkidea, servi sur **https://app.orkidea.fr**.

- **Consultants** : saisie du mois au pinceau (jours / demi-journées), vue calendrier et vue tableau, soumission, PDF, tableau de bord.
- **Valideurs clients** : lien sécurisé par email (sans compte), validation ou rejet motivé, uniquement pour leur mission.
- **Orkidea (admin)** : suivi du mois, clôture / réouverture / relance, historique, consultants, clients, missions, paramétrage.

Un seul **Cloudflare Worker** sert le front Angular (assets statiques) et l'API Hono sous `/api/*` (même origine, cookies simples, pas de CORS), avec une base **D1 en juridiction UE**. Emails transactionnels via **Brevo**.

## Sommaire

1. [Structure](#structure)
2. [Développement local](#développement-local)
3. [Vérifications et tests](#vérifications-et-tests)
4. [Intégration continue](#intégration-continue)
5. [Mise en production](#mise-en-production)
6. [Exploitation](#exploitation)
7. [Référence technique](#référence-technique)

## Structure

```
api/      Worker Hono (API), migrations D1, seed de démo, tests Workers (Vitest)
front/    Front Angular 22 (standalone, signals, zoneless, Tailwind 4, CDK) — build vers front/dist/front/browser
e2e/      Tests de bout en bout Playwright
shared/   Types, jours fériés, règles de calendrier et de soumission (partagés API / front)
scripts/  Outils (page provisoire tant que le front n'est pas construit)
.github/  Workflows CI et déploiement (GitHub Actions)
.gitlab-ci.yml  Équivalent GitLab CI, pour la future migration (non exécuté à ce jour)
```

## Développement local

Prérequis : **Node.js 22** (`.nvmrc`) et **npm 11** — npm 10.9 plante sur l'installation de ce workspace
(`Cannot read properties of null (reading 'edgesOut')`) : `npm i -g npm@11` ou `npx npm@11 install`.

```bash
npm install
cp api/.dev.vars.example api/.dev.vars
npm run db:migrate:local -w api
npm run db:seed:local -w api
```

Puis, dans deux terminaux :

```bash
npm run dev:api      # wrangler dev, http://localhost:8787
npm run dev:front    # ng serve, http://localhost:4200 (proxy /api → 8787, voir front/proxy.conf.json)
```

Ouvrir http://localhost:4200, saisir `jean.dupont@example.com` (consultant) ou `contact@orkidea.fr` (admin), puis copier le lien `[MAIL] Lien: http://localhost:4200/connexion?token=…` affiché dans la console de `wrangler dev` : en local (`MAIL_DEV_LOG=true`), les emails ne sont pas envoyés mais affichés.

- `APP_URL=http://localhost:4200` dans `api/.dev.vars` : les liens des emails et le contrôle d'origine s'appuient dessus. Pour l'API seule (curl) ou le build de production servi par le Worker (`npm run build` puis http://localhost:8787), mettez `APP_URL=http://localhost:8787`.
- Documentation interactive de l'API (Swagger) : http://localhost:8787/api/docs (uniquement si `API_DOCS=true`, jamais en production).
- Données de démo : missions Alpha (validation client exigée, valideur Marie Martin), Beta et Gamma (sans validation).

## Vérifications et tests

```bash
npm run typecheck   # API, front, e2e
npm test            # API (Workers + D1 local, migrations + seed avant chaque test) puis front (Vitest)
npm run build       # build de production du front
npm run e2e         # build du front puis tests de bout en bout (Playwright)
```

| Suite | Volume | Contenu |
|---|---|---|
| API (`api/test`, `shared/*.test.ts`) | 89 tests | scénario complet du cycle de vie, corrections de sécurité, paramétrage, jours fériés, règles partagées |
| Front (`front/src/**/*.spec.ts`) | 62 tests | pinceau, store de saisie, grille, vue tableau, connexion, validation client, admin, tableau de bord |
| E2E (`e2e/tests`) | 15 tests | voir ci-dessous |

### Tests de bout en bout (`e2e/`)

Playwright pilote l'application « comme en production » : un seul `wrangler dev` (port 8788) sert le front construit et l'API, avec une base D1 locale **recréée à chaque lancement** (`e2e/.state/`, migrations + seed). Les emails sont lus dans le journal de `wrangler dev` (`MAIL_DEV_LOG=true`) : aucune route de test n'existe côté production. Les sessions consultant et admin sont ouvertes une fois (lien magique) puis réutilisées.

| Fichier | Scénario |
|---|---|
| `auth.spec.ts` | redirection anonyme, email invalide, lien à usage unique, accès admin refusé, déconnexion |
| `parcours.spec.ts` | saisie au pinceau (glisser), demi-journées, enregistrement → soumission (jours manquants) → le valideur ne voit que sa mission, rejet motivé → correction, nouvelle soumission → ancien lien « remplacé », validation → lecture seule + PDF → historique et clôture admin |
| `saisie.spec.ts` | week-end refusé, vue tableau (clavier, dépassement > 1 j), garde « modifications non enregistrées », tableau de bord |
| `mobile.spec.ts` | Pixel 7 : pas de débordement horizontal, glisser au doigt (événements tactiles réels) |

Navigateur : Chromium (`npx playwright install chromium` si besoin, version alignée sur `@playwright/test` 1.63.0).

## Intégration continue

**GitHub Actions** (`.github/workflows/`) :

| Workflow | Déclenchement | Étapes |
|---|---|---|
| `ci.yml` — CI | chaque push et pull request | `npm ci` → types (API, front, e2e) → build du front → tests API → tests front ; puis job e2e : Chromium → build → Playwright (rapport et journal en artefact si échec) |
| `deploy.yml` — Déploiement | **automatique** après une CI réussie sur un push de `main` (fusion de PR comprise) ; **manuel** possible (Actions → Déploiement → Run workflow, branche `main`) ; environnement `production` | contrôle de `database_id` → build (vérifications complètes en manuel) → migrations D1 distantes → `wrangler deploy` → contrôle `/api/health` |

`.gitlab-ci.yml` reprend les mêmes étapes (install → check → test → build → deploy manuel sur `main`) pour le jour où le dépôt passera sur GitLab : il n'a pas encore été exécuté.

## Mise en production

À faire **une seule fois**, dans cet ordre. Rien n'est créé automatiquement : chaque étape est à votre initiative.

### 1. Cloudflare

- La zone `orkidea.fr` doit être sur le **même compte** que le Worker (c'est le cas du site vitrine).
- **Plan Workers Paid recommandé** (5 $/mois) : la génération du PDF peut dépasser les 10 ms de CPU du plan gratuit.
- Aucun enregistrement DNS `app.orkidea.fr` ne doit exister : `wrangler deploy` crée le domaine personnalisé (`routes` dans `api/wrangler.jsonc`). Le site vitrine n'est pas touché.

### 2. Base D1 en juridiction UE

```bash
cd api
npx wrangler login
npx wrangler d1 create orkidea-cra --jurisdiction eu
```

Copier le `database_id` renvoyé dans `api/wrangler.jsonc` (à la place des zéros), committer sur `main`. La juridiction est **définitive** : la base ne pourra pas quitter l'UE.

### 2 bis. Bucket R2 des contrats (juridiction UE)

Les PDF des contrats de prestation sont stockés dans un bucket R2 privé. R2 s'active une fois dans le tableau de bord Cloudflare (R2 Object Storage ; l'offre gratuite suffit), puis :

```bash
cd api
npx wrangler r2 bucket create orkidea-contrats --jurisdiction eu
```

Le nom et la juridiction correspondent au binding `CONTRACTS` de `api/wrangler.jsonc`. Sans ce bucket, `wrangler deploy` échoue. Le bucket n'est jamais public : les PDF ne sont servis que par l'API, aux administrateurs.

### 3. Brevo (emails)

1. Compte Brevo (hébergé dans l'UE), puis **authentifier le domaine `orkidea.fr`** (Expéditeurs, domaines → SPF, DKIM, DMARC dans le DNS Cloudflare). Sans cela, les liens de connexion et de validation finiront en indésirables chez les clients.
2. Créer l'expéditeur `cra@orkidea.fr` (correspond à `MAIL_FROM` dans `wrangler.jsonc`).
3. Créer une clé API transactionnelle, puis :

```bash
cd api
npx wrangler secret put BREVO_API_KEY
```

Sans cette clé, l'API refuse d'envoyer les emails (aucun lien n'est jamais écrit dans les logs de production).

### 4. GitHub

1. Cloudflare → *My Profile → API Tokens* → modèle **« Edit Cloudflare Workers »**, en ajoutant les permissions **D1 : Edit** et **Workers R2 Storage : Edit** ; limiter au compte Orkidea et à la zone `orkidea.fr`.
2. GitHub → *Settings → Environments* → créer **`production`** : *Deployment branches* = `main`. *Required reviewers* est facultatif : sans relecteur, chaque fusion dans `main` part en production dès que la CI est verte ; avec vous comme relecteur, le déploiement attend votre approbation (un clic dans Actions).
3. Dans cet environnement, ajouter les secrets **`CLOUDFLARE_API_TOKEN`** et **`CLOUDFLARE_ACCOUNT_ID`** (identifiant visible sur le tableau de bord Cloudflare).

### 5. Premier déploiement

1. Fusionner la branche de développement dans `main` : la CI tourne, puis le workflow **Déploiement** démarre tout seul s'il est vert (approbation éventuelle dans Actions).
2. Pour redéployer sans nouveau commit : Actions → **Déploiement** → *Run workflow* (branche `main`).
3. Vérifier https://app.orkidea.fr/api/health (le certificat du domaine peut prendre quelques minutes).

### Dépannage : se connecter sans email

Si les emails ne partent plus (clé Brevo invalide, domaine non authentifié…), un administrateur qui a accès au compte Cloudflare peut créer lui-même un lien de connexion :

```bash
npx wrangler login                                   # une fois ; réseau d'entreprise : $env:NODE_OPTIONS="--use-system-ca"
npm run lien-secours -- contact@orkidea.fr           # production
npm run lien-secours -- contact@orkidea.fr --local   # base locale (wrangler dev)
```

Le script crée un lien ordinaire (usage unique, 15 minutes) directement dans la base D1 avec vos identifiants Cloudflare et l'affiche dans le terminal : aucune porte dérobée n'existe dans l'API. Ne partagez pas ce lien. Les raisons d'échec d'envoi sont visibles dans Cloudflare → Workers → `orkidea-cra` → Logs (`Envoi email (…)`).

### 6. Comptes

Créer le premier compte admin (les autres comptes se créent ensuite dans l'application, onglet *Consultants*) :

```bash
cd api
npx wrangler d1 execute orkidea-cra --remote --command \
  "INSERT INTO users (id, email, name, role) VALUES (lower(hex(randomblob(16))), 'contact@orkidea.fr', 'Votre nom', 'admin')"
```

Puis, dans l'application : *Administration* → *Paramètres* (vérifier les règles), *Clients*, *Consultants*, *Missions* (TJM, validation client exigée par le contrat, activités).

### 7. Site vitrine

Dans le dépôt du site Astro (**hors de ce dépôt**), ajouter un lien « Espace consultant » vers `https://app.orkidea.fr`.

## Exploitation

| Sujet | Où / comment |
|---|---|
| Journaux | Cloudflare → Workers → `orkidea-cra` → *Logs* (`observability` activé). Aucun jeton ni lien n'y est écrit. |
| Retour arrière du code | `cd api && npx wrangler rollback` (version précédente du Worker). |
| Sauvegarde / restauration des données | D1 **Time Travel** (30 jours) : `npx wrangler d1 time-travel restore orkidea-cra --timestamp=…`. Export ponctuel : `npx wrangler d1 export orkidea-cra --remote --output=sauvegarde.sql`. |
| Nouvelle migration | ajouter `api/migrations/000N_….sql` ; elle est appliquée par le workflow de déploiement avant `wrangler deploy`. |
| Purge | tâche planifiée quotidienne (3 h 17 UTC) : sessions et liens de connexion expirés. |
| Limitation de débit | 10 demandes de lien / minute / IP (binding `LOGIN_LIMITER`), au plus 3 liens valides en attente par compte. |
| Relance d'un valideur | *Administration → CRA du mois → Relancer* (nouveau lien, l'ancien est invalidé). |
| RGPD | données au repos dans l'UE (D1 `eu`, Brevo) ; tenir à jour le registre des traitements (consultants, valideurs clients) et les DPA Cloudflare / Brevo ; durée de conservation des CRA à fixer avec l'expert-comptable (pièces de paie / facturation). |

## Référence technique

Modèle de données : `api/migrations/` ; contrat d'API : Swagger en local (`/api/docs`) ; types échangés : `shared/types.ts`.

### Organisation du front

```
front/src/
  assets/logo.svg     logo (placeholder à remplacer par le logo définitif, même nom)
  styles.css          charte Orkidea (Tailwind 4 : couleurs orchid / ink / amber, composants btn, card, input, alert)
  app/
    core/             client API typé (types de shared/), état d'authentification (signals), gardes, intercepteur 401
    layout/           barre supérieure (logo, tableau de bord, administration, menu avatar)
    ui/               icônes Lucide enregistrées
    features/         login + connexion, saisie, tableau de bord, admin, validation client
```

- Code partagé importé via l'alias `@shared/*` (`../shared`).
- Sécurité : `front/public/_headers` (CSP stricte sans script inline, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` pour ne pas divulguer les jetons des liens). L'inlining du CSS critique est désactivé car il repose sur un script inline.

### Organisation de l’API

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

### Connexion

1. `POST /api/auth/login {email}` : réponse identique que le compte existe ou non. Au plus 3 liens valides en attente par compte, 10 demandes / minute / IP.
2. L'email contient `https://app.orkidea.fr/connexion?token=…` (page du front).
3. La page envoie `POST /api/auth/callback {token}` : le jeton est consommé (usage unique, 15 min) et un cookie de session `HttpOnly` est posé (`__Host-ork_session` en HTTPS, 30 jours).

Les antivirus de messagerie qui ouvrent les liens à l'avance (GET) ne consomment donc pas le jeton.

### Paramétrage (admin → `PUT /api/admin/settings`)

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
