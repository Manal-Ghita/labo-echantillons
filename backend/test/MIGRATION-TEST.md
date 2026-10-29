# Vérification PostgreSQL de la migration de fabrication

Commande explicite : `npm run test:migration` dans `backend`.
Ne jamais la lancer sans autorisation d'écriture dans la base de test ciblée.

Le test exige `TEST_DATABASE_URL`, sans repli sur `DATABASE_URL`, vers une base
existante et vide dont le nom finit par `_test`, distincte de `labo_echantillons`.
Il vérifie `current_database()` et refuse un schéma public contenant déjà des tables.
Il ne crée ni ne supprime de base et n'exécute aucun reset ni db push.

Le scénario applique la migration initiale via Prisma, insère un utilisateur,
un échantillon et une étape historiques fictifs, puis applique la nouvelle migration.
Ces trois fixtures et le schéma sont conservés pour inspection, sans nettoyage destructif.
Les autres essais SQL utilisent des transactions annulées et des savepoints.
Le scénario ne se relance donc pas sur la même base déjà remplie.

Il vérifie les tables, migrations, index, clés étrangères, CHECK, unicités,
la conservation de l'ancienne étape et une recherche décimale avec le client Prisma.
Les sorties de la CLI sont capturées pour ne pas afficher les détails de connexion.
Les configurations intermédiaires sont placées dans `backend/.tmp`, ignoré par Git.

`npm test` et `npm run test:e2e` restent simulés et n'exécutent pas ce scénario.
`npm run test:postgres` reste dédié au bootstrap administrateur et exige séparément
une base migrée sans utilisateur : il ne faut pas lui donner cette base après les fixtures.

## Résultat du 29 octobre 2026

- Base `labo_echantillons_test` créée après autorisation explicite dans le conteneur existant.
- Migrations `20261028000000_init` et `20261029000000_fabrication_structure` terminées avec succès.
- 13 tests PostgreSQL réussis ; les 8 CHECK et les 14 clés étrangères sont validés.
- Les 14 nouveaux index sont présents ; 27 index applicatifs au total, clés primaires incluses.
- L'ancienne étape, son texte de paramètres, ses dates et son auteur sont conservés.
- Recherche numérique Prisma vérifiée avec une valeur de 19 décimales, sans perte.
- Un utilisateur fictif, un échantillon et une étape historiques restent dans cette base pour inspection.
  Les autres fixtures sont annulées par transaction ; aucun nettoyage destructif.
- La base principale conserve uniquement la migration initiale. Les colonnes et nombres
  de lignes ont été comparés avant/après en lecture seule et sont inchangés.
- Premier lancement interrompu avant migration faute d'option Node ESM ; relance avec
  `--experimental-vm-modules` réussie. Aucun changement du schéma ni du SQL nécessaire.

## Application ultérieure sur la base principale

Le 29 octobre 2026, après validation des résultats et autorisation explicite,
la migration de fabrication a été appliquée à `labo_echantillons`, après une sauvegarde
externe contrôlée par `pg_restore`. Les deux migrations sont désormais appliquées
sur cette base. Les nombres de lignes historiques sont inchangés et `/health` répond 200.
Cette étape est distincte du scénario de test ci-dessus, qui reste limité à une base dédiée vide.
