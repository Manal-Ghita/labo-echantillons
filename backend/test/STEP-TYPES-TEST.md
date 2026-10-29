# Intégration du catalogue sur PostgreSQL

Commande explicite : `npm run test:step-types:postgres`, dans `backend`.
Une autorisation d'écriture sur la base de test est requise.

`TEST_DATABASE_URL` est obligatoire et doit cibler exactement `labo_echantillons_test`.
La suite vérifie le nom de la base, les deux migrations appliquées et leurs checksums.
Elle ne crée pas de base et n'applique aucune migration.

Chaque scénario utilise une transaction Prisma réelle injectée dans le module NestJS :
les services et guards exécutent du SQL, sans simulation de leurs opérations.
Deux comptes fictifs ADMIN/RESEARCHER sont créés dans la transaction ; leurs connexions
passent par `/auth/login`, bcrypt et les guards JWT/rôles habituels.
La transaction est systématiquement annulée, même si une assertion échoue.
Un savepoint isole le conflit d'unicité attendu. Les comptes, types, définitions,
échantillons et étapes d'essai ne sont jamais validés durablement.

Les nombres de lignes des huit tables métier sont comparés avant/après la suite.
Ne pas utiliser `npm run test:migration` ici : ce dernier exige une base vide et crée
ses propres fixtures historiques. Les tests ordinaires ne lancent pas cette intégration.

## Résultat du 29 octobre 2026

Les 7 scénarios ont réussi sur `labo_echantillons_test`, avec les deux migrations
terminées et leurs checksums conformes. Création atomique et liens des paramètres,
consultation authentifiée, contrôles ADMIN/RESEARCHER, conflit PostgreSQL traduit
en HTTP 409, désactivation/réactivation et protection des définitions utilisées ont été vérifiés.
Les nombres de lignes des huit tables métier sont identiques avant et après la suite.
Aucune correction du code métier, du schéma ou des migrations n'a été nécessaire.
