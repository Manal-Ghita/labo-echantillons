# Authentification locale

Le backend charge `JWT_SECRET` depuis son environnement ou `backend/.env`.
Utiliser un secret aléatoire d'au moins 32 octets. Sans secret valide, le démarrage échoue.
Les JWT HS256 expirent après une heure. Le rôle courant et l'existence du compte sont vérifiés en base à chaque requête protégée.

## Activation et révocation des comptes

`User.isActive` vaut true par défaut et `authVersion` vaut 0 (CHECK >= 0).
Un compte désactivé reçoit la même erreur de connexion générique que des
identifiants incorrects. Les JWT contiennent `sub` et `authVersion` : chaque
requête protégée vérifie en base activité et version. Les anciens JWT sans
version sont refusés ; une reconnexion générale est nécessaire après déploiement.

`PATCH /users/:id/status`, ADMIN uniquement, accepte seulement `{ "isActive": false }`
ou true. Auto-désactivation interdite (403), compte absent (404), dernier ADMIN
actif ou conflit concurrent (409). La transaction Serializable revérifie l'appelant,
protège le dernier ADMIN actif et incrémente atomiquement la version à chaque
transition. Un état déjà atteint n'incrémente rien. Un ancien JWT reste invalide
après réactivation ; une nouvelle connexion est nécessaire. Les requêtes ayant
déjà franchi le guard ne sont pas rétroactivement annulées.

`isActive` est un champ public supplémentaire ; `authVersion` et passwordHash ne
sont jamais renvoyés dans les profils, listes ou mutations. La version figure
uniquement dans les claims JWT nécessaires à sa vérification.
Les UUID, mots de passe, propriétaires et associations historiques sont conservés.
Les comptes désactivés restent sélectionnables via `GET /users/operators` (id/nom
seulement), aussi bien pour une création que pour une correction rétrospective.

Voir `test/USER-STATUS-TEST.md` pour les vérifications PostgreSQL restant à autoriser.

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
- `GET /auth/me` : en-tête `Authorization: Bearer <token>`, retourne uniquement id, nom, email, rôle, date de création et isActive.
- `GET /users` : liste des comptes, ADMIN uniquement, mêmes champs publics.
- `GET /users/operators` : ADMIN et RESEARCHER authentifiés, uniquement `{ id, name }`,
  triés par nom puis identifiant. Tout compte existant peut être opérateur ; aucun
  filtre de rôle ou d'activité supplémentaire n'est inventé. Cette route ne retourne
  ni email, ni rôle, ni date de création, ni mot de passe ou hash. Elle n'élargit pas
  les permissions de `GET /users` ou `POST /users`.
- `POST /users` : ADMIN uniquement, corps `name`, `email`, `password`.
  Le rôle créé est toujours RESEARCHER ; un champ `role` envoyé par le client est refusé.
  Mot de passe : au moins 12 caractères et au plus 72 octets UTF-8, bcrypt coût 12.
  L'email est unique et conserve la casse comme les comptes existants ; un conflit renvoie 409.
  Aucun mot de passe ou hash n'est renvoyé. Pas d'inscription publique, suppression,
  promotion ADMIN ou réinitialisation de mot de passe dans ce parcours.
- `POST /samples` : même en-tête ; rôles ADMIN ou RESEARCHER ; corps limité à reference, name et description.
- Les GET `/samples` et `/samples/:id` exigent le même en-tête JWT, pour tous les utilisateurs authentifiés.
- Les GET `/step-types` et `/step-types/:id` exigent un JWT. Seul ADMIN peut inclure ou consulter les types inactifs.
- POST et PATCH `/step-types` sont réservés à ADMIN ; code et définitions restent immuables.

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
