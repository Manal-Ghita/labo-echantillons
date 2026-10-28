# Les échantillons du labo

Backend du projet ISMIN 2026 : suivi des échantillons de microélectronique.
NestJS et TypeScript, Prisma 7.10.1, PostgreSQL, authentification JWT.

## Installation et configuration

Prérequis : Node.js 24.22.1 ou version compatible avec les dépendances verrouillées, npm et Docker Compose.
Les commandes suivantes s'exécutent depuis la racine, sauf indication contraire.

1. Copier `.env.example` vers `.env`, puis définir le mot de passe PostgreSQL local.
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
Le Compose actuel démarre uniquement PostgreSQL ; la conteneurisation de l'API reste à réaliser.

- `GET /health` : santé de l'API et de PostgreSQL, HTTP 200 ou 503.
- `POST /auth/login` : connexion par email et mot de passe.
- `GET /auth/me` : identité, JWT requis.
- `GET /samples`, `GET /samples?q=film`, `GET /samples/:id` : consultation publique.
- `POST /samples` : création, JWT requis, rôle ADMIN ou RESEARCHER.

Il n'existe aucune inscription publique. Pour le premier administrateur, définir les variables locales `ADMIN_*` et utiliser `npm run admin:create` après autorisation. Détails dans [backend/AUTH.md](backend/AUTH.md).

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

À la racine, `git diff --check` vérifie les espaces des modifications suivies.
Les schémas et migrations Prisma sont versionnés ; le client généré, `node_modules`, `dist` et les secrets restent ignorés.
