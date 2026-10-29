import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { PasswordService } from '../src/auth/password.service';
import { FabricationStepsModule } from '../src/fabrication-steps/fabrication-steps.module';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

type Fault = { nextParameterWrite: boolean; error?: unknown };
type Context = {
  app: INestApplication;
  tx: Prisma.TransactionClient;
  ids: {
    owner: string;
    admin: string;
    other: string;
    operator: string;
    sample: string;
    abandoned: string;
    type: string;
    inactive: string;
    foreignDefinition: string;
    number: string;
    text: string;
    boolean: string;
  };
  tokens: { owner: string; admin: string; other: string };
  fault: Fault;
};
const precise =
  '12345678901234567890123456789012345.123456789012345678901234567891';

describe('Fabrication HTTP / PostgreSQL réel, savepoints et rollback intégral', () => {
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
      throw new Error(
        'TEST_DATABASE_URL obligatoire, aucun repli sur la base principale.',
      );
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
        'Seule labo_echantillons_test, schéma public, est autorisée.',
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

  // Real SQL delegates, with a test-only nested-transaction adapter. Each HTTP
  // request gets its own savepoint inside the already SERIALIZABLE transaction.
  function transactionClient(tx: Prisma.TransactionClient, fault: Fault) {
    let number = 0;
    let scoped: Prisma.TransactionClient;
    const nested = async <T>(
      work: (client: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) => {
      if (options?.isolationLevel !== 'Serializable')
        throw new Error('Isolation du service différente de celle du test.');
      const name = `fabrication_request_${++number}`;
      await tx.$executeRawUnsafe(`SAVEPOINT "${name}"`);
      try {
        const result = await work(scoped);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${name}"`);
        return result;
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${name}"`);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${name}"`);
        throw error;
      }
    };
    const steps = new Proxy(tx.fabricationStep, {
      get(target, property) {
        if (property !== 'create') return Reflect.get(target, property, target);
        return async (args: Prisma.FabricationStepCreateArgs) => {
          if (!fault.nextParameterWrite) return tx.fabricationStep.create(args);
          fault.nextParameterWrite = false;
          const values = args.data.parameterValues?.create;
          if (!Array.isArray(values))
            throw new Error(
              'Écriture imbriquée attendue pour injecter le défaut.',
            );
          const index = values.findIndex(
            (value) => value.numericValue !== undefined,
          );
          if (index < 0)
            throw new Error('Paramètre numérique attendu pour le défaut SQL.');
          const corrupted: Prisma.StepParameterValueUncheckedCreateWithoutStepInput[] =
            values.map((value, position) => {
              if (!('definitionId' in value))
                throw new Error(
                  'Définition par identifiant attendue dans ce test.',
                );
              return position === index
                ? { ...value, numericValue: new Prisma.Decimal('NaN') }
                : value;
            });
          try {
            return await tx.fabricationStep.create({
              ...args,
              data: { ...args.data, parameterValues: { create: corrupted } },
            });
          } catch (error) {
            fault.error = error;
            throw error;
          }
        };
      },
    });
    scoped = new Proxy(tx, {
      get(target, property) {
        if (property === '$transaction') return nested;
        if (property === 'fabricationStep') return steps;
        return Reflect.get(target, property, target);
      },
    });
    return scoped;
  }

  async function withApi(check: (context: Context) => Promise<void>) {
    const rollback = new Error('Rollback fabrication fixtures');
    try {
      await prisma.$transaction(
        async (tx) => {
          let app: INestApplication | undefined;
          try {
            const owner = await tx.user.create({
              data: {
                name: 'Owner test',
                email: `steps-owner-${randomUUID()}@example.test`,
                passwordHash,
                role: 'RESEARCHER',
              },
            });
            const admin = await tx.user.create({
              data: {
                name: 'Admin test',
                email: `steps-admin-${randomUUID()}@example.test`,
                passwordHash,
                role: 'ADMIN',
              },
            });
            const other = await tx.user.create({
              data: {
                name: 'Other test',
                email: `steps-other-${randomUUID()}@example.test`,
                passwordHash,
                role: 'RESEARCHER',
              },
            });
            const operator = await tx.user.create({
              data: {
                name: 'Operator test',
                email: `steps-operator-${randomUUID()}@example.test`,
                passwordHash,
                role: 'RESEARCHER',
              },
            });
            const sample = await tx.sample.create({
              data: {
                reference: `STEPS-${randomUUID()}`,
                name: 'Sample test',
                creatorId: owner.id,
                status: 'ACTIVE',
              },
            });
            const abandoned = await tx.sample.create({
              data: {
                reference: `ABANDONED-${randomUUID()}`,
                name: 'Abandoned test',
                creatorId: owner.id,
                status: 'ABANDONED',
              },
            });
            const type = await tx.stepType.create({
              data: {
                code: `STEPS-${randomUUID()}`,
                name: 'Operation test',
                parameters: {
                  create: [
                    {
                      key: 'temperature',
                      name: 'Temperature',
                      dataType: 'NUMBER',
                      unit: 'C',
                      isRequired: true,
                    },
                    {
                      key: 'atmosphere',
                      name: 'Atmosphere',
                      dataType: 'TEXT',
                      isRequired: false,
                    },
                    {
                      key: 'vacuum',
                      name: 'Vacuum',
                      dataType: 'BOOLEAN',
                      isRequired: true,
                    },
                  ],
                },
              },
              include: { parameters: true },
            });
            const inactive = await tx.stepType.create({
              data: {
                code: `INACTIVE-${randomUUID()}`,
                name: 'Inactive test',
                isActive: false,
              },
            });
            const foreign = await tx.stepType.create({
              data: {
                code: `FOREIGN-${randomUUID()}`,
                name: 'Foreign type',
                parameters: {
                  create: {
                    key: 'foreign',
                    name: 'Foreign',
                    dataType: 'NUMBER',
                    isRequired: true,
                  },
                },
              },
              include: { parameters: true },
            });
            const ids = {
              owner: owner.id,
              admin: admin.id,
              other: other.id,
              operator: operator.id,
              sample: sample.id,
              abandoned: abandoned.id,
              type: type.id,
              inactive: inactive.id,
              foreignDefinition: foreign.parameters[0].id,
              number: type.parameters.find(
                (definition) => definition.key === 'temperature',
              )!.id,
              text: type.parameters.find(
                (definition) => definition.key === 'atmosphere',
              )!.id,
              boolean: type.parameters.find(
                (definition) => definition.key === 'vacuum',
              )!.id,
            };
            const fault: Fault = { nextParameterWrite: false };
            const module = await Test.createTestingModule({
              imports: [FabricationStepsModule],
            })
              .overrideProvider(PrismaService)
              .useValue(transactionClient(tx, fault))
              .compile();
            // The fault test expects an HTTP 500, whose actual SQL cause is asserted.
            // Disabling the application logger avoids dumping fictional row data.
            app = module.createNestApplication({ logger: false });
            await app.init();
            const tokens = {} as Context['tokens'];
            for (const [key, user] of [
              ['owner', owner],
              ['admin', admin],
              ['other', other],
            ] as const) {
              const login = await request(app.getHttpServer())
                .post('/auth/login')
                .send({ email: user.email, password })
                .expect(200);
              tokens[key] = login.body.access_token as string;
            }
            await check({ app, tx, ids, tokens, fault });
          } finally {
            if (app) await app.close();
          }
          throw rollback;
        },
        { isolationLevel: 'Serializable', timeout: 45000 },
      );
      throw new Error(
        'La transaction de fixtures a été validée au lieu d’être annulée.',
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  const route = (id: string) => `/samples/${id}/steps`;
  const input = (
    context: Context,
  ): {
    stepTypeId: string;
    performedAt: string;
    result: string;
    parameterValues: { definitionId: string; value: unknown }[];
  } => ({
    stepTypeId: context.ids.type,
    performedAt: '2026-10-29T10:30:00+01:00',
    result: 'SUCCESS',
    parameterValues: [
      { definitionId: context.ids.number, value: precise },
      { definitionId: context.ids.text, value: 'argon' },
      { definitionId: context.ids.boolean, value: false },
    ],
  });
  const post = (
    context: Context,
    body: object = input(context),
    token = context.tokens.owner,
    sampleId = context.ids.sample,
  ) =>
    request(context.app.getHttpServer())
      .post(route(sampleId))
      .auth(token, { type: 'bearer' })
      .send(body);

  it.each(['owner', 'admin'] as const)(
    'enregistre NUMBER/TEXT/BOOLEAN pour %s avec décimal exact de 65 chiffres',
    async (role) => {
      await withApi(async (context) => {
        const response = await post(
          context,
          input(context),
          context.tokens[role],
        ).expect(201);
        expect(response.body.recordedById).toBe(context.ids[role]);
        expect(
          response.body.parameterValues.find(
            (value: { definitionId: string }) =>
              value.definitionId === context.ids.number,
          ).numericValue,
        ).toBe(precise);
        const stored = await context.tx.fabricationStep.findUniqueOrThrow({
          where: { id: response.body.id as string },
          include: { parameterValues: true },
        });
        expect(stored.parameterValues).toHaveLength(3);
        expect(stored.recordedById).toBe(context.ids[role]);
        expect(
          stored.parameterValues.find(
            (value) => value.definitionId === context.ids.text,
          )?.textValue,
        ).toBe('argon');
        expect(
          stored.parameterValues.find(
            (value) => value.definitionId === context.ids.boolean,
          )?.booleanValue,
        ).toBe(false);
        const numeric = await context.tx.$queryRaw<
          { value: string }[]
        >`SELECT "numericValue"::text AS value FROM "StepParameterValue" WHERE "stepId"=${stored.id}::uuid AND "definitionId"=${context.ids.number}::uuid`;
        expect(numeric[0].value).toBe(precise);
        expect(stored.operatorId).toBeNull();
      });
    },
  );

  it('conserve aussi le plus petit incrément positif de 30 décimales', async () => {
    await withApi(async (context) => {
      const body = input(context);
      const tiny = '0.' + '0'.repeat(29) + '1';
      body.parameterValues[0].value = tiny;
      const response = await post(context, body).expect(201);
      expect(
        response.body.parameterValues.find(
          (value: { definitionId: string }) =>
            value.definitionId === context.ids.number,
        ).numericValue,
      ).toBe(tiny);
      const history = await request(context.app.getHttpServer())
        .get(route(context.ids.sample))
        .auth(context.tokens.other, { type: 'bearer' })
        .expect(200);
      expect(
        history.body[0].parameterValues.find(
          (value: { definitionId: string }) =>
            value.definitionId === context.ids.number,
        ).numericValue,
      ).toBe(tiny);
    });
  });

  it('refuse sans JWT, avec JWT invalide et pour un autre propriétaire sans écrire', async () => {
    await withApi(async (context) => {
      await request(context.app.getHttpServer())
        .post(route(context.ids.sample))
        .send(input(context))
        .expect(401);
      await request(context.app.getHttpServer())
        .get(route(context.ids.sample))
        .expect(401);
      await request(context.app.getHttpServer())
        .get(route(context.ids.sample))
        .auth('invalid', { type: 'bearer' })
        .expect(401);
      await post(context, input(context), context.tokens.other).expect(403);
      expect(
        await context.tx.fabricationStep.count({
          where: { sampleId: context.ids.sample },
        }),
      ).toBe(0);
    });
  });

  it.each(['owner', 'admin'] as const)(
    'refuse un échantillon abandonné pour %s',
    async (role) => {
      await withApi(async (context) => {
        await post(
          context,
          input(context),
          context.tokens[role],
          context.ids.abandoned,
        ).expect(409);
        expect(
          await context.tx.fabricationStep.count({
            where: { sampleId: context.ids.abandoned },
          }),
        ).toBe(0);
      });
    },
  );

  it('refuse un type inactif', async () => {
    await withApi(async (context) => {
      await post(context, {
        ...input(context),
        stepTypeId: context.ids.inactive,
      }).expect(409);
      expect(
        await context.tx.fabricationStep.count({
          where: { sampleId: context.ids.sample },
        }),
      ).toBe(0);
    });
  });

  it.each([
    'unknown',
    'foreign',
    'missing',
    'duplicate',
    'duplicate-uppercase',
    'json-number',
    'boolean-string',
    'text-number',
    'NaN',
    'Infinity',
    'overflow',
    'rounding',
  ])('refuse les paramètres invalides : %s', async (scenario) => {
    await withApi(async (context) => {
      const body = input(context);
      switch (scenario) {
        case 'unknown':
          body.parameterValues.push({ definitionId: randomUUID(), value: '1' });
          break;
        case 'foreign':
          body.parameterValues.push({
            definitionId: context.ids.foreignDefinition,
            value: '1',
          });
          break;
        case 'missing':
          body.parameterValues = body.parameterValues.filter(
            (value) => value.definitionId !== context.ids.number,
          );
          break;
        case 'duplicate':
          body.parameterValues.push({ ...body.parameterValues[0] });
          break;
        case 'duplicate-uppercase':
          body.parameterValues.push({
            ...body.parameterValues[0],
            definitionId: context.ids.number.toUpperCase(),
          });
          break;
        case 'json-number':
          body.parameterValues[0].value = 120;
          break;
        case 'boolean-string':
          body.parameterValues[2].value = 'false';
          break;
        case 'text-number':
          body.parameterValues[1].value = 42;
          break;
        case 'NaN':
          body.parameterValues[0].value = 'NaN';
          break;
        case 'Infinity':
          body.parameterValues[0].value = 'Infinity';
          break;
        case 'overflow':
          body.parameterValues[0].value = '9'.repeat(36);
          break;
        case 'rounding':
          body.parameterValues[0].value = '0.' + '0'.repeat(30) + '1';
          break;
      }
      await post(context, body).expect(400);
      expect(
        await context.tx.fabricationStep.count({
          where: { sampleId: context.ids.sample },
        }),
      ).toBe(0);
      expect(
        await context.tx.stepParameterValue.count({
          where: { step: { sampleId: context.ids.sample } },
        }),
      ).toBe(0);
    });
  });

  it('valide un opérateur distinct et refuse l’injection de l’auteur depuis le corps', async () => {
    await withApi(async (context) => {
      await post(context, {
        ...input(context),
        recordedById: context.ids.admin,
      }).expect(400);
      await post(context, {
        ...input(context),
        operatorId: randomUUID(),
      }).expect(400);
      const response = await post(context, {
        ...input(context),
        operatorId: context.ids.operator,
      }).expect(201);
      const stored = await context.tx.fabricationStep.findUniqueOrThrow({
        where: { id: response.body.id as string },
      });
      expect(stored.recordedById).toBe(context.ids.owner);
      expect(stored.operatorId).toBe(context.ids.operator);
      expect(response.body.recordedBy).toEqual({
        id: context.ids.owner,
        name: 'Owner test',
      });
      expect(response.body.operator).toEqual({
        id: context.ids.operator,
        name: 'Operator test',
      });
    });
  });

  it('conserve les répétitions SUCCESS/FAILURE, l’ancien texte et l’ordre réel de l’historique', async () => {
    await withApi(async (context) => {
      const legacy = await context.tx.fabricationStep.create({
        data: {
          sampleId: context.ids.sample,
          operationName: 'Ancien cahier',
          performedAt: new Date('2020-01-01T08:00:00Z'),
          parameters: 'temperature=120 C; duration=300 s',
          recordedById: context.ids.owner,
          recordedAt: new Date('2020-01-02T08:00:00Z'),
        },
      });
      const success = await post(context).expect(201);
      const failure = await post(
        context,
        {
          ...input(context),
          result: 'FAILURE',
          performedAt: '2026-10-28T10:00:00Z',
        },
        context.tokens.admin,
      ).expect(201);
      expect(success.body.id).not.toBe(failure.body.id);
      for (const token of Object.values(context.tokens)) {
        const history = await request(context.app.getHttpServer())
          .get(route(context.ids.sample))
          .auth(token, { type: 'bearer' })
          .expect(200);
        expect(history.body.map((step: { id: string }) => step.id)).toEqual([
          legacy.id,
          failure.body.id,
          success.body.id,
        ]);
        expect(
          history.body.map((step: { result: string | null }) => step.result),
        ).toEqual([null, 'FAILURE', 'SUCCESS']);
        expect(history.body[0]).toMatchObject({
          parameters: legacy.parameters,
          stepTypeId: null,
          operatorId: null,
          parameterValues: [],
        });
        expect(history.body[0].performedAt).toBe(
          legacy.performedAt.toISOString(),
        );
        expect(history.body[0].recordedAt).toBe(
          legacy.recordedAt.toISOString(),
        );
        expect(
          history.body[2].parameterValues.find(
            (value: { definitionId: string }) =>
              value.definitionId === context.ids.number,
          ).numericValue,
        ).toBe(precise);
      }
      expect(
        (
          await context.tx.fabricationStep.findUniqueOrThrow({
            where: { id: legacy.id },
          })
        ).parameters,
      ).toBe(legacy.parameters);
    });
  });

  it('annule totalement la création après un véritable échec SQL d’écriture des paramètres', async () => {
    await withApi(async (context) => {
      const beforeSteps = await context.tx.fabricationStep.count();
      const beforeValues = await context.tx.stepParameterValue.count();
      context.fault.nextParameterWrite = true;
      await post(context).expect(500);
      expect(context.fault.error).toBeInstanceOf(Error);
      expect(String(context.fault.error)).toContain(
        'StepParameterValue_finite_numeric_check',
      );
      // These checks run before the outer rollback. The request savepoint must
      // already have removed every partial parent/parameter write.
      expect(await context.tx.fabricationStep.count()).toBe(beforeSteps);
      expect(await context.tx.stepParameterValue.count()).toBe(beforeValues);
      const response = await post(context).expect(201);
      expect(response.body.parameterValues).toHaveLength(3);
    });
  });
});
