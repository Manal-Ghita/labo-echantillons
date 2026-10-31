# Photos et fichiers de mesures — V2

Les fichiers sont associés soit à un échantillon, soit à l’une de ses étapes.
Une pièce jointe d’étape conserve également l’identifiant de son échantillon.
Elle n’est jamais copiée automatiquement lors d’une découpe ou d’une saisie groupée.

## Routes et droits

| Route | Fonction | Autorisation |
|---|---|---|
| `GET /samples/:sampleId/files` | Fichiers directement associés à l’échantillon | JWT actif |
| `POST /samples/:sampleId/files` | Ajouter un fichier à l’échantillon | Propriétaire ou ADMIN |
| `GET /samples/:sampleId/steps/:stepId/files` | Fichiers de cette étape | JWT actif |
| `POST /samples/:sampleId/steps/:stepId/files` | Ajouter un fichier à cette étape | Propriétaire de l’échantillon ou ADMIN |
| `GET /files/:id/download` | Télécharger les octets d’origine | JWT actif |

L’ajout utilise `multipart/form-data`, avec un seul champ `file`. Aucun identifiant
d’auteur, chemin, nom de stockage ou métadonnée libre ne vient du client. Les UUID
des routes, l’existence de l’échantillon et l’appartenance de l’étape sont vérifiés.
Les comptes désactivés et les JWT révoqués restent refusés par le guard existant.
Tous les utilisateurs authentifiés peuvent consulter les historiques du laboratoire.
Les documents rétrospectifs restent ajoutables à un échantillon abandonné : cela
n’ajoute aucune opération et ne change ni son statut, ni ses étapes.

Les réponses de liste et d’ajout exposent seulement : `id`, `originalName`,
`mimeType`, `size`, `createdAt`, `sampleId`, `stepId` et `createdBy: { id, name }`.
Le téléchargement passe par le client HTTP central avec son JWT, puis une URL
Blob temporaire côté navigateur. Aucun token n’est placé dans l’URL.

## Stockage et intégrité

La migration additive `20261103000000_attachments` crée `Attachment`, ses index,
ses clés étrangères `RESTRICT`, les CHECK de taille/type/SHA-256 et deux triggers
de cohérence échantillon/étape. Aucune table existante n’est réécrite. Les relations
Prisma sont conservées ; les triggers sont maintenus dans le SQL de migration.

Chaque fichier possède une clé UUID aléatoire, distincte de son UUID public.
Le chemin physique ne dépend jamais du nom envoyé par l’utilisateur. Le nom
d’origine est conservé pour l’affichage et le téléchargement, avec rejet des
chemins et caractères de contrôle. Le stockage utilise une création exclusive,
des permissions privées et, sous Linux, le refus des liens symboliques à la lecture.
Un SHA-256 permet de contrôler les octets avant chaque téléchargement.

La transaction Serializable vérifie les droits, écrit le fichier puis crée ses
métadonnées. Un échec de la base entraîne la suppression du seul fichier nouvellement
créé. Une erreur disque empêche la création des métadonnées. Si la réponse de COMMIT
est incertaine, la présence des métadonnées est revérifiée avant toute compensation ;
si la base est indisponible, le fichier est conservé et une alerte technique est émise.

Un arrêt brutal peut laisser un fichier orphelin : PostgreSQL et le système de fichiers
ne partagent pas de transaction distribuée. Il n’y a ni purge automatique ni nouvelle
tentative automatique. Une intervention de maintenance doit comparer les clés sur
disque à `Attachment.storageKey`, en lecture seule d’abord, sauvegarder puis demander
une autorisation avant de supprimer un orphelin. Un fichier manquant ou corrompu renvoie
503 ; ses métadonnées sont conservées pour le diagnostic.

## Configuration Docker V2

- Volume privé : `labo-echantillons-v2_attachments_data`, monté uniquement sur
  `backend-v2` dans `/app/storage/attachments`. Ni Nginx, ni le frontend ne le montent.
- `ATTACHMENT_STORAGE_DIR` : chemin absolu requis pour utiliser le stockage local.
- `ATTACHMENT_MAX_BYTES` : limite serveur, par défaut `10485760` (10 Mio), maximum
  configurable 100 Mio. Compose utilise `V2_ATTACHMENT_MAX_BYTES` si défini.
- L’image `runtime-v2` prépare un répertoire appartenant à l’utilisateur Node.
- Les cibles Docker V1 et ses volumes ne sont pas modifiés. Depuis la branche `v2`,
  utiliser exclusivement `compose.v2.yaml` et `.env.v2`, jamais `compose.yaml`.
- Sauvegarder ensemble PostgreSQL **et** le volume de fichiers pour une restauration
  cohérente. Un dump PostgreSQL seul ne contient pas les octets des pièces jointes.

Le volume sera monté au prochain déploiement V2. Aucun seed ni transfert de fichier
ou de donnée V1 n’est effectué. L’API n’expose aucun répertoire statique de stockage.

## Formats et limites de cette version

JPEG/PNG : extension, type déclaré et signatures binaires vérifiés. PDF : signature
et marqueur de fin vérifiés. CSV : extension et contenu UTF-8 non vide, sans caractères
binaires interdits ; les séparateurs et colonnes scientifiques ne sont pas imposés.
Les octets et les décimaux d’un CSV ne sont jamais convertis ni modifiés.

Ces contrôles ne constituent ni une validation complète des documents, ni un antivirus.
Tous les téléchargements sont forcés en pièce jointe avec `nosniff` et `no-store`.
Il n’y a pas d’exécution, de prévisualisation HTML/PDF ni d’import automatique de CSV.
Les formules de tableur éventuelles restent des données non fiables : utiliser les
protections du logiciel de consultation avant d’ouvrir un CSV dans un tableur.

Un seul fichier par requête ; traitement en mémoire borné par la limite configurée.
Pas encore de quota par utilisateur, pagination, antivirus, suppression, remplacement,
versionnement ou prévisualisation intégrée. Les fichiers se consultent/téléchargent
depuis la fiche et les détails de chaque étape, avec chargement des listes à la demande.
Le message frontend indique la limite initiale ; le serveur reste la source de vérité
si l’administrateur change la configuration.

## Tests sans écriture V1

- `npm test -- --runInBand attachments` : signatures, tailles, erreurs, JWT,
  permissions, noms/chemins, projections, compensation et intégrité.
- Frontend : `attachments.test.tsx` et `browser-tests/attachments.spec.ts`, API simulée.
- `node test/attachments.v2.cjs` : vrais appels HTTP NestJS, JWT, Prisma, PostgreSQL
  et fichiers temporaires privés. Cible exacte requise via `V2_TEST_DATABASE_URL` :
  `127.0.0.1:5433`, utilisateur `labo_v2`, base `labo_echantillons_v2`.
- Le test vérifie les quatre migrations et leurs checksums avant toute écriture.
  Les fixtures restent dans une transaction englobante, avec savepoints par requête,
  rollback final et comparaison des dix empreintes. Le répertoire temporaire créé
  par le test est nettoyé dans `finally`, sans toucher au volume applicatif.
- `test/migrate-v2-attachments.cjs` vérifie la cible et la liste fermée des migrations
  avant `migrate deploy`, puis compare les huit tables préexistantes. Ce script est
  opt-in : ne jamais le lancer contre une autre base ni charger un environnement V1.
