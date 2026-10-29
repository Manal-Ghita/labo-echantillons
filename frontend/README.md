# Frontend — Les échantillons du labo

React, TypeScript strict, Vite et React Router en mode déclaratif.
Connexion et gestion des échantillons, sans bibliothèque UI.

## Démarrage

Dans `frontend`, avec Node.js compatible avec les dépendances verrouillées
(environnement vérifié : Node.js 24.22.1) :

```sh
npm ci
npm run dev
```

Vite utilise `http://localhost:5173`, sans changement automatique de port.
L'API NestJS doit être démarrée séparément, par défaut sur `http://localhost:3000`.
Le frontend ne crée aucun compte : utiliser un compte du laboratoire déjà existant.

Copier `.env.example` vers `.env` pour modifier `VITE_API_URL`.
Cette variable est publique et intégrée au JavaScript lors du build : ne jamais
y placer de mot de passe, clé JWT ou URL contenant des identifiants.
Redémarrer Vite après un changement d'environnement, reconstruire pour la production.

Côté backend, `WEB_ORIGIN` définit une seule origine autorisée, par défaut
`http://localhost:5173`. Les origines `localhost` et `127.0.0.1` sont distinctes.
Adapter cette valeur puis redémarrer NestJS si l'origine frontend change.
`npm run preview` sert le build sur `http://localhost:4173` : ce port doit également
être choisi explicitement comme `WEB_ORIGIN` pour tester les appels API en preview.

## Routes et session

- `/login` : email/mot de passe envoyés en JSON à `POST /auth/login`.
- `/samples` : liste via `GET /samples`, recherche par référence ou nom avec `q`.
- `/samples/new` : création via `POST /samples`, puis ouverture du détail.
  Seuls `reference`, `name` et la description facultative sont envoyés ;
  le backend détermine le propriétaire à partir du JWT.
- `/samples/:id` : détail via `GET /samples/:id` (UUID technique).
  Le propriétaire est affiché par son identifiant : l'API ne fournit pas son nom.
  Un statut nul est affiché « Non renseigné », sans lui attribuer un état métier.
  La fiche charge également `GET /samples/:id/steps`, dans l'ordre chronologique
  fourni par l'API, avec auteurs, opérateurs et anciens paramètres textuels.
  Le propriétaire ou ADMIN peut ouvrir la saisie d'une étape, sauf si l'échantillon
  est abandonné. Les autorisations définitives sont vérifiées par le backend.
- `/step-types` : catalogue actif via `GET /step-types`, accessible à tout utilisateur connecté.
  ADMIN peut inclure les types inactifs avec `includeInactive=true`.
- `/step-types/:id` : détail du type et de ses paramètres (clé, nom, type, unité, obligation).
  ADMIN peut modifier le nom, la description et l'état actif via `PATCH /step-types/:id`.
- `/step-types/new` : création ADMIN via `POST /step-types`, avec zéro ou plusieurs
  définitions NUMBER/TEXT/BOOLEAN. Les clés sont uniques dans le type et sensibles à la casse.
  Le code et les définitions restent immuables après création ; aucun DELETE n'est proposé.
- `/users` : espace ADMIN de consultation des comptes et de création contrôlée de
  RESEARCHER (nom, email, mot de passe initial confirmé). Aucun champ de choix du rôle.
  Les mots de passe ne sont ni persistés dans le navigateur ni renvoyés par l'API.

La recherche des échantillons peut combiner `q` et `parameterDefinitionId`, `min`,
`max`. Les bornes sont inclusives, envoyées comme chaînes sans conversion numérique.
Une correspondance porte sur une même valeur courante de n'importe quelle étape,
y compris échouée ; les anciennes valeurs conservées dans le journal ne sont pas recherchées.
Le sélecteur charge `GET /samples/numeric-parameters` : définitions NUMBER des types
actifs ou déjà utilisées dans un historique, y compris les opérations archivées.
Les définitions des types inactifs inutilisés ne sont pas exposées par cette liste.
Un filtre par UUID historique partagé dans l'URL reste également utilisable.

