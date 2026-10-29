# Frontend — Les échantillons du labo

React, TypeScript strict, Vite et React Router en mode déclaratif.
Interface de connexion et pages privées provisoires, sans bibliothèque UI.

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
- `/samples` et `/step-types` : pages privées provisoires, sans chargement métier.
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

## Vérifications

```sh
npm run build
npm test
npm run lint
npm run test:browser
```

Vitest/React Testing Library vérifient les contrats de connexion/profil, le client HTTP,
les refus 401/403, la protection des routes, les rôles, l'expiration et la déconnexion.
Les tests Playwright exercent navigation, rechargement, erreur de connexion et
absence de débordement horizontal à 1440×1000 et 375×812.
L'API est simulée dans ces tests : aucun compte ni donnée PostgreSQL n'est créé.

Les tests navigateur utilisent Microsoft Edge installé sur Windows lorsqu'il est présent.
Sur une autre machine, installer Chromium avec `npx playwright install chromium`,
ou définir `BROWSER_EXECUTABLE` vers un navigateur compatible.
Playwright démarre puis arrête son propre serveur Vite ; le port 5173 doit être libre.
Captures et rapports restent dans `test-results/` et `playwright-report/`, ignorés par Git.
