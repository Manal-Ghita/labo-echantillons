# Frontend

Interface web de l'application de suivi des échantillons, développée avec React, TypeScript et Vite.

Elle permet aux utilisateurs de consulter les échantillons, d'enregistrer les étapes de fabrication et de retrouver leur historique.

## Installation et démarrage

Depuis le dossier `frontend`, installer les dépendances et lancer le serveur :

```bash
npm ci
npm run dev
```

L'application est accessible sur :

http://localhost:5173

Le backend NestJS doit également être démarré, par défaut sur `http://localhost:3000`.

Si l'adresse de l'API est différente, copier `.env.example` vers `.env` et modifier `VITE_API_URL`.

Cette variable est intégrée au frontend et ne doit contenir aucune information secrète.

Le backend doit autoriser l'origine du frontend grâce à la variable `WEB_ORIGIN`. Si l'adresse du frontend change, cette configuration doit également être adaptée.

## Pages principales

L'application comprend plusieurs pages :

| Page | Fonction |
|---|---|
| `/login` | Connexion à un compte existant |
| `/samples` | Liste et recherche des échantillons |
| `/samples/new` | Création d'un échantillon |
| `/samples/:id` | Détail et historique de fabrication |
| `/step-types` | Catalogue des types d'opérations |
| `/step-types/new` | Création d'un type d'opération par ADMIN |
| `/step-types/:id` | Consultation et modification autorisée d'un type |
| `/users` | Gestion des comptes par ADMIN |

Les pages disponibles et les actions proposées dépendent du rôle de l'utilisateur.

## Authentification

La connexion utilise l'email et le mot de passe d'un compte déjà créé dans le backend.

Après authentification, le frontend conserve le JWT dans `sessionStorage`, pour l'onglet courant. Le mot de passe n'est pas conservé.

Lors du rechargement de la page, le profil est vérifié avec `GET /auth/me`.

Une session expirée ou une réponse `401` entraîne la déconnexion. Une réponse `403` indique que l'utilisateur n'a pas les autorisations nécessaires.

Les vérifications définitives des permissions restent réalisées par le backend.

## Gestion des échantillons

La page des échantillons permet de consulter les fiches, de rechercher un échantillon et d'en créer un nouveau.

La recherche peut utiliser une référence, un nom ou des paramètres numériques. Il est possible de préciser une valeur exacte ou un intervalle avec des bornes minimale et maximale.

La fiche d'un échantillon présente son historique de fabrication, avec les opérations réalisées, leurs paramètres, les résultats et les personnes concernées.

Le propriétaire ou un administrateur peut également abandonner ou réactiver un échantillon.

## Saisie des étapes de fabrication

Le formulaire de fabrication utilise les types d'opérations définis dans le catalogue.

Les champs sont générés selon les paramètres attendus : numériques, textuels ou booléens.

L'utilisateur renseigne la date de réalisation, le résultat (`SUCCESS` ou `FAILURE`), les paramètres et éventuellement l'opérateur.

Les valeurs numériques sont envoyées sous forme de chaînes pour conserver leur précision. Les dates sont converties au format ISO UTC avant l'envoi.

Après l'enregistrement, l'historique de l'échantillon est actualisé.

Les utilisateurs autorisés peuvent également corriger une étape existante. Les corrections nécessitent un motif et les anciennes valeurs restent consultables.

## Catalogue des opérations

Le catalogue regroupe les types d'opérations disponibles et leurs paramètres.

Les utilisateurs connectés peuvent consulter les types actifs. Les administrateurs peuvent en créer de nouveaux, modifier leur nom ou leur description et les activer ou désactiver.

Le code et les définitions des paramètres restent inchangés après la création, afin de conserver la cohérence des historiques.

## Tests

Les principales commandes sont :

```bash
npm run build
npm test
npm run lint
npm run test:browser
```

Les tests utilisent Vitest, React Testing Library et Playwright.

Ils couvrent notamment la connexion, la navigation, la recherche, la création d'échantillons, les autorisations et la saisie des étapes.

Les appels à l'API sont simulés dans ces tests. Ils ne créent donc pas de données dans PostgreSQL.

Pour les tests navigateur, Playwright peut utiliser Microsoft Edge sur Windows ou Chromium sur les autres environnements. Si nécessaire, Chromium peut être installé avec :

```bash
npx playwright install chromium
```

Les rapports de test sont enregistrés dans les dossiers prévus à cet effet, qui sont ignorés par Git.