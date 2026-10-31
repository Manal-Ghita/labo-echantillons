# Import manuel de mesures — V2

Cette première version importe une **série de mesures indépendante**, associée à
un échantillon et éventuellement à une étape existante. Chaque valeur correspond à
une définition du catalogue. L’import ne crée pas une réalisation par ligne, ne
remplace aucun `StepParameterValue`, ne change aucun résultat et ne modifie aucun
historique de corrections. Il ne se connecte jamais aux machines du laboratoire.

## Parcours

Depuis une fiche, le propriétaire ou ADMIN ouvre **Importer un CSV** :

1. Sélectionner un CSV UTF-8 local, ou un CSV déjà joint directement à l’échantillon.
2. Choisir le séparateur des colonnes, puis **Lire les colonnes**.
3. Choisir une association facultative à une étape et le type de paramètres du catalogue.
4. Associer les colonnes souhaitées aux définitions. Les colonnes non associées sont ignorées.
5. Vérifier/déclarer les unités source. Elles doivent être identiques au catalogue.
6. Choisir le séparateur décimal et **Prévisualiser et vérifier**.
7. Corriger les erreurs éventuelles. Toutes les lignes doivent être valides.
8. Cocher la confirmation de correspondance/unités, puis **Enregistrer les mesures**.

**Le dépôt du fichier source précède la prévisualisation des mesures.** Ce dépôt
réutilise le système privé de pièces jointes ; annuler l’import conserve le fichier
source. Aucune mesure n’est écrite avant la confirmation. L’interface le précise.
Le système ne supprime pas silencieusement les fichiers annulés ou invalides.

Tous les utilisateurs authentifiés peuvent consulter les séries enregistrées depuis
**Mesures importées**, leur auteur, date et fichier source. Les valeurs décimales
sont affichées en français, sans conversion flottante. Le fichier reste téléchargeable
avec le mécanisme authentifié de pièces jointes.

## Formats et validation

- UTF-8, BOM accepté ; en-tête obligatoire, noms non vides et uniques.
- Séparateurs explicites : point-virgule, virgule ou tabulation.
- Guillemets doubles, guillemets échappés et retours à la ligne dans les cellules.
- Lignes entièrement vides ignorées ; numéros de lignes physiques conservés.
- Limites : 10 Mio, 500 lignes de mesures, 50 colonnes, 20 correspondances,
  10 000 caractères par cellule. Ces limites bornent mémoire, durée et volume SQL.
- NUMBER : validation commune `decimalValue`, capacité `DECIMAL(65,30)`, aucune
  notation exponentielle ni séparateur de milliers. Le séparateur décimal choisi
  est normalisé textuellement vers le point. Aucun passage par `Number`.
- TEXT : contenu exact conservé, texte vide autorisé comme pour les paramètres existants.
- BOOLEAN : `true`, `false` (casse indifférente), `1` ou `0`.
- Une cellule NUMBER/BOOLEAN vide est ignorée uniquement si sa définition est facultative.
  Une ligne doit contenir au moins une valeur associée. Une définition non associée
  n’est pas imposée : une série de mesures n’est pas une création d’opération.
- Une colonne et une définition ne peuvent être associées qu’une fois.
- L’unité déclarée doit correspondre exactement à la définition. Une unité explicite
  dans l’en-tête (`Température (°C)` ou `Température [°C]`) est également contrôlée.
  Aucune conversion d’unités n’est devinée. Sans unité dans le fichier, la déclaration
  de l’utilisateur reste nécessaire ; le serveur ne peut pas en vérifier la vérité physique.
- Si une étape est choisie, ses paramètres doivent appartenir à son type réel.
  Les types inactifs et les étapes anciennes sans type structuré ne sont pas proposés.
  Un fichier attaché à une étape ne peut pas être importé dans une autre association.

La prévisualisation retourne les 20 premières lignes et jusqu’à 100 erreurs détaillées
(ligne physique, colonne, message), avec le nombre total d’erreurs. Toutes les lignes
sont vérifiées, pas seulement l’aperçu. Une erreur empêche l’import complet.

## API et sécurité

JWT courant requis sur toutes les routes :

| Route | Fonction | Droits |
|---|---|---|
| `POST /samples/:sampleId/imports/inspect` | Lire les colonnes du fichier source | Propriétaire ou ADMIN |
| `POST /samples/:sampleId/imports/preview` | Valider et prévisualiser | Propriétaire ou ADMIN |
| `POST /samples/:sampleId/imports` | Confirmer atomiquement | Propriétaire ou ADMIN |
| `GET /samples/:sampleId/imports` | Consulter les imports | Tout utilisateur authentifié |
| `GET /samples/:sampleId/imports/:id` | Consulter les valeurs | Tout utilisateur authentifié |

