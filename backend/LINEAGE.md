# Découpe et filiation (V2)

`POST /samples/:id/split`, JWT requis, propriétaire du parent ou ADMIN.
Corps : `{ originStepId?, children: [{ reference, name, description? }] }`.
De 1 à 100 enfants, références distinctes (mêmes validations et unicité que la
création individuelle). Deux lignes sont proposées initialement par l'interface.

Une transaction Serializable crée uniquement de nouveaux échantillons avec des
UUID serveur. Leur créateur/propriétaire est l'auteur JWT, y compris pour ADMIN.
Ils sont initialement ACTIVE, sans lot et sans étapes copiées. Aucun identifiant,
propriétaire, parent ou lot ne peut être injecté dans les données d'un enfant.
Une erreur, notamment une référence existante au second insert, annule tout.

Le parent conserve son statut, son lot, ses dates et son historique. Il n'est ni
abandonné ni réactivé automatiquement. La filiation peut être consignée de façon
rétrospective sur un parent abandonné : aucune nouvelle étape n'est créée sur le
parent et l'interdiction de lui ajouter des étapes reste appliquée.

L'étape d'origine est facultative. Elle doit exister et appartenir au parent.
Le catalogue ne définit pas de catégorie technique « découpe » : aucun filtre
arbitraire sur le code, le nom ou le résultat d'une opération n'est imposé.

Les relations existantes ne peuvent pas être réaffectées par cette API. Les UUID
nouveaux empêchent de créer un cycle ; l'ascendance existante est également
contrôlée avant insertion, avec refus d'un cycle ou d'une incohérence détectée.
Les FK et CHECK préexistants sont conservés, sans migration supplémentaire.
Les FK seules ne protègent pas des cycles créés par du SQL extérieur à l'API.

`GET /samples/:id` expose en plus le parent public `{ id, reference, name }`, les
enfants `{ id, reference, name, status }` et l'étape d'origine publique. Le frontend
affiche des liens directs, sans requête par enfant ; les historiques restent
propres à chaque fiche. Pas de réaffectation, suppression ou arbre graphique
complet dans cette phase.

## Vérifications

Tests HTTP ordinaires avec Prisma simulé : `npm test -- --runInBand`.
Tests React et navigateur avec API simulée.

Après compilation : `node backend/test/split.v2.cjs`, avec
`V2_TEST_DATABASE_URL` fourni temporairement au processus. Le support partagé
`test/support/v2-http-transaction.cjs` refuse toute autre cible que
`127.0.0.1:5433/labo_echantillons_v2`, utilisateur `labo_v2`. Il vérifie les trois
migrations avant écriture et injecte une transaction Prisma dans NestJS.
Les requêtes transactionnelles utilisent des savepoints. Les fixtures synthétiques
et les liens volontairement incohérents du test sont intégralement annulés ; les
neuf empreintes sont comparées même en cas d'échec. Ce test ne mesure pas une
concurrence réelle sur deux connexions et ne démarre aucun conteneur.
