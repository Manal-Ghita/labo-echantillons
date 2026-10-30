# Authentification et gestion des utilisateurs

Ce document présente le fonctionnement de l'authentification et la gestion des comptes dans le backend.

## Authentification

L'application utilise des tokens JWT pour identifier les utilisateurs. Après une connexion réussie, le backend renvoie un token valable pendant une heure.

La clé `JWT_SECRET` doit être définie dans l'environnement du backend ou dans `backend/.env`. Elle doit être aléatoire et contenir au moins 32 octets. Sans clé valide, l'application ne démarre pas.

À chaque requête protégée, le backend vérifie que le compte existe toujours, qu'il est actif et que son token est encore valable. Les mots de passe sont stockés sous forme de hash avec bcrypt.

## Création du premier administrateur

L'application ne propose pas d'inscription publique. Le premier compte administrateur doit donc être créé depuis le backend.

Dans `backend/.env`, renseigner temporairement :

```env
ADMIN_NAME=
ADMIN_EMAIL=
ADMIN_PASSWORD=
```

Le mot de passe doit contenir au moins 12 caractères et ne pas dépasser 72 octets en UTF-8.

Depuis le dossier `backend`, exécuter :

```bash
npm run admin:create
```

Cette commande crée le premier administrateur, à condition qu'aucun compte administrateur n'existe déjà. Une fois le compte créé, il faut retirer les variables `ADMIN_*` du fichier d'environnement.

Les autres comptes peuvent ensuite être créés par un administrateur depuis l'application. Ils reçoivent automatiquement le rôle `RESEARCHER`.

## Rôles et autorisations

Deux rôles sont utilisés :

- **ADMIN :** gère les comptes, le catalogue des opérations et les échantillons.
- **RESEARCHER :** peut consulter les échantillons et enregistrer les opérations autorisées.

La création et la modification des étapes de fabrication sont également contrôlées selon le propriétaire de l'échantillon.

Ces autorisations sont vérifiées dans le backend, même lorsque le frontend masque certaines actions.

## Activation et désactivation des comptes

Un administrateur peut désactiver ou réactiver un compte avec `PATCH /users/:id/status`.

La désactivation empêche les nouvelles connexions et invalide les tokens précédents. Elle ne supprime pas le compte ni son historique.

Un administrateur ne peut pas désactiver son propre compte, ni désactiver le dernier administrateur actif. Après une réactivation, l'utilisateur doit se reconnecter.

Les comptes désactivés peuvent toujours apparaître dans la liste des opérateurs afin de conserver la cohérence des anciennes opérations.

## Principales routes

| Méthode | Route | Description |
|---|---|---|
| POST | `/auth/login` | Connexion avec email et mot de passe |
| GET | `/auth/me` | Informations de l'utilisateur connecté |
| GET | `/users` | Liste des comptes, réservée à ADMIN |
| GET | `/users/operators` | Liste des noms et identifiants des opérateurs |
| POST | `/users` | Création d'un compte RESEARCHER par ADMIN |
| PATCH | `/users/:id/status` | Activation ou désactivation d'un compte |
| GET | `/samples` | Consultation des échantillons |
| POST | `/samples` | Création d'un échantillon |
| GET | `/step-types` | Consultation du catalogue des opérations |

Les routes protégées utilisent l'en-tête :

```http
Authorization: Bearer <token>
```

Les mots de passe, leurs hash et la clé JWT ne sont jamais renvoyés par l'API.

## Tests

Les tests ordinaires sont lancés avec :

```bash
npm test
```

Les tests PostgreSQL sont séparés :

```bash
npm run test:postgres
```

Ces derniers nécessitent une base de test dédiée, vide et déjà migrée, configurée avec `TEST_DATABASE_URL`. Ils ne doivent pas être exécutés sur la base principale.

Enfin, `GET /health` permet de vérifier que l'API communique correctement avec PostgreSQL.