`inspect` accepte `attachmentId` et `delimiter`. La prévisualisation ajoute
`stepTypeId`, `stepId` facultatif, `decimalSeparator` et `mappings` :
`[{ column: 0, definitionId: "UUID", unit: "°C" }]`. Les indices commencent à zéro.
L’absence d’unité est représentée explicitement par `null`.

La confirmation reprend exactement ces choix et ajoute `confirmed: true` ainsi que
`previewToken`. L’auteur vient exclusivement du JWT courant. Aucun hash de mot de
passe, rôle ou chemin privé n’est projeté. Les comptes désactivés et JWT révoqués
restent bloqués par le guard existant.

Le jeton de prévisualisation est signé, expire après dix minutes et lie l’auteur,
l’échantillon, les réglages, les définitions et les octets source. Il ne contient
pas `authVersion` et ne peut donc pas servir de JWT d’authentification. Toute modification
des choix frontend invalide l’aperçu et sa confirmation. Le backend relit et revalide
la source et les droits dans la transaction Serializable de confirmation.

Une pièce jointe indisponible renvoie 503 ; une intégrité SHA-256 incorrecte ou une
prévisualisation périmée/incompatible renvoie 409. Les erreurs de configuration du
CSV renvoient 400 ; les lignes invalides sont détaillées dans la réponse d’aperçu.

## Doublons et transactions

Une clé unique dérivée de `(échantillon, étape facultative, SHA-256 du fichier)`
empêche un second import, même après renommage ou nouvel upload. Les UUID sont
normalisés pour éviter un contournement par la casse. Le même fichier peut être
associé à deux étapes différentes, mais pas réimporté sur la même association en
changeant simplement le mapping. Il n’existe pas de bouton « forcer le doublon ».

La création de `MeasurementImport` et de toutes ses valeurs est atomique. Une erreur
SQL tardive ou un conflit concurrent n’enregistre aucune partie de la série.
Les conflits d’unicité et de sérialisation renvoient 409, sans succès trompeur ni
nouvelle tentative automatique. Le fichier source, déjà joint, reste conservé.

Les CHECK SQL protègent les nombres de lignes et la présence d’une seule colonne de
valeur. Les triggers vérifient source/échantillon/étape/type, définition et colonne
typée. Les index numériques sont conservés pour une exploitation ultérieure.
Toutes les clés étrangères utilisent `RESTRICT` ; aucun historique n’est supprimé.
Les réglages et définitions utilisés sont conservés dans un snapshot JSON.

## Extension et limites

L’interface `MeasurementParser` et le registre `measurementParsers` isolent le
format CSV du service de validation, des droits et du stockage. Un autre format
pourra fournir un adaptateur sans ajouter de connexion réseau aux machines.

Pas encore d’import automatique, de détection automatique des unités, de conversion
d’unités, de correction/suppression d’une série, d’import partiel, de pagination ni
d’intégration des séries aux filtres numériques sur les étapes. La recherche existante
continue à porter sur les paramètres courants des réalisations, sans changer de sens.
Une différence d’octets (espaces, encodage ou retours ligne) produit un autre SHA-256 :
la détection n’est pas une comparaison sémantique des mesures.
Les documents rétrospectifs et leurs mesures peuvent être associés à un échantillon
abandonné ; cela n’ajoute pas d’opération et ne le réactive pas.

## Isolation et vérification

La migration `20261104000000_measurement_imports` est additive. Le script opt-in
`test/migrate-v2-imports.cjs` exige une URL explicite `V2_TEST_DATABASE_URL` et vérifie
`127.0.0.1:5433`, utilisateur `labo_v2`, base `labo_echantillons_v2`, les migrations
et checksums précédents avant toute écriture. Il compare les neuf tables préexistantes.
Ne jamais le lancer contre la V1. Il ne charge aucun environnement V1 implicitement.

`node test/measurement-imports.v2.cjs` vérifie avec le vrai HTTP NestJS et PostgreSQL :
précision, doublons, permissions, association d’étape, erreurs, contraintes et panne
SQL tardive. Les fixtures restent dans une transaction englobante avec savepoints,
rollback final et comparaison des douze empreintes. Les fichiers synthétiques privés
du test sont nettoyés dans `finally`. Les tests ordinaires et navigateur utilisent
une API simulée, sans écrire dans PostgreSQL.

La phase 5 n’est pas déployée automatiquement. Sauvegarder ensemble PostgreSQL V2
et le volume privé V2 avant un déploiement validé.