La fiche permet au propriétaire ou à ADMIN d'abandonner ou réactiver l'échantillon,
avec confirmation. L'abandon conserve les historiques et interdit les nouvelles étapes.
Chaque étape propose une correction motivée aux mêmes utilisateurs, avec contrôle de
révision et journal avant/après lisible par tous les utilisateurs authentifiés.
Une correction historique reste possible sur un échantillon abandonné ou un type
désactivé ; elle ne change ni le type ni l'auteur initial.
- Le profil est récupéré par `GET /auth/me` avec `Authorization: Bearer <token>`.
  Ses champs sont `id`, `name`, `email`, `role` et `createdAt`. Aucun rôle n'est
  déduit d'un JWT décodé ou d'un profil enregistré dans le navigateur.
- `RequireAuth` protège les routes et accepte une liste de rôles pour les futures pages.
  Les rôles reconnus sont ADMIN et RESEARCHER ; les contrôles effectifs restent dans l'API.

Le JWT et une échéance calculée depuis `expires_in` sont conservés dans
`sessionStorage`, pour l'onglet courant. Ni mot de passe ni profil n'y sont stockés.
Après rechargement, `/auth/me` revalide l'identité avant l'affichage des pages privées.
Si le stockage est indisponible, la session fonctionne en mémoire jusqu'au rechargement.

La déconnexion et l'expiration effacent la session locale. Il n'existe pas de route
de déconnexion/révocation dans le contrat backend actuel. Un 401 d'une requête privée
ferme la session concernée ; un 403 affiche un refus sans déconnecter l'utilisateur.
Une réponse tardive d'une ancienne session ne peut pas rétablir ou fermer la nouvelle.

## Étapes de fabrication

Le formulaire charge les types actifs depuis `GET /step-types`, puis envoie
`POST /samples/:id/steps`. Après succès, seul l'historique est rechargé.
Les types NUMBER/TEXT/BOOLEAN génèrent des champs selon leurs définitions et unités.
Les décimaux restent des chaînes avec un point, sans exposant ni conversion en
nombre JavaScript (capacité DECIMAL(65,30), aucun arrondi). Un booléen non renseigné
est distinct de « Non » (`false`). Les valeurs facultatives non renseignées sont omises.
Comme dans le backend, un paramètre TEXT obligatoire est présent même si son texte est vide.

La date saisie en heure locale est envoyée au format ISO UTC. Le résultat est
explicitement SUCCESS ou FAILURE ; aucune étape échouée ou répétée n'est masquée.
L'opérateur facultatif est saisi par UUID d'utilisateur existant : l'API ne propose
pas de liste d'utilisateurs. L'auteur de saisie n'est jamais envoyé par le formulaire.
Les erreurs conservent la saisie ; un 401 ferme la session via le client HTTP commun.

## Vérifications

```sh
npm run build
npm test
npm run lint
npm run test:browser
```

Vitest/React Testing Library vérifient les contrats de connexion/profil, le client HTTP,
les refus 401/403, la protection des routes, les rôles, l'expiration et la déconnexion,
ainsi que liste, recherche, détail, création et erreurs 400/404/409/réseau.
Ils couvrent aussi les autorisations et l'historique des étapes, les paramètres
dynamiques, les décimaux à forte précision et les enregistrements SUCCESS/FAILURE.
Le catalogue est testé avec API simulée : consultation RESEARCHER, administration
ADMIN, validation des définitions, conflits et activation/désactivation conservant
les paramètres. Ses styles sont limités à `.catalogue-page`, sans modification du CSS de connexion.
Les tests Playwright exercent aussi le parcours liste → recherche → détail → création,
navigation, rechargement, erreur de connexion et
absence de débordement horizontal à 1440×1000 et 375×812.
L'API est simulée dans ces tests : aucun compte ni donnée PostgreSQL n'est créé.

Les tests navigateur utilisent Microsoft Edge installé sur Windows lorsqu'il est présent.
Sur une autre machine, installer Chromium avec `npx playwright install chromium`,
ou définir `BROWSER_EXECUTABLE` vers un navigateur compatible.
Playwright démarre puis arrête son propre serveur Vite ; le port 5173 doit être libre.
Captures et rapports restent dans `test-results/` et `playwright-report/`, ignorés par Git.
