# Activation des comptes — vérifications avant déploiement

La migration `20261030000000_user_activation` est additive et n'est pas appliquée
par les tests ordinaires. Elle ajoute `isActive`, `authVersion` et un CHECK positif
ou nul. Ne pas démarrer la nouvelle API sur une base non migrée.

Les tests unitaires et HTTP utilisent Prisma simulé. Les tests navigateur utilisent
une API simulée : aucune création ou modification PostgreSQL.

## Concurrence réelle

`user-status-concurrency.cjs` utilise deux clients Prisma avec deux connexions
indépendantes, le vrai UsersService et des transactions Serializable. Une barrière
fait compter les deux ADMIN actifs avant les modifications concurrentes.
Une opération doit réussir, l'autre renvoyer 409, et un ADMIN actif doit rester.

Ce scénario ne peut pas utiliser le client transactionnel partagé du scénario
fonctionnel navigateur : il sérialise les requêtes et ses fixtures non validées
ne sont pas visibles depuis deux connexions distinctes.

Avant toute exécution, obtenir l'autorisation pour une **nouvelle base vide** dont
le nom suit `labo_echantillons_*concurrency_test`, pour l'application de ses trois
migrations et pour ses fixtures synthétiques validées. Le script refuse la base
principale, `labo_echantillons_test`, tout contenu métier préexistant et toute
migration manquante. Il n'applique aucune migration lui-même.
Par défaut le schéma ciblé est `public`. Pour conserver les fixtures d'un essai
échoué, `TEST_SCHEMA=concurrency_retry_N` permet un nouvel essai dans un schéma
vide de la même base isolée, après application autorisée des migrations dans ce
schéma. La vérification d'absence de données concerne le schéma ciblé ; aucun
schéma antérieur n'est supprimé ou réinitialisé.

Après compilation du backend, renseigner seulement dans l'environnement du
terminal `TEST_DATABASE_URL` et `ALLOW_CONCURRENCY_FIXTURES=new-empty-database`, puis
exécuter depuis `backend` :

```sh
node test/user-status-concurrency.cjs
```

Ne pas afficher l'URL ni la conserver dans Git ; retirer ces variables ensuite.
Les deux utilisateurs fictifs restent dans cette base dédiée pour inspection,
y compris après un échec. Le script ne supprime et ne réinitialise rien. Une nouvelle
exécution exige une nouvelle base vide ; ne pas effacer une base pour contourner
ce contrôle. Les clients sont fermés dans `finally`.

## Migration et contrôle PostgreSQL à autoriser séparément

Avant la base principale : vérifier le SQL sur une base dédiée, la compatibilité
des utilisateurs et relations historiques, les valeurs par défaut et le refus
du CHECK négatif, puis les révocations réelles avant/après réactivation.
Les tests d'écriture nécessitent une autorisation et un dispositif d'isolation
explicites.

La migration principale, sa sauvegarde préalable et le déploiement sont des
opérations séparées. Les JWT précédents sans version seront refusés ; tous les
utilisateurs devront se reconnecter après le déploiement.

## Vérification réelle autorisée du 30 octobre 2026

Base créée : `labo_echantillons_a08ad9b07_concurrency_test`, sur le conteneur et
volume existants, avec un rôle non-superutilisateur propre à cette base et sans
droits d'écriture sur les tables ou le schéma de `labo_echantillons`.
Aucun identifiant secret n'est conservé dans les fichiers de test.

- Schéma `migration_compat` : deux premières migrations, fixtures historiques,
  puis migration d'activation. Empreintes des huit tables métier inchangées en
  excluant uniquement les deux nouveaux champs User ; UUID et relations conservés.
- Défauts `isActive=true`, `authVersion=0` vérifiés sur utilisateurs existants et
  nouvellement créés. CHECK négatif rejeté avec SQLSTATE 23514, puis rollback.
- Trois migrations et leurs checksums vérifiés ; aucune migration principale.
- Vrais appels HTTP NestJS, bcrypt et Prisma : permissions ADMIN/RESEARCHER,
  auto-désactivation refusée, révocation, réactivation et nouvelle connexion,
  anciennes sessions refusées, version idempotente, projections et opérateurs.
- Échantillon, étape textuelle ancienne et journal de corrections conservés.
- Première concurrence : l'invariant était respecté, mais l'erreur de commit
  `DriverAdapterError` n'était pas traduite en 409. `adapter-pg` peut renvoyer
  `cause.kind=TransactionWriteConflict` avec SQLSTATE 40001/40P01 directement,
  au lieu de P2034. Correction limitée au service utilisateurs et tests ajoutés.
- Reprise dans `concurrency_retry_2` : deux connexions indépendantes, une opération
  validée, une réponse 409, exactement un ADMIN actif. Les schémas des essais
  précédents et leurs fixtures sont conservés pour inspection.
- Les neuf empreintes de la base principale et les identités/états/montages des
  quatre conteneurs sont inchangés. Volume d'origine conservé, sans recréation.

Les tests HTTP ont utilisé une application NestJS locale au processus de test,
sans déploiement des services Docker ni utilisation des ports applicatifs de
production. La base et les fixtures isolées sont conservées ; aucune suppression.
