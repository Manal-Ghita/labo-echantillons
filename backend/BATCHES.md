# Lots et opérations groupées (V2)

JWT requis pour toutes les routes, ADMIN ou RESEARCHER. Consultation globale.

- `GET /batches` : références, auteur public id/nom, date et nombre de membres.
- `GET /batches/:id` : informations du lot et échantillons associés.
- `POST /batches` : `{ reference }`, créateur issu exclusivement du JWT.
- `POST /batches/:id/samples` : `{ sampleIds: [...] }`. Créateur du lot ou ADMIN,
  et propriétaire de chaque échantillon ou ADMIN. Une association déjà identique
  est sans effet ; un autre lot entraîne 409. Aucun transfert implicite.
- `POST /batches/:id/steps` : `{ operation, samples: [{ sampleId, result }] }`.
  `operation` reprend le DTO de création individuelle (type, date, résultat commun,
  opérateur facultatif, observations et valeurs). Le résultat explicite de chaque
  membre prime sur le résultat commun. Seules les personnes autorisées sur chaque
  échantillon peuvent saisir ; il n'est pas nécessaire d'être créateur du lot.

Les sélections contiennent de 1 à 100 UUID distincts (pas de contrainte 5–20).
Les valeurs sont validées avec les définitions du catalogue ; les décimaux restent
des chaînes exactes. Un membre abandonné, absent, extérieur au lot ou interdit
annule toute la saisie. Une seule transaction Serializable crée les étapes et
leurs valeurs, sans transaction imbriquée. Conflits de concurrence : 409.

Chaque échantillon possède sa propre étape, son résultat et ses corrections.
Aucune correction n'est propagée. Aucune opération partagée mutable n'est créée.
Le modèle Batch/batchId existant suffit : aucune migration nouvelle.
Pas de suppression de lots, retrait ou transfert d'échantillons dans cette phase.
Une répétition volontaire reste une nouvelle réalisation ; pas de reprise
automatique d'une requête de création en cas d'erreur réseau.

## Vérifications

Tests ordinaires : `npm test -- --runInBand` (HTTP et Prisma simulé).
Tests frontend et Playwright utilisent une API simulée.

Après compilation : `node backend/test/batches.v2.cjs`, en fournissant
temporairement `V2_TEST_DATABASE_URL` au processus. Exécution explicitement
autorisée uniquement sur `127.0.0.1:5433/labo_echantillons_v2`, utilisateur
`labo_v2`. Aucun repli vers DATABASE_URL ou les secrets V1.

Le scénario vérifie la cible et les migrations avant toute écriture, puis utilise
de vrais appels HTTP NestJS et les guards JWT, injectant une transaction Prisma
V2 englobante. Des savepoints représentent les transactions des requêtes : une
erreur annule la requête entière, sans valider les fixtures. Il vérifie aussi une
erreur SQL sur le second membre et l'indépendance des corrections.
La transaction englobante est annulée ; les neuf empreintes sont comparées
avant/après, y compris en cas d'échec. Aucun compte synthétique n'est conservé.
Ce scénario ne teste pas la concurrence avec deux connexions indépendantes.
