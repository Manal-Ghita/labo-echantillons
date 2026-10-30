# Gestion des étapes de fabrication

Ce document décrit l'enregistrement des opérations réalisées sur les échantillons, leur consultation et les règles de validation.

## Enregistrement d'une étape

Chaque échantillon possède un historique de fabrication. Une étape correspond à une opération réalisée à une date donnée, avec ses paramètres et son résultat.

La création se fait avec la route :

`POST /samples/:sampleId/steps`

Les informations attendues sont :

| Champ | Description |
|---|---|
| `stepTypeId` | Identifiant d'un type d'opération actif |
| `performedAt` | Date et heure de réalisation au format ISO 8601 avec fuseau |
| `result` | `SUCCESS` ou `FAILURE` |
| `operatorId` | Identifiant facultatif de la personne ayant réalisé l'opération |
| `observations` | Commentaires facultatifs |
| `parameterValues` | Valeurs des paramètres définis pour cette opération |

L'auteur de la saisie est identifié automatiquement grâce au JWT. Il n'est donc pas nécessaire de transmettre son identifiant.

L'opérateur peut être différent de l'auteur. Le formulaire permet de choisir un utilisateur existant à partir de la liste fournie par `GET /users/operators`. Ce champ reste facultatif.

## Gestion des paramètres

Les paramètres dépendent du type d'opération sélectionné dans le catalogue. Trois types de valeurs sont possibles :

- **NUMBER :** valeur décimale transmise sous forme de chaîne, par exemple `"150.25"`.
- **TEXT :** valeur textuelle, éventuellement vide.
- **BOOLEAN :** `true` ou `false`.

Les paramètres obligatoires doivent être renseignés et chaque définition ne peut apparaître qu'une fois.

Les valeurs numériques sont conservées avec une précision décimale adaptée au stockage `DECIMAL(65,30)`. Les nombres JSON et les notations exponentielles ne sont pas acceptés pour éviter les pertes de précision.

Les unités sont définies dans le catalogue et ne sont pas saisies librement.

## Autorisations et validation

Seul le propriétaire de l'échantillon ou un administrateur peut ajouter une étape.

Il n'est pas possible d'ajouter une nouvelle opération à un échantillon abandonné. Celui-ci doit d'abord être réactivé.

Le backend vérifie également que le type d'opération est actif, que les paramètres correspondent à ses définitions et que les utilisateurs indiqués existent.

L'enregistrement est réalisé dans une transaction Prisma. Cela permet d'éviter qu'une étape soit enregistrée partiellement. En cas de conflit concurrent, l'API renvoie une erreur `409`.

## Consultation de l'historique

L'historique est accessible à tous les utilisateurs authentifiés avec :

`GET /samples/:sampleId/steps`

Les étapes sont affichées dans l'ordre chronologique, selon leur date de réalisation, leur date d'enregistrement puis leur identifiant.

Chaque étape conserve son type d'opération, ses paramètres, son résultat, ainsi que les informations publiques de l'auteur et de l'opérateur.

Une même opération peut être répétée plusieurs fois. Les opérations échouées sont également conservées.

Les anciennes données restent accessibles, même lorsqu'elles ne possèdent pas tous les champs utilisés dans la version actuelle.

## Corrections

Une étape déjà enregistrée peut être corrigée par les utilisateurs autorisés.

La correction nécessite un motif et conserve l'ancienne version dans un historique de révisions. Cela permet de retrouver les modifications sans perdre les données initiales.

Les règles détaillées concernant les corrections, la recherche numérique et le changement de statut des échantillons sont présentées dans [SEARCH-AND-CORRECTIONS.md](SEARCH-AND-CORRECTIONS.md).

## Tests

Les tests ordinaires utilisent des dépendances simulées.

Les tests avec PostgreSQL sont lancés séparément :

```bash
npm run test:fabrication:postgres
```

Ils nécessitent une base de test dédiée, `labo_echantillons_test`, déjà configurée et migrée. Ils ne doivent pas être exécutés sur la base principale.

Les scénarios détaillés sont disponibles dans [test/FABRICATION-STEPS-TEST.md](test/FABRICATION-STEPS-TEST.md).