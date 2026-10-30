# Rapport de rédaction

## 1. Compréhension du besoin client

### Besoin initial

Karim est doctorant dans un centre de microélectronique. Le problème qu'il rencontre est que lors de la fabrication des échantillons, chaque chercheur enregistre les étapes dans son propre cahier. Il n'existe pas de formulaire commun ni de normes pour enregistrer ces informations.

Certains chercheurs notent les détails des expériences tandis que d'autres se contentent d'indications comme faire comme d'habitude. Cela devient problématique lorsqu'il faut retrouver des informations plusieurs mois plus tard, notamment si la personne concernée a quitté le laboratoire.

Karim souhaite maintenant exploiter ces données pour sa thèse de doctorat, mais il n'arrive pas à retrouver un historique clair pour les échantillons. Il nous a donc demandé de développer une application permettant principalement de gérer les échantillons et leur historique de fabrication.

### Précisions apportées après les échanges avec Karim

L'échange sur GitHub avec Karim nous a permis de mieux comprendre le fonctionnement de l'application.

Par exemple, la première spécification que nous avons pu distinguer est que les étapes ne suivent pas toujours le même ordre et qu'une même opération peut revenir plusieurs fois lors de la réalisation d'un échantillon. Nous ne pouvions donc pas imposer un parcours fixe.

Un autre point qui a été clarifié est que chaque type d'opération possède ses propres paramètres (température, durée, etc.). L'exemple fourni par Karim, qui souhaitait pouvoir retrouver tous les échantillons recuits à 150 °C, nous a amenés à retenir la recherche par paramètres comme fonctionnalité, et pas seulement la recherche par référence.

