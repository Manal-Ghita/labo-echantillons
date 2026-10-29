# Les échantillons du labo

Projet ISMIN 2026 : suivi des échantillons de microélectronique.
Backend NestJS/TypeScript, Prisma 7.10.1 et PostgreSQL ; frontend React/TypeScript avec Vite.
Le frontend propose la connexion JWT, les échantillons et leurs étapes de fabrication.

## Démarrage Docker complet

Le volume porte le nom stable `labo-echantillons_postgres_data` : Compose réutilise
le volume actuel et le crée automatiquement s'il manque sur une machine neuve.
Aucune création manuelle de volume n'est nécessaire. Ne pas changer ce nom pour
contourner une erreur et ne jamais supprimer un volume contenant des données.

Compléter le `.env` racine existant à partir des clés de `.env.example`, sans
l'écraser : conserver exactement `POSTGRES_PASSWORD`, ajouter un `JWT_SECRET`
aléatoire d'au moins 32 octets (ou recopier localement celui de `backend/.env`).
Les fichiers `backend/.env` et `frontend/.env` ne sont ni copiés ni lus par les images.
Les URL publiques par défaut sont `WEB_ORIGIN=http://localhost:8080` et
`VITE_API_URL=http://localhost:3000`. Pour un navigateur sur une autre machine,
remplacer `localhost` dans les deux URL par le nom accessible, puis reconstruire.
`VITE_API_URL` est intégré au build ; ce n'est jamais une adresse Docker interne.

Sur une machine neuve, copier `.env.example` vers `.env` et choisir les deux secrets
locaux (mot de passe PostgreSQL et JWT). Sur une installation existante, conserver
leurs valeurs. Après cette configuration, une seule commande démarre toute la stack :

```sh
docker compose up --build
```

Ouvrir `http://localhost:8080`. L'API reste sur `http://localhost:3000` et
PostgreSQL sur le port local 5432. Libérer les ports 8080, 3000 et 5432 avant le
lancement, sans arrêter arbitrairement d'autres services.
Nginx sert les fichiers statiques et les routes React directes (`/samples`, etc.).
NestJS utilise l'hôte interne `db` ; l'URL PostgreSQL est construite en mémoire
avec le mot de passe brut du `.env` racine, correctement encodé pour une URL.
Le backend accepte uniquement l'origine `WEB_ORIGIN` pour CORS et les en-têtes JWT.

Ordre de démarrage : `db` sain → `migrate` terminé avec succès → `backend` sain
→ `frontend`. Le service ponctuel `migrate` utilise uniquement la version Prisma
verrouillée et `prisma migrate deploy --config prisma.config.ts` : il applique
les migrations versionnées en attente, sans génération de migration, reset ni seed.
Sur la base déjà à jour, aucune migration métier n'est réappliquée. Un échec bloque
le lancement de l'API ; ne pas le contourner. Relire toute nouvelle migration et
obtenir l'autorisation requise avant les lancements suivants.
Les images sont construites sans connexion PostgreSQL et sans secret de production.
L'image API contient uniquement les dépendances de production ; le CLI Prisma
reste dans l'image de migration. Aucun administrateur n'est créé au démarrage.

Vérifications après un lancement autorisé :

```sh
docker compose ps --all
docker compose logs migrate
curl http://localhost:3000/health
curl http://localhost:8080/healthz
curl -I http://localhost:8080/samples
```

Pour arrêter en conservant les conteneurs et le volume : `docker compose stop`.
Pour reprendre sans reconstruction : `docker compose up -d`.
Ne jamais supprimer le volume ni réinitialiser la base. Ne pas afficher une
configuration Compose développée ou un inspect complet, qui exposeraient les secrets.
Le test local de la préparation d'environnement Docker est
`node --test backend/docker/start.test.cjs` (aucune connexion ni écriture PostgreSQL).

## Installation et configuration

Prérequis : Node.js 24.22.1 ou version compatible avec les dépendances verrouillées, npm et Docker Compose.
Les commandes suivantes s'exécutent depuis la racine, sauf indication contraire.

1. Compléter le `.env` racine avec les clés de `.env.example`, notamment le mot de passe PostgreSQL existant et `JWT_SECRET` ; ne pas écraser une configuration existante.
2. Copier `backend/.env.example` vers `backend/.env`.
3. Compléter `DATABASE_URL` avec le même mot de passe, encodé pour une URL, et définir un `JWT_SECRET` aléatoire d'au moins 32 octets. Ne jamais versionner ces fichiers.
4. Démarrer PostgreSQL : `docker compose up -d db`.
5. Dans `backend`, installer les dépendances : `npm ci`, puis générer le client : `npm run db:generate`.
6. Sur une nouvelle base, après validation de la cible et autorisation, appliquer les migrations existantes : `npx prisma migrate deploy --config prisma.config.ts`. Ne pas réinitialiser une base existante.

Pour générer le secret, dans un terminal privé : `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"`.
Copier le résultat uniquement dans le fichier local `backend/.env`.

## Démarrage et routes

Dans `backend`, lancer `npm run start:dev`. L'API écoute par défaut sur `http://localhost:3000`.
Pour un lancement compilé : `npm run build`, puis `npm run start:prod`.
Ce mode local permet de garder NestJS en développement ; le Compose complet décrit plus haut est une alternative.

