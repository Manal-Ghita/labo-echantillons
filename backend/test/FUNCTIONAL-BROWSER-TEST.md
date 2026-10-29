# Validation fonctionnelle réelle — exécution isolée

Exécution toujours soumise à une autorisation explicite. Ce document ne lance rien.
Les tests navigateur ordinaires restent simulés et ne se connectent pas à PostgreSQL.

## Isolation

- Conserver les conteneurs Docker actuels sans reconstruction, redémarrage ou changement de configuration.
- Lancer une instance du vrai AppModule NestJS sur `localhost:3100` et le vrai frontend Vite sur `localhost:5180`.
- Fournir uniquement aux processus de test `VITE_API_URL=http://localhost:3100`,
  `WEB_ORIGIN=http://localhost:5180`, un JWT_SECRET aléatoire et une connexion
  explicitement construite pour `labo_echantillons_test`. Aucun repli sur DATABASE_URL de développement.
- Vérifier le nom dans l'URL puis avec `SELECT current_database()` avant toute fixture.
- Refuser une migration manquante, échouée ou différente des SQL versionnés. Ne pas appliquer de migration.
- Bloquer les accès navigateur aux ports applicatifs principaux 3000/8080 ; n'utiliser aucune réponse HTTP simulée.

## Transaction et données existantes

Le backend de test injectera le client Prisma d'une transaction SERIALIZABLE
englobante dans PrismaService. Les services, DTO, guards JWT et mots de passe bcrypt
resteront réels. Adapter les transactions du service de fabrication avec des savepoints,
comme dans `fabrication-steps.postgres-spec.ts`, et sérialiser les requêtes partageant
la connexion. Prévoir également des savepoints pour les requêtes provoquant une erreur SQL attendue.

Les comptes sont des fixtures nouvelles : propriétaire RESEARCHER,
autre RESEARCHER/opérateur, ADMIN et un RESEARCHER supplémentaire créé via
l'interface ADMIN pour vérifier le provisionnement et sa connexion réelle.
Identifiants uniques et mots de passe aléatoires
en mémoire, sans trace réseau contenant les secrets ni fichier de credentials.
Le catalogue sera créé via son API ADMIN ; les échantillons et étapes ordinaires
via l'interface. L'échantillon abandonné et l'étape textuelle ancienne seront des
fixtures Prisma nouvelles, car aucun formulaire ne les crée dans cet état.

Avant les fixtures, relever les nombres de lignes et empreintes des huit tables métier
et de `_prisma_migrations`, exclusivement dans la base de test. Ne pas afficher les lignes ni empreintes de mots de passe.
Après les scénarios, fermer les processus de test, annuler la transaction, vérifier
l'absence des identifiants créés et l'identité du relevé avant/après.
Le bloc finally doit fonctionner après une assertion échouée. La déconnexion
PostgreSQL annule également une transaction non validée après un arrêt du processus.
Ne jamais tenter de DELETE/TRUNCATE ou de réinitialisation comme solution de secours.

## Parcours

1. Connexion depuis React, récupération du profil et création d'un échantillon.
2. Sélection d'un type actif, NUMBER de forte précision, TEXT, BOOLEAN true et false,
   unités, observations, date locale convertie en ISO, auteur JWT et opérateur distinct.
3. SUCCESS puis FAILURE, répétition d'opération et ordre chronologique indépendant de l'ordre de saisie.
4. Actualisation de l'historique, relecture SQL exacte des décimaux et compatibilité des paramètres anciens.
5. Autre chercheur : lecture autorisée, absence de formulaire, POST direct 403.
6. ADMIN : ajout sur l'échantillon d'autrui. Échantillon abandonné : ajout refusé 409 pour propriétaire et ADMIN.
7. Absence de JWT, corps falsifié, paramètres inconnus/manquants/dupliqués/invalides : refus sans étape partielle.
8. Exécuter les parcours desktop et mobile dans des transactions distinctes et bornées dans le temps.
9. Création contrôlée d'un RESEARCHER par ADMIN, connexion de ce compte et refus de l'administration à RESEARCHER.
10. Correction depuis React, motif et auteur JWT, snapshots avant/après avec décimaux exacts,
    conflit de révision et panne SQL du journal annulant la correction entière.
11. Recherche numérique inclusive depuis React, filtre vide et recherche SQL excluant les anciennes valeurs du journal.
12. Abandon puis réactivation depuis React, confirmation, contrôle de propriété et historique conservé.

## Limite et autorisation

Il s'agit d'une validation fonctionnelle avec vrai SQL et vrai HTTP, mais l'injection
transactionnelle de test diffère du pool de connexions normal de production.
La construction et le fonctionnement Docker ordinaires sont vérifiés séparément.
L'orchestrateur `run-functional-browser.cjs` reste séparé des scripts npm ordinaires
et du démarrage Docker. Après autorisation, depuis la racine :

```powershell
npm.cmd --prefix backend run build
node backend/test/run-functional-browser.cjs --allow-test-writes
```

Le drapeau ne remplace pas l'autorisation de l'utilisateur. Sans lui, le programme
refuse de démarrer. Les seules écritures sont les fixtures non validées de la base
de test ; chaque scénario desktop/mobile lève obligatoirement un signal de rollback.
Les requêtes HTTP annulées sont observées dès leur arrivée, avant la file d'attente,
et le nettoyage des processus est borné pour éviter un blocage de l'orchestrateur.

Vérification volontaire du chemin d'échec, également après autorisation :

```powershell
node backend/test/run-functional-browser.cjs --allow-test-writes --verify-failure-cleanup
```

Cette commande doit retourner **1**, avec l'erreur volontaire et le message
`CLEANUP VERIFIED`. Elle crée les fixtures dans une transaction, provoque une panne
après le lancement des processus de test, puis vérifie le rollback et leur fermeture.

Résultat de validation : 27 points de contrôle réussis pour les parcours desktop
et mobile, empreintes des neuf tables identiques après rollback, comptes temporaires
absents, ports 3100/5180 libérés et identités des conteneurs Docker inchangées.
Le scénario de panne volontaire a également confirmé le nettoyage.

Un avertissement de dépréciation `pg` sur la mise en file de requêtes apparaît dans
`@prisma/adapter-pg` pendant certaines écritures imbriquées. Il ne fait pas échouer
les contrôles SQL ou les rollbacks avec les versions verrouillées. Ne pas masquer
cet avertissement ni mettre à jour les dépendances automatiquement.
