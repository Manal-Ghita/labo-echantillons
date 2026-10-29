# Structure de fabrication — migration vérifiée et appliquée

Cette migration ajoute cinq tables, trois enums et des colonnes aux tables existantes.
Elle ne contient aucun remplissage métier des données historiques : lot, filiation,
statut, type, résultat et opérateur restent NULL sur les anciennes lignes.
La révision technique d'une étape commence à zéro. Les anciens paramètres textuels
et tous les champs existants restent conservés.

## Garanties SQL

- Clés étrangères avec `ON DELETE RESTRICT`, sans suppression en cascade.
- Unicité des références de lot, codes de types, paramètres par type,
  valeurs par étape/définition et révisions de correction par étape.
- Index `(definitionId, numericValue)` pour les filtres numériques.
- Une seule valeur non NULL parmi NUMBER/TEXT/BOOLEAN ; zéro et false sont acceptés.
- Valeurs numériques finies, `DECIMAL(65,30)` : jusqu'à 35 chiffres entiers et 30 décimales.
  Il s'agit de la capacité de stockage, pas d'une précision instrumentale ni d'une règle d'arrondi métier.
- Pas d'auto-parenté ; une étape d'origine exige un parent.
- Révisions d'étape non négatives, corrections strictement positives.
- Motif de correction non blanc et snapshots JSON objets.
- Exécution transactionnelle de la migration.

Les CHECK sont maintenus dans migration.sql, car ils ne sont pas représentés par le schéma Prisma.
Une future migration doit les préserver. Ne pas régénérer ce SQL sans réintégrer ces contraintes.

## Garanties à implémenter dans les services des phases suivantes

- Correspondance entre la colonne de valeur et le dataType de sa définition.
- Appartenance de la définition au StepType de l'étape et présence des paramètres obligatoires.
- Catalogue administré par ADMIN et définitions utilisées protégées des changements incompatibles.
- Auteur de saisie/correction issu du JWT, propriétaire ou ADMIN autorisé à écrire.
- Consultation authentifiée ; les GET samples actuels sont encore publics à cette phase.
- Refus d'ajout d'étape sur un échantillon abandonné.
- Absence de cycles de filiation et étape d'origine appartenant au parent.
- Correction et journal atomiques, contrôle des révisions et journal non modifiable par l'API.

Les opérateurs sont des comptes User distincts des auteurs de saisie et restent facultatifs.
Les enfants conservent leurs propres étapes ; aucune copie d'historique n'est effectuée.

## Validation et application

Toute application sur une autre base exige une autorisation explicite et une vérification de la cible et des migrations.
Le 29 octobre 2026, les deux migrations ont été appliquées exclusivement à
`labo_echantillons_test`. Les 13 tests PostgreSQL ont réussi : tables, index,
CHECK, relations, unicités, conservation d'une étape historique et client Prisma.
La migration de fabrication a ensuite été appliquée, après autorisation explicite, à
`labo_echantillons`, après sauvegarde PostgreSQL externe vérifiée par `pg_restore`.
Seule la nouvelle migration était en attente. Les deux migrations sont terminées,
avec leurs checksums conformes ; les nombres de lignes historiques sont inchangés.
Les tables, index, clés étrangères, CHECK et enums ont été vérifiés et `/health` répond HTTP 200.
La génération Prisma et les tests simulés ne valident pas les contraintes PostgreSQL.
Le client Prisma a été régénéré ; compilation, 73 tests ordinaires, 4 tests e2e simulés
et lint ont réussi. Sur une autre base, appliquer d'abord les migrations avant d'utiliser
ce client : il attend les nouvelles colonnes.
