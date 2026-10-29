# Étapes de fabrication — intégration PostgreSQL

Commande explicite : `npm run test:fabrication:postgres`, dans `backend`,
après autorisation d'écriture sur la base dédiée.

La suite exige `TEST_DATABASE_URL` vers exactement `labo_echantillons_test`, schéma
public, sans repli sur la base principale. Avant toute écriture, elle vérifie
`current_database()`, les deux migrations terminées et leurs checksums.
Elle ne crée pas de base, n'applique pas de migration et ne modifie pas le schéma.

Chaque scénario ouvre une transaction Prisma externe SERIALIZABLE. Les comptes
ADMIN/RESEARCHER, échantillons et types fictifs sont créés dans cette transaction.
Les connexions passent par `/auth/login` avec bcrypt ; les routes HTTP utilisent
les véritables guards JWT/rôles et les délégations Prisma réelles.

## Transactions du service et nettoyage

Le client transactionnel n'expose pas `$transaction`. Un adaptateur réservé au test
remplace cet appel par un SAVEPOINT sur la même connexion, en vérifiant que
l'isolation demandée par le service reste SERIALIZABLE. Les appels SQL ne sont pas
simulés. Chaque requête peut être annulée indépendamment ; la transaction externe
est systématiquement annulée à la fin du scénario, même si une assertion échoue.
Seule l'exception sentinelle prévue pour ce rollback final est interceptée ; les
autres erreurs et les assertions échouées restent des échecs de test.

Le test d'atomicité modifie une valeur numérique juste avant l'écriture imbriquée
en NaN, sans changer la validation métier ni les contraintes SQL. La véritable
contrainte `StepParameterValue_finite_numeric_check` doit être à l'origine d'un
HTTP 500 attendu. Le savepoint est annulé et les nombres d'étapes/valeurs sont
contrôlés avant le rollback général : aucun parent ni paramètre partiel ne reste.
Une nouvelle requête valide doit ensuite réussir. Le défaut n'existe que dans le
client de test ; le code métier n'est pas modifié.

Les nombres de lignes des huit tables métier sont comparés avant/après la suite.
Aucune donnée préexistante n'est supprimée ou utilisée comme fixture modifiable.

## Résultat du 29 octobre 2026

Les 22 tests ont réussi : paramètres NUMBER/TEXT/BOOLEAN, valeur exacte de 65
chiffres, incrément à 30 décimales, accès et refus, opérateur et auteur JWT,
répétitions SUCCESS/FAILURE, ordre chronologique réel et ancienne étape textuelle.
Le défaut SQL et son rollback ont été vérifiés sur PostgreSQL, sans mock SQL.

Un avertissement de dépréciation `pg` concernant les requêtes sur une connexion déjà
occupée est émis par l'interpréteur Prisma et `@prisma/adapter-pg` lors des écritures
imbriquées. Son origine a été vérifiée avec `--trace-deprecation` sur le test de
rollback, qui a de nouveau réussi. Il n'est pas masqué ; une montée vers pg 9 devra
tenir compte de la compatibilité de l'adaptateur. Aucune dépendance n'a été changée.
