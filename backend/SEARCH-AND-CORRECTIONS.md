# Recherche, état et corrections

## Recherche numérique

`GET /samples` conserve `q` (référence ou nom) et accepte `parameterDefinitionId`
(UUID), `min` et `max` (chaînes décimales). Un filtre de bornes sans définition est
refusé, ainsi qu'une définition inexistante/non NUMBER, un exposant, un dépassement
de DECIMAL(65,30) ou un intervalle inversé. Les bornes sont inclusives.

Le même StepParameterValue doit satisfaire les deux bornes. La recherche porte
sur les valeurs courantes, dans n'importe quelle étape de l'échantillon, SUCCESS
ou FAILURE, jamais sur les snapshots du journal. Une définition désactivée reste
recherchable par son UUID pour conserver la consultation des historiques.
L'index existant `(definitionId, numericValue)` est réutilisé ; aucune migration.
`GET /samples/numeric-parameters`, authentifié, fournit le sélecteur : définitions
NUMBER de types actifs ou déjà utilisées, avec code, nom et état du type. Il garde
les recherches historiques disponibles sans exposer les types inactifs inutilisés.

## État d'un échantillon

`PATCH /samples/:id/status` accepte seulement `status: ACTIVE | ABANDONED`.
JWT requis, propriétaire ou ADMIN. La vérification de propriété et l'écriture sont
dans une transaction SERIALIZABLE, comme la création d'étapes : un conflit renvoie
409. L'historique n'est pas modifié. Les anciens statuts nuls ne sont pas renseignés
automatiquement. Un abandon bloque les nouvelles étapes jusqu'à réactivation.
Ce changement d'état n'est pas un journal de corrections d'étapes.

## Correction d'une étape

`POST /samples/:sampleId/steps/:stepId/corrections` exige `reason` non vide et
`expectedRevision` entier positif ou nul. Champs corrigibles facultatifs :
`performedAt` (ISO avec fuseau), `result`, `operatorId` (UUID ou null),
`observations` (texte ou null), `parameters` (ancien texte ou null),
`parameterValues` (remplacement complet des valeurs structurées).

Un champ corrigible au moins doit être fourni. L'opération, son type, l'échantillon,
l'auteur initial et la date d'enregistrement ne sont jamais modifiables par ce DTO.
L'opérateur doit exister. Les mêmes validations NUMBER/TEXT/BOOLEAN et paramètres
obligatoires que lors de la création s'appliquent. Une liste structurée fournie
remplace les valeurs courantes ; les valeurs supprimées/restaurées restent présentes
dans les snapshots immuables du journal. Les types désactivés restent corrigibles.

Dans une seule transaction SERIALIZABLE : vérifier propriétaire/ADMIN et révision,
conserver le snapshot avant, modifier les champs courants et incrémenter la révision,
puis créer StepCorrection avec motif, auteur JWT et snapshot après. Une erreur du
journal annule également la mise à jour et les remplacements de valeurs. Une révision
périmée ou un conflit concurrent renvoie 409. Aucun endpoint ne modifie/supprime le journal.

`GET /samples/:sampleId/steps/:stepId/corrections` exige un JWT, contrôle l'appartenance
de l'étape à l'échantillon et retourne le journal par révision croissante, avec le
nom public du correcteur. Les snapshots ne contiennent aucun mot de passe ou secret.
