# Recherche avancée multicritère (V2)

`GET /samples` reste authentifié et conserve `q`, `parameterDefinitionId`, `min`
et `max`. Les requêtes historiques sans nouveau critère suivent le même chemin.

Paramètres supplémentaires :

- `status=ACTIVE|ABANDONED|UNSPECIFIED` (ce dernier recherche le statut SQL NULL,
  sans introduire de nouvel état dans le modèle ni dans l'API de modification).
- `batchId` : UUID de lot.
- `stepTypeId` : UUID du type d'opération recherché.
- `matchMode=ANY_STEP|SAME_STEP`, ANY_STEP par défaut.
- `numericFilters` : tableau JSON encodé dans l'URL, par exemple
  `[{"parameterDefinitionId":"<uuid>","eq":"150"},{"parameterDefinitionId":"<uuid>","min":"10","max":"20"}]`.

Tous les critères sont combinés avec ET. `q` conserve sa recherche par référence
OU nom, sans changement de sa sémantique textuelle.

SAME_STEP : une seule réalisation doit satisfaire le type d'opération et toutes
les conditions numériques, y compris le paramètre simple historique.
ANY_STEP : chaque condition d'opération peut être satisfaite par une réalisation
différente du même échantillon ; elle peut aussi l'être par la même réalisation.
Ce mode ne signifie pas que les réalisations doivent être distinctes.

Une définition peut apparaître dans plusieurs critères : rechercher 120 ET 150
sur des étapes différentes a un sens. Les critères ne sont pas fusionnés par
définition. Chaque intervalle porte toutefois sur une seule valeur.

Au maximum dix critères numériques, paramètre historique inclus ; JSON décodé
limité à 4000 caractères. Les valeurs doivent être des chaînes décimales exactes,
avec un point et sans exposant. `eq` ne peut pas être combiné à `min`/`max` dans
un critère ; les nouveaux critères nécessitent au moins une valeur ou une borne.
Les bornes sont inclusives et ne sont pas arrondies. Les contraintes DECIMAL(65,30)
existantes sont réutilisées. UUID invalides, champs inconnus et valeurs non NUMBER
sont refusés. Une valeur corrigée remplace la valeur courante recherchable ; les
snapshots du journal ne sont pas interrogés. SUCCESS et FAILURE sont conservés.

`GET /samples/search-operation-types` expose seulement id/code/nom/activité des
types actifs ou utilisés dans un historique, y compris archivés. Cela ne change
pas les permissions d'administration du catalogue. Les lots et définitions sont
chargés une fois à l'ouverture des critères avancés, jamais par ligne numérique.
Les UUID de lots/types inexistants produisent zéro résultat ; une définition
numérique inconnue produit 400, comme la recherche historique.

La recherche réutilise les index existants. Aucun changement Prisma ou migration.
Pas de groupes OU imbriqués, de recherche dans les anciennes révisions ni de
conversion d'unités. Choisir l'UUID de la définition portant l'unité souhaitée.

## Tests

Tests HTTP avec Prisma simulé, tests React et navigateur avec API simulée.
Après compilation, `node backend/test/advanced-search.v2.cjs`, en fournissant
temporairement `V2_TEST_DATABASE_URL`. Le support V2 partagé vérifie la cible et
les migrations avant toute écriture. Tous les comptes, lots, opérations et valeurs
synthétiques sont dans une transaction annulée ; les neuf empreintes sont
comparées avant/après. Aucun accès en écriture à la V1, aucune migration.
