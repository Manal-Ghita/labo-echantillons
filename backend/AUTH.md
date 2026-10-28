# Authentification locale

Le backend charge `JWT_SECRET` depuis son environnement ou `backend/.env`.
Utiliser un secret aléatoire d'au moins 32 octets. Sans secret valide, le démarrage échoue.
Les JWT HS256 expirent après une heure. Le rôle courant et l'existence du compte sont vérifiés en base à chaque requête protégée.

## Premier administrateur

Définir localement `ADMIN_NAME`, `ADMIN_EMAIL` et `ADMIN_PASSWORD` dans l'environnement du terminal ou dans `backend/.env` (ignoré par Git).
Le mot de passe doit contenir au moins 12 caractères et au plus 72 octets UTF-8, limite de bcrypt.
Dans `backend`, exécuter `npm run admin:create` : compile puis crée le compte avec bcrypt (coût 12).
Retirer ensuite les variables `ADMIN_*` de l'environnement et de `.env`.

Cette commande n'est pas exécutée automatiquement et n'est pas une route HTTP.
Elle refuse d'agir si un administrateur existe ou si l'email est déjà pris ; elle ne remplace aucun utilisateur.
Aucun compte initial n'est créé par les tests.

## Routes

- `POST /auth/login` : JSON `{ "email": "…", "password": "…" }`, retourne `access_token`, `token_type` et `expires_in`.
- `GET /auth/me` : en-tête `Authorization: Bearer <token>`, retourne uniquement id, nom, email, rôle et date de création.
- `POST /samples` : même en-tête ; rôles ADMIN ou RESEARCHER ; corps limité à reference, name et description.
- Les GET `/samples` et `/samples/:id` restent publics.

Les mots de passe, leurs empreintes et la clé JWT ne sont jamais retournés par ces routes.
Les réponses de connexion ne distinguent pas email inconnu et mot de passe incorrect.

## Test PostgreSQL du bootstrap

`npm test` utilise des simulations et ne crée aucun compte réel.
`npm run test:postgres` est une commande séparée, à lancer uniquement après accord.
Elle exige `TEST_DATABASE_URL` vers une base vide distincte, dont le nom finit par `_test`, avec les migrations déjà appliquées.
Elle ne crée ni base ni schéma et n'applique aucune migration.
Le test insère un administrateur temporaire, vérifie bcrypt et le refus d'un second administrateur, puis annule la transaction et contrôle l'absence de compte persistant.
Ne jamais utiliser la base de développement pour ce test.

`GET /health` vérifie PostgreSQL par `SELECT 1` : HTTP 200 si disponible, 503 en cas d'erreur ou de délai dépassant trois secondes, sans détails sensibles.
Le backend attend toujours une connexion PostgreSQL réussie lors de son initialisation ; une base indisponible au démarrage empêche le lancement de l'API.
