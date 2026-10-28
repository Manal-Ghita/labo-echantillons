# Les échantillons du labo

- Backend NestJS/TypeScript dans `backend`, Prisma 7.10.1 et PostgreSQL.
- Vérifications dans `backend` : `npm run db:generate`, `npm run build`, `npm test -- --runInBand`, `npm run lint`.
- Tests e2e simulés : `npm run test:e2e -- --runInBand`.
- Ne jamais afficher ou versionner `.env`, mots de passe ou clés JWT.
- Toute migration ou écriture sur des données réelles exige une autorisation explicite.
- Ne jamais utiliser `prisma migrate reset` ni `docker compose down -v`.
- `npm run test:postgres` exige un accord et une base dédiée vide ; voir `backend/AUTH.md`.
- Ne pas rédiger ni corriger les rapports universitaires.