Discussion GitHub : [Échanges avec Karim](https://github.com/gaetanmaisse/ismin-web-2026-tps/discussions/19)

## 2. Fonctionnalités retenues

Nous avons choisi trois fonctionnalités principales.

### Gestion et traçabilité des échantillons

La gestion et la traçabilité des échantillons nous permettent d'abord de créer des échantillons, puis de les consulter. On peut aussi noter et enregistrer les différentes étapes suivies lors de la fabrication de chaque échantillon, ainsi que garder un historique de sa réalisation, tout en ayant la possibilité de corriger une étape déjà enregistrée et de consulter l'historique des corrections apportées.

### Gestion des types d'opérations

Lors de la réalisation d'un échantillon, le processus passe par plusieurs opérations qui peuvent parfois se répéter. Nous avons donc donné au chercheur la possibilité de définir un type d'opération et de le réutiliser chaque fois qu'il en a besoin. Il peut également définir les paramètres associés à ce type d'opération, puis renseigner les informations correspondant aux étapes réellement effectuées.

### Recherche et filtrage des échantillons

Cette fonctionnalité permet à Karim, ou à un autre chercheur, de retrouver les informations concernant la fabrication d'un échantillon, même longtemps après sa réalisation. Il est possible de rechercher les échantillons par référence, par type d'opération, mais aussi par valeur exacte ou par intervalle de valeurs numériques d'un paramètre associé.

Nous avons retenu ces trois fonctionnalités parce qu'elles répondent directement aux besoins de Karim, qui sont premièrement d'organiser les informations, mais aussi de faciliter leur recherche afin de rendre les données plus accessibles pour leur exploitation dans sa thèse.

### Fonctionnalités non retenues pour la première version

Pour la première version, nous avons voulu nous concentrer sur ce qui répond directement au problème de Karim, c'est-à-dire enregistrer les étapes, retrouver l'historique d'un échantillon et pouvoir effectuer des recherches.

Des fonctionnalités comme la gestion des photos ou des fichiers de mesures, qui avaient aussi été présentées par Karim, présentent un intérêt réel, mais elles ne sont pas indispensables pour retrouver les paramètres expérimentaux. Elles demanderaient aussi de gérer le stockage des fichiers.

Karim avait aussi proposé la possibilité d'inclure la récupération automatique des données des machines, mais il a lui-même expliqué que chaque machine possède son propre format et qu'une saisie manuelle suffisait pour commencer.

Nous avions aussi envisagé la gestion de plusieurs équipes, mais elle ne correspond pas vraiment aux besoins actuels, puisque le laboratoire ne compte que sept utilisateurs.

Enfin, des idées comme la gestion des lots et la découpe des échantillons restent utiles, mais elles peuvent compliquer davantage la structure de la base de données et la gestion des historiques. Nous avons donc préféré les laisser pour une version future.

## 3. Journal des décisions

| Décision | Choix et justification | Alternative possible | Commit |
|---|---|---|---|
| **Catalogue configurable pour les types d'opérations** | L'administrateur peut définir de nouveaux procédés sans modifier le code ni le schéma de la base de données à chaque fois. | Créer un modèle spécifique pour chaque procédé. | [`9c9e879`](https://github.com/Manal-Ghita/labo-echantillons/commit/9c9e879) |
| **Conservation des corrections dans un historique de révisions** | On garde une trace des modifications tout en conservant l'état actuel, facile à consulter. | Réenregistrer une version complète de l'étape à chaque correction. | [`c5edc20`](https://github.com/Manal-Ghita/labo-echantillons/commit/c5edc20) |
| **Recherche simple par paramètres numériques** | On a opté pour une recherche par paramètres plutôt que pour un constructeur de requêtes complexe. | Développer un système de recherche avancée combinant plusieurs conditions. | [`1b827d3`](https://github.com/Manal-Ghita/labo-echantillons/commit/1b827d3) |
| **Vérification des autorisations dans les services du backend** | Les droits sont contrôlés directement là où les modifications sont exécutées. Comme les règles sont assez simples, notamment le fait que seul le propriétaire ou l'administrateur peut modifier un échantillon, nous n'avons pas eu besoin d'ajouter un système d'autorisation plus complexe. | Mettre en place une politique d'autorisation centralisée. | [`8c5016a`](https://github.com/Manal-Ghita/labo-echantillons/commit/8c5016a)` |
| **Distinction entre la personne qui réalise une opération et celle qui la saisit** | On conserve les deux identités en réutilisant les comptes utilisateurs existants. | Créer un registre indépendant des opérateurs. | [`8c5016a`](https://github.com/Manal-Ghita/labo-echantillons/commit/8c5016a)` |
| **Stockage direct du statut de chaque échantillon** | Cela simplifie la gestion de l'abandon et de la réactivation. Le statut est directement disponible lorsqu'on consulte l'échantillon, sans avoir à parcourir les événements précédents pour le retrouver. | Reconstruire le statut à partir d'un journal d'événements. | [`5c53000`](https://github.com/Manal-Ghita/labo-echantillons/commit/5c53000) |
| **Tests HTTP avec simulation des dépendances** | On peut vérifier les comportements métier sans avoir à lancer une véritable base PostgreSQL pour chaque test. | Effectuer principalement des tests avec une base PostgreSQL temporaire. | [`d8720d1`](https://github.com/Manal-Ghita/labo-echantillons/commit/d8720d1) |

## 4. Proposition de l'IA rejetée

Lors de nos échanges avec l'IA, plusieurs propositions n'ont pas été retenues. L'une d'elles était une architecture d'opérations partagées par lot, proposée par Claude :

> « L’unité de saisie devient l’opération, appliquée à un groupe d’échantillons. »

Cette proposition permet d'enregistrer une opération sur plusieurs échantillons en même temps.

Par exemple, si Karim réalise le même recuit sur 20 échantillons, il peut l'enregistrer une seule fois au lieu de vingt. L'idée est intéressante, puisque Karim travaille souvent sur des lots et que cela pourrait lui faire gagner du temps.

Mais en regardant de plus près, nous avons pensé que cette architecture pouvait poser plusieurs problèmes. Même si l'opération est identique, le résultat peut varier d'un échantillon à un autre, puisqu'un échantillon peut échouer alors que les autres réussissent.

De plus, si nous voulons corriger une information sur un seul échantillon, il faut que cela ne touche pas les dix-neuf autres. Cette solution demande aussi des relations plus complexes dans la base de données, ainsi qu'une interface permettant de sélectionner les échantillons et de consulter les résultats de chacun.

Pour la V1, nous avons donc préféré conserver un historique individuel par échantillon, plus simple à gérer, et garder les opérations partagées pour une version suivante.