- `GET /health` : santé de l'API et de PostgreSQL, HTTP 200 ou 503.
- `POST /auth/login` : connexion par email et mot de passe.
- `GET /auth/me` : identité, JWT requis.
- `GET /samples`, `GET /samples?q=film`, `GET /samples/:id` : consultation authentifiée.
- `POST /samples` : création, JWT requis, rôle ADMIN ou RESEARCHER.
- `GET /samples?parameterDefinitionId=UUID&min=0.125&max=100` : recherche numérique authentifiée, combinable avec `q`.
- `PATCH /samples/:id/status` : `{ "status": "ACTIVE" }` ou `ABANDONED`, propriétaire ou ADMIN, sans suppression d'historique.
- `POST /samples/:sampleId/steps` : étape et paramètres structurés, propriétaire ou ADMIN.
- `GET /samples/:sampleId/steps` : historique chronologique, tout utilisateur authentifié.
- `POST /samples/:sampleId/steps/:stepId/corrections` : correction avec motif et révision attendue, propriétaire ou ADMIN.
- `GET /samples/:sampleId/steps/:stepId/corrections` : journal avant/après accessible aux utilisateurs authentifiés.
- `GET /users`, `POST /users` : consultation des comptes et création de RESEARCHER, ADMIN uniquement ; aucun rôle client accepté.
- `GET /step-types`, `GET /step-types/:id` : types actifs et définitions, JWT requis.
- `GET /step-types?includeInactive=true` : inclut les types inactifs, ADMIN uniquement.
- `POST /step-types`, `PATCH /step-types/:id` : administration du catalogue, ADMIN uniquement.

Les types sont créés avec `code`, `name`, `description` facultative et un tableau
`parameters` (éventuellement vide). Chaque paramètre possède une `key` unique dans
le type, un `name`, un `dataType` NUMBER/TEXT/BOOLEAN, une `unit` facultative et
un booléen `isRequired`. Les clés commencent par une lettre et utilisent lettres,
chiffres et underscores ; les espaces extérieurs sont retirés.
Codes et clés restent sensibles à la casse.

Le PATCH accepte uniquement `name`, `description` (ou null pour l'effacer) et
`isActive`. Le code et les définitions, y compris le libellé d'un paramètre,
sont immuables dès la création afin de protéger leur signification historique.
Pour une évolution incompatible, créer un nouveau type et désactiver l'ancien.
Il n'existe aucune route de suppression physique. Un chercheur reçoit 404 pour
la consultation individuelle d'un type inactif ; ADMIN peut encore le consulter.

Il n'existe aucune inscription publique. Pour le premier administrateur, définir les variables locales `ADMIN_*` et utiliser `npm run admin:create` après autorisation. Détails dans [backend/AUTH.md](backend/AUTH.md).
Une fois connecté comme ADMIN, l'espace **Comptes** permet de créer un RESEARCHER.
Le mot de passe initial est choisi par ADMIN, confirmé et effacé du formulaire après
la requête ; il doit être communiqué au chercheur par un canal privé.

Le contrat de saisie des étapes, les décimaux exacts et la compatibilité des historiques
sont décrits dans [backend/FABRICATION.md](backend/FABRICATION.md).

## Frontend React

Dans un second terminal :

```sh
cd frontend
npm ci
# Copier .env.example vers .env si une URL API différente est nécessaire.
npm run dev
```

Ouvrir `http://localhost:5173`. Le frontend appelle par défaut `http://localhost:3000`.
`VITE_API_URL` est une configuration publique, sans secret. Le backend accepte
uniquement l'origine configurée par `WEB_ORIGIN` (par défaut `http://localhost:5173`).
Après changement de configuration CORS, redémarrer l'API.
La connexion utilise un compte déjà existant ; aucun compte n'est créé par le frontend.
Les pages Échantillons permettent liste, recherche, création, détail et saisie des
étapes avec historique. Le catalogue permet la consultation des définitions et,
pour ADMIN, leur création ainsi que la modification descriptive et l'activation
ou désactivation des types. Les définitions existantes restent immuables.

Dans `frontend` : `npm run build`, `npm test`, `npm run lint` et, pour les essais
navigateur desktop/mobile, `npm run test:browser`.
Les tests utilisent des réponses API simulées et ne touchent pas PostgreSQL.
Configuration des sessions et détails des tests : [frontend/README.md](frontend/README.md).

## Vérifications

Dans `backend` :

```sh
npm run db:validate
npm run db:generate
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run lint
```

Les tests ordinaires et e2e utilisent Prisma simulé et n'écrivent pas dans PostgreSQL.
Le test d'intégration réel est séparé : `npm run test:postgres`, uniquement après accord, avec une base dédiée vide déjà migrée et `TEST_DATABASE_URL`. Voir [backend/AUTH.md](backend/AUTH.md).
L'intégration du catalogue se lance séparément avec `npm run test:step-types:postgres`,
après autorisation, exclusivement sur `labo_echantillons_test` déjà migrée.
Ses comptes et données fictifs sont annulés par transaction ; détails dans
[backend/test/STEP-TYPES-TEST.md](backend/test/STEP-TYPES-TEST.md).
L'intégration des étapes utilise `npm run test:fabrication:postgres`, après autorisation,
sur cette même base dédiée. Ses fixtures sont annulées par transaction et savepoints ;
voir [backend/test/FABRICATION-STEPS-TEST.md](backend/test/FABRICATION-STEPS-TEST.md).

À la racine, `git diff --check` vérifie les espaces des modifications suivies.
Les schémas et migrations Prisma sont versionnés ; le client généré, `node_modules`, `dist` et les secrets restent ignorés.

La validation fonctionnelle avec vrai navigateur et vrai PostgreSQL est séparée des
tests ordinaires : [dispositif transactionnel](backend/test/FUNCTIONAL-BROWSER-TEST.md).
Elle n'utilise que `labo_echantillons_test`, annule ses fixtures et vérifie les
empreintes avant/après ; ne pas la lancer contre la base principale.
