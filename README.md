# Projet de suivi des échantillons

Application de suivi et de traçabilité des échantillons dans un laboratoire de microélectronique.

Le rapport présentant les besoins du client, les fonctionnalités retenues et les décisions techniques est disponible dans [RAPPORT.md](RAPPORT.md).

## Fonctionnalités

- Création et consultation des échantillons.
- Enregistrement des étapes de fabrication et de leurs paramètres.
- Consultation de l'historique et correction des étapes avec conservation des révisions.
- Gestion des types d'opérations.
- Recherche d'échantillons par référence et par paramètres numériques.
- Gestion des utilisateurs et des autorisations.
- Abandon et réactivation des échantillons.

## Technologies utilisées

- **Backend :** NestJS, TypeScript, Prisma
- **Frontend :** React, TypeScript, Vite
- **Base de données :** PostgreSQL
- **Authentification :** JWT
- **Conteneurisation :** Docker Compose

## Installation et démarrage

### Prérequis

- Docker et Docker Compose
- Node.js et npm pour un lancement sans Docker

### Démarrage avec Docker

À la racine du projet, configurer le fichier `.env` à partir de `.env.example`, notamment `POSTGRES_PASSWORD` et `JWT_SECRET`.

Si un fichier `.env` existe déjà, conserver ses valeurs et compléter uniquement les variables manquantes.

Lancer ensuite :

```bash
docker compose up --build
```

L'application est accessible aux adresses suivantes :

- Frontend : http://localhost:8080
- Backend : http://localhost:3000

Les migrations de la base de données sont appliquées au démarrage par le service prévu à cet effet.

### Démarrage en développement

Pour le backend, après avoir configuré `backend/.env` et démarré PostgreSQL :

```bash
cd backend
npm ci
npm run db:generate
npm run start:dev
```

La base doit avoir reçu les migrations nécessaires avant d'utiliser l'application.

Pour le frontend, dans un autre terminal :

```bash
cd frontend
npm ci
npm run dev
```

Le frontend est alors accessible sur http://localhost:5173.

## Tests

Les tests du backend peuvent être lancés avec :

```bash
cd backend
npm test
npm run test:e2e
```

Pour le frontend :

```bash
cd frontend
npm test
```

Les tests d'intégration utilisant une vraie base PostgreSQL sont séparés et nécessitent une base de test dédiée.

## Documentation complémentaire

- [Authentification et utilisateurs](backend/AUTH.md)
- [Étapes de fabrication](backend/FABRICATION.md)
- [Documentation du frontend](frontend/README.md)