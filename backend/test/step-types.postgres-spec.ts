import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { PasswordService } from '../src/auth/password.service';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { StepTypesModule } from '../src/step-types/step-types.module';

type Context = {
  app: INestApplication;
  tx: Prisma.TransactionClient;
  adminToken: string;
  researcherToken: string;
  researcherId: string;
};

describe('Catalogue HTTP / PostgreSQL réel dédié, transactions annulées', () => {
  let prisma: PrismaClient;
  let passwordHash: string;
  let before: unknown;
  const password = randomUUID();
  const oldSecret = process.env.JWT_SECRET;

  const counts = () => prisma.$queryRaw`
    SELECT (SELECT count(*) FROM "User")::text AS users,
      (SELECT count(*) FROM "Sample")::text AS samples,
      (SELECT count(*) FROM "FabricationStep")::text AS steps,
      (SELECT count(*) FROM "Batch")::text AS batches,
      (SELECT count(*) FROM "StepType")::text AS types,
      (SELECT count(*) FROM "ParameterDefinition")::text AS definitions,
      (SELECT count(*) FROM "StepParameterValue")::text AS values,
      (SELECT count(*) FROM "StepCorrection")::text AS corrections`;

  beforeAll(async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    if (!connectionString)
      throw new Error('TEST_DATABASE_URL obligatoire, aucun repli.');
    let url: URL;
    try {
      url = new URL(connectionString);
    } catch {
      throw new Error('URL de test invalide (valeur masquée).');
    }
    if (
      decodeURIComponent(url.pathname.slice(1)) !== 'labo_echantillons_test' ||
      ![null, 'public'].includes(url.searchParams.get('schema'))
    ) {
      throw new Error(
        'Cible autorisée exclusivement : labo_echantillons_test, schéma public.',
      );
    }
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        connectionTimeoutMillis: 5000,
      }),
    });
    await prisma.$connect();
    const database = await prisma.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    expect(database[0].name).toBe('labo_echantillons_test');
    const migrations = await prisma.$queryRaw<
      {
        migration_name: string;
        checksum: string;
        finished: boolean;
        not_rolled_back: boolean;
      }[]
    >`
      SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,
        rolled_back_at IS NULL AS not_rolled_back FROM "_prisma_migrations" ORDER BY migration_name`;
    expect(migrations.map((row) => row.migration_name)).toEqual([
      '20261028000000_init',
      '20261029000000_fabrication_structure',
    ]);
    for (const migration of migrations) {
      expect(migration.finished && migration.not_rolled_back).toBe(true);
      const source = readFileSync(
        resolve(
          __dirname,
          '../prisma/migrations',
          migration.migration_name,
          'migration.sql',
        ),
      );
      expect(migration.checksum).toBe(
        createHash('sha256').update(source).digest('hex'),
      );
    }
    before = await counts();
    passwordHash = await new PasswordService().hash(password);
    process.env.JWT_SECRET = randomBytes(48).toString('base64');
  });

  afterAll(async () => {
    try {
      if (prisma && before) expect(await counts()).toEqual(before);
    } finally {
      if (prisma) await prisma.$disconnect();
      if (oldSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = oldSecret;
    }
  });

  async function withApi(check: (context: Context) => Promise<void>) {
    const rollback = new Error('Rollback integration fixtures');
    try {
      await prisma.$transaction(
        async (tx) => {
          let app: INestApplication | undefined;
          try {
            const admin = await tx.user.create({
              data: {
                name: 'Catalogue test ADMIN',
                email: `catalogue-admin-${randomUUID()}@example.test`,
                passwordHash,
                role: 'ADMIN',
              },
            });
            const researcher = await tx.user.create({
              data: {
                name: 'Catalogue test RESEARCHER',
                email: `catalogue-researcher-${randomUUID()}@example.test`,
                passwordHash,
                role: 'RESEARCHER',
              },
            });
            // Inject the real transaction client, not mocked delegates: guards and
            // services execute SQL on this same connection and see the fixtures.
            const module = await Test.createTestingModule({
              imports: [StepTypesModule],
            })
              .overrideProvider(PrismaService)
              .useValue(tx)
              .compile();
            app = module.createNestApplication();
            await app.init();
            const adminLogin = await request(app.getHttpServer())
              .post('/auth/login')
              .send({ email: admin.email, password })
              .expect(200);
            const researcherLogin = await request(app.getHttpServer())
              .post('/auth/login')
              .send({ email: researcher.email, password })
              .expect(200);
            await check({
              app,
              tx,
              adminToken: adminLogin.body.access_token as string,
              researcherToken: researcherLogin.body.access_token as string,
              researcherId: researcher.id,
            });
          } finally {
            if (app) await app.close();
          }
          throw rollback;
        },
        { timeout: 45000 },
      );
      throw new Error(
        'La transaction de test a été validée au lieu d’être annulée.',
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  const payload = () => ({
    code: `INTEGRATION-${randomUUID()}`,
    name: 'Dépôt intégration',
    description: 'Données de test uniquement',
    parameters: [
      {
        key: 'temperature',
        name: 'Température',
        dataType: 'NUMBER',
        unit: '°C',
        isRequired: true,
      },
      {
        key: 'atmosphere',
        name: 'Atmosphère',
        dataType: 'TEXT',
        isRequired: false,
      },
      { key: 'vacuum', name: 'Vide', dataType: 'BOOLEAN', isRequired: true },
    ],
  });

  async function createType(context: Context) {
    const body = payload();
    const response = await request(context.app.getHttpServer())
      .post('/step-types')
      .auth(context.adminToken, { type: 'bearer' })
      .send(body)
      .expect(201);
    return {
      body,
      id: response.body.id as string,
      parameters: response.body.parameters as {
        id: string;
        key: string;
        dataType: string;
      }[],
    };
  }

  it('vérifie la création atomique, les trois types de paramètres et leurs liens PostgreSQL', async () => {
    await withApi(async (context) => {
      const created = await createType(context);
      const stored = await context.tx.stepType.findUniqueOrThrow({
        where: { id: created.id },
        include: { parameters: { orderBy: { key: 'asc' } } },
      });
      expect(stored).toMatchObject({
        code: created.body.code,
        name: created.body.name,
        isActive: true,
      });
      expect(stored.parameters).toHaveLength(3);
      for (const parameter of created.body.parameters) {
        expect(stored.parameters).toContainEqual(
          expect.objectContaining({ ...parameter, stepTypeId: stored.id }),
        );
      }
      expect(
        stored.parameters.every(
          (parameter) => parameter.stepTypeId === stored.id,
        ),
      ).toBe(true);
    });
  });

  it('consulte le catalogue et ses définitions avec ADMIN et RESEARCHER', async () => {
    await withApi(async (context) => {
      const created = await createType(context);
      for (const token of [context.adminToken, context.researcherToken]) {
        const list = await request(context.app.getHttpServer())
          .get('/step-types')
          .auth(token, { type: 'bearer' })
          .expect(200);
        const listed = (
          list.body as { id: string; parameters: unknown[] }[]
        ).find((type) => type.id === created.id);
        expect(listed?.parameters).toHaveLength(3);
        const detail = await request(context.app.getHttpServer())
          .get('/step-types/' + created.id)
          .auth(token, { type: 'bearer' })
          .expect(200);
        expect(detail.body.parameters).toHaveLength(3);
      }
    });
  });

  it('refuse sans JWT et refuse création/modification par RESEARCHER', async () => {
    await withApi(async (context) => {
      const created = await createType(context);
      const count = await context.tx.stepType.count();
      await request(context.app.getHttpServer()).get('/step-types').expect(401);
      await request(context.app.getHttpServer())
        .post('/step-types')
        .send(payload())
        .expect(401);
      await request(context.app.getHttpServer())
        .post('/step-types')
        .auth(context.researcherToken, { type: 'bearer' })
        .send(payload())
        .expect(403);
      await request(context.app.getHttpServer())
        .patch('/step-types/' + created.id)
        .auth(context.researcherToken, { type: 'bearer' })
        .send({ isActive: false })
        .expect(403);
      await request(context.app.getHttpServer())
        .get('/step-types?includeInactive=true')
        .auth(context.researcherToken, { type: 'bearer' })
        .expect(403);
      expect(await context.tx.stepType.count()).toBe(count);
      expect(
        (
          await context.tx.stepType.findUniqueOrThrow({
            where: { id: created.id },
          })
        ).isActive,
      ).toBe(true);
    });
  });

  it('désactive/réactive avec ADMIN sans perdre les paramètres, avec visibilité adaptée', async () => {
    await withApi(async (context) => {
      const created = await createType(context);
      const parameters = await context.tx.parameterDefinition.findMany({
        where: { stepTypeId: created.id },
        orderBy: { key: 'asc' },
      });
      await request(context.app.getHttpServer())
        .patch('/step-types/' + created.id)
        .auth(context.adminToken, { type: 'bearer' })
        .send({ name: 'Libellé corrigé', description: null, isActive: false })
        .expect(200);
      await request(context.app.getHttpServer())
        .get('/step-types/' + created.id)
        .auth(context.researcherToken, { type: 'bearer' })
        .expect(404);
      const list = await request(context.app.getHttpServer())
        .get('/step-types')
        .auth(context.researcherToken, { type: 'bearer' })
        .expect(200);
      expect(
        (list.body as { id: string }[]).some((type) => type.id === created.id),
      ).toBe(false);
      const adminList = await request(context.app.getHttpServer())
        .get('/step-types?includeInactive=true')
        .auth(context.adminToken, { type: 'bearer' })
        .expect(200);
      expect(
        (adminList.body as { id: string }[]).some(
          (type) => type.id === created.id,
        ),
      ).toBe(true);
      await request(context.app.getHttpServer())
        .get('/step-types/' + created.id)
        .auth(context.adminToken, { type: 'bearer' })
        .expect(200);
      await request(context.app.getHttpServer())
        .patch('/step-types/' + created.id)
        .auth(context.adminToken, { type: 'bearer' })
        .send({ isActive: true })
        .expect(200);
      await request(context.app.getHttpServer())
        .get('/step-types/' + created.id)
        .auth(context.researcherToken, { type: 'bearer' })
        .expect(200);
      expect(
        await context.tx.parameterDefinition.findMany({
          where: { stepTypeId: created.id },
          orderBy: { key: 'asc' },
        }),
      ).toEqual(parameters);
    });
  });

  it('retourne 409 sur le vrai conflit PostgreSQL sans type ou paramètre orphelin', async () => {
    await withApi(async (context) => {
      const created = await createType(context);
      const types = await context.tx.stepType.count();
      const definitions = await context.tx.parameterDefinition.count();
      // PostgreSQL aborts the statement's transaction after a unique violation.
      // Restore this savepoint before inspecting the same test transaction.
      await context.tx.$executeRawUnsafe('SAVEPOINT duplicate_code_probe');
      try {
        await request(context.app.getHttpServer())
          .post('/step-types')
          .auth(context.adminToken, { type: 'bearer' })
          .send(created.body)
          .expect(409);
      } finally {
        await context.tx.$executeRawUnsafe(
          'ROLLBACK TO SAVEPOINT duplicate_code_probe',
        );
        await context.tx.$executeRawUnsafe(
          'RELEASE SAVEPOINT duplicate_code_probe',
        );
      }
      expect(await context.tx.stepType.count()).toBe(types);
      expect(await context.tx.parameterDefinition.count()).toBe(definitions);
    });
  });

  it('refuse les clés dupliquées et les types invalides avant toute écriture', async () => {
    await withApi(async (context) => {
      const types = await context.tx.stepType.count();
      const duplicate = payload();
      duplicate.parameters.push({
        ...duplicate.parameters[0],
        key: ' temperature ',
      });
      await request(context.app.getHttpServer())
        .post('/step-types')
        .auth(context.adminToken, { type: 'bearer' })
        .send(duplicate)
        .expect(400);
      const invalid = payload();
      invalid.parameters[0].dataType = 'FLOAT';
      await request(context.app.getHttpServer())
        .post('/step-types')
        .auth(context.adminToken, { type: 'bearer' })
        .send(invalid)
        .expect(400);
      expect(await context.tx.stepType.count()).toBe(types);
    });
  });

  it('protège des définitions réellement utilisées et ne supprime aucun historique', async () => {
    await withApi(async (context) => {
      const created = await createType(context);
      const sample = await context.tx.sample.create({
        data: {
          reference: `CATALOGUE-${randomUUID()}`,
          name: 'Échantillon fictif',
          creatorId: context.researcherId,
          status: 'ACTIVE',
        },
      });
      const step = await context.tx.fabricationStep.create({
        data: {
          sampleId: sample.id,
          stepTypeId: created.id,
          operationName: created.body.name,
          performedAt: new Date(),
          recordedById: context.researcherId,
          result: 'SUCCESS',
          parameterValues: {
            create: created.parameters.map((definition) => ({
              definitionId: definition.id,
              ...(definition.dataType === 'NUMBER'
                ? { numericValue: '120' }
                : definition.dataType === 'TEXT'
                  ? { textValue: 'argon' }
                  : { booleanValue: false }),
            })),
          },
        },
      });
      const parameters = await context.tx.parameterDefinition.findMany({
        where: { stepTypeId: created.id },
        orderBy: { key: 'asc' },
      });
      for (const change of [
        { dataType: 'TEXT' },
        { unit: 'K' },
        { key: 'new_key' },
        { name: 'Nouvelle signification' },
      ]) {
        await request(context.app.getHttpServer())
          .patch('/step-types/' + created.id)
          .auth(context.adminToken, { type: 'bearer' })
          .send({ parameters: [{ ...created.body.parameters[0], ...change }] })
          .expect(400);
      }
      await request(context.app.getHttpServer())
        .delete('/step-types/' + created.id)
        .auth(context.adminToken, { type: 'bearer' })
        .expect(404);
      await request(context.app.getHttpServer())
        .patch('/step-types/' + created.id)
        .auth(context.adminToken, { type: 'bearer' })
        .send({ name: 'Libellé descriptif', isActive: false })
        .expect(200);
      expect(
        await context.tx.parameterDefinition.findMany({
          where: { stepTypeId: created.id },
          orderBy: { key: 'asc' },
        }),
      ).toEqual(parameters);
      expect(
        (
          await context.tx.fabricationStep.findUniqueOrThrow({
            where: { id: step.id },
          })
        ).operationName,
      ).toBe(created.body.name);
      expect(
        await context.tx.stepParameterValue.count({
          where: { stepId: step.id },
        }),
      ).toBe(3);
    });
  });
});
