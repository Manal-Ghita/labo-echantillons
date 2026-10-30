# Enregistrement et historique de fabrication

Les routes `POST /samples/:sampleId/steps` et `GET /samples/:sampleId/steps`
exigent `Authorization: Bearer <token>`. Aucun identifiant d'auteur n'est accepté
dans le corps : l'identité vérifiée par le guard JWT est utilisée.

## Création

Champs du corps :

- `stepTypeId` : UUID d'un type actif du catalogue.
- `performedAt` : date ISO 8601 complète avec fuseau (`Z` ou décalage), précision
  maximale de trois décimales pour les secondes, conformément au stockage existant.
- `result` : `SUCCESS` ou `FAILURE`.
- `operatorId` facultatif : UUID d'un compte existant, distinct ou non de l'auteur.
- `observations` facultatives : texte.
- `parameterValues` : tableau (éventuellement vide si aucun paramètre obligatoire)
  de couples `{ definitionId, value }`.

Le sélecteur d'opérateur charge une fois `GET /users/operators` à l'ouverture du
formulaire et recherche les noms côté navigateur. « Moi » désigne l'identifiant
du profil authentifié ; l'opérateur reste facultatif et peut être une autre
personne. L'auteur de saisie provient toujours du JWT, et le propriétaire reste
`creatorId`. Une liste indisponible ou vide est signalée et permet d'enregistrer
sans opérateur ; aucun identifiant n'est inventé. Le POST conserve `operatorId`.

Les définitions doivent appartenir au type sélectionné, sans doublon.
Chaque définition obligatoire doit posséder une valeur. La valeur est :

- NUMBER : chaîne décimale, par exemple `"120.1234567890123456789"`, sans exposant
  ni espaces ; les nombres JSON sont refusés pour éviter une perte préalable de précision.
  Le stockage est `DECIMAL(65,30)` ; les valeurs nécessitant plus de 35 chiffres
  entiers ou plus de 30 décimales non supprimables sans perte sont refusées.
- TEXT : chaîne, y compris vide.
- BOOLEAN : vrai booléen JSON (`true`/`false`), sans conversion de chaînes.

Zéro et false sont des valeurs présentes. NULL n'est pas une valeur fournie.
Les unités viennent des définitions du catalogue ; aucune unité ou conversion
libre n'est acceptée dans les valeurs. Les UUID de définitions sont comparés sans
distinction de casse, comme PostgreSQL.

Seul le propriétaire (`creatorId`) ou ADMIN peut créer une étape. Le statut
ABANDONED bloque la création pour les deux rôles ; le propriétaire ou ADMIN peut
réactiver explicitement l'échantillon via `PATCH /samples/:id/status`. Un ancien statut NULL n'est pas modifié et
ne bloque pas l'enregistrement.

La lecture des règles et la création sont effectuées dans une transaction Prisma
sérialisable, avec une seule création imbriquée de l'étape et de toutes ses valeurs.
Le libellé d'opération est copié depuis le catalogue et `recordedAt` vient de la base.
Les étapes répétées, réussies ou échouées restent des occurrences indépendantes.
Un conflit concurrent retourne 409 sans nouvelle tentative automatique.

## Consultation et compatibilité

Tout utilisateur authentifié peut consulter l'historique de tout échantillon,
y compris abandonné. L'ordre est `performedAt`, puis `recordedAt`, puis `id`, croissants.
L'historique inclut les définitions, unités et identités publiques (id et nom)
de l'auteur et de l'opérateur, sans hash ni secret.
Les valeurs numériques sont retournées sous forme de chaînes décimales exactes.

Le champ historique `parameters` reste restitué sans conversion. Les anciennes
étapes peuvent garder type, résultat et opérateur NULL et une liste de valeurs vide.
Le POST n'accepte pas ce champ historique et ne modifie aucune ancienne étape.

Réponses : 201 pour une création ; 200 pour une lecture ; 400 pour une saisie
invalide ou un opérateur inconnu ; 401 sans JWT valide ; 403 pour un autre chercheur ;
404 pour un échantillon/type absent ; 409 pour un échantillon abandonné, un type
désactivé ou un conflit transactionnel.

Les tests ordinaires et e2e utilisent Prisma simulé. L'intégration réelle se lance
séparément, après autorisation, avec `npm run test:fabrication:postgres`, exclusivement
sur `labo_echantillons_test`. Les 22 scénarios, dont une erreur SQL forcée et son
rollback, ont été vérifiés ; détails dans [test/FABRICATION-STEPS-TEST.md](test/FABRICATION-STEPS-TEST.md).

Les corrections motivées, leurs révisions, la recherche numérique et les changements
d'état sont détaillés dans [SEARCH-AND-CORRECTIONS.md](SEARCH-AND-CORRECTIONS.md).
