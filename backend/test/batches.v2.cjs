// Explicit opt-in integration: synthetic fixtures inside one outer V2 rollback.
require('reflect-metadata');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/prisma/prisma.service');

async function main() {
  const raw = process.env.V2_TEST_DATABASE_URL;
  assert.ok(raw, 'Explicit V2_TEST_DATABASE_URL required.');
  const url = new URL(raw);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/labo_echantillons_v2');
  assert.equal(url.username, 'labo_v2');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: raw }),
  });
  const rollback = new Error('V2_SYNTHETIC_FIXTURES_ROLLBACK');
  let checks = 0;
  const pass = (label) => {
    checks++;
    console.log(`PASS ${checks}: ${label}`);
  };
  async function fingerprints() {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const tables =
        await tx.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
      const result = {};
      for (const { tablename } of tables) {
        assert.match(tablename, /^[A-Za-z_]+$/);
        result[tablename] = (
          await tx.$queryRawUnsafe(
            `SELECT count(*)::text count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) hash FROM "${tablename}" t`,
          )
        )[0];
      }
      return result;
    });
  }
  try {
    const identity = (
      await prisma.$queryRaw`SELECT current_database() db, current_user usr`
    )[0];
    assert.deepEqual(identity, { db: 'labo_echantillons_v2', usr: 'labo_v2' });
    const migrations =
      await prisma.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
    assert.equal(migrations.length, 4);
    for (const m of migrations) {
      assert.ok(m.finished_at && !m.rolled_back_at);
      assert.equal(
        m.checksum,
        createHash('sha256')
          .update(
            fs.readFileSync(
              path.join(
                __dirname,
                '../prisma/migrations',
                m.migration_name,
                'migration.sql',
              ),
            ),
          )
          .digest('hex'),
      );
    }
    pass('exact V2 identity and four migration checksums');
    const before = await fingerprints();
    let runError;
    try {
      await prisma.$transaction(
        async (tx) => {
          const [owner, other, admin] = [
            randomUUID(),
            randomUUID(),
            randomUUID(),
          ];
          for (const [id, role] of [
            [owner, 'RESEARCHER'],
            [other, 'RESEARCHER'],
            [admin, 'ADMIN'],
          ])
            await tx.user.create({
              data: {
                id,
                name: 'Synthetic V2 batch tester',
                email: `${id}@example.test`,
                passwordHash: 'synthetic-unusable',
                role,
              },
            });
          const type = await tx.stepType.create({
            data: {
              code: `T_${randomUUID()}`,
              name: 'Recuit V2 synthétique',
              parameters: {
                create: [
                  {
                    key: 'temperature',
                    name: 'Température',
                    dataType: 'NUMBER',
                    unit: '°C',
                    isRequired: true,
                  },
                  {
                    key: 'material',
                    name: 'Matériau',
                    dataType: 'TEXT',
                    isRequired: true,
                  },
                  {
                    key: 'vacuum',
                    name: 'Sous vide',
                    dataType: 'BOOLEAN',
                    isRequired: true,
                  },
                ],
              },
            },
            include: { parameters: true },
          });
          const sampleIds = [randomUUID(), randomUUID()].sort();
          for (const id of sampleIds)
            await tx.sample.create({
              data: {
                id,
                reference: `S_${id}`,
                name: 'Capteur PET synthétique',
                creatorId: owner,
                status: 'ACTIVE',
              },
            });
          const foreign = await tx.sample.create({
            data: {
              reference: `S_${randomUUID()}`,
              name: 'Autre propriétaire',
              creatorId: other,
              status: 'ACTIVE',
            },
          });
          let savepoint = 0;
          const facade = Object.fromEntries(
            [
              'user',
              'sample',
              'batch',
              'stepType',
              'parameterDefinition',
              'fabricationStep',
              'stepParameterValue',
              'stepCorrection',
              'attachment',
            ].map((name) => [name, tx[name]]),
          );
          facade.$transaction = async (work) => {
            const name = `batch_request_${++savepoint}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              const result = await work(tx);
              await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
              return result;
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
              throw error;
            }
          };
          process.env.JWT_SECRET = randomBytes(48).toString('base64url');
          const module = await Test.createTestingModule({
            imports: [AppModule],
          })
            .overrideProvider(PrismaService)
            .useValue(facade)
            .compile();
          const app = module.createNestApplication({ logger: false });
          try {
            await app.init();
            const jwt = module.get(JwtService);
            const tokens = Object.fromEntries(
              await Promise.all(
                [owner, other, admin].map(async (id) => [
                  id,
                  await jwt.signAsync({ sub: id, authVersion: 0 }),
                ]),
              ),
            );
            const http = (method, route, actor = owner, body) =>
              request(app.getHttpServer())
                [method](route)
                .set('Authorization', `Bearer ${tokens[actor]}`)
                .send(body);
            await request(app.getHttpServer()).get('/batches').expect(401);
            const batch = (
              await http('post', '/batches', owner, {
                reference: `B_${randomUUID()}`,
              }).expect(201)
            ).body;
            assert.equal(batch.createdById, owner);
            await http('get', `/batches/${batch.id}`, other).expect(200);
            pass(
              'authenticated creation/consultation; creator from verified JWT; anonymous 401',
            );
            await http('post', `/batches/${batch.id}/samples`, other, {
              sampleIds,
            }).expect(403);
            await http('post', `/batches/${batch.id}/samples`, owner, {
              sampleIds: [...sampleIds, foreign.id],
            }).expect(403);
            assert.equal(
              await tx.sample.count({ where: { batchId: batch.id } }),
              0,
            );
            await http('post', `/batches/${batch.id}/samples`, owner, {
              sampleIds,
            }).expect(201);
            const membershipBefore = await tx.sample.findMany({
              where: { id: { in: sampleIds } },
              orderBy: { id: 'asc' },
            });
            await http('post', `/batches/${batch.id}/samples`, owner, {
              sampleIds,
            }).expect(201, { attached: 0 });
            assert.deepEqual(
              await tx.sample.findMany({
                where: { id: { in: sampleIds } },
                orderBy: { id: 'asc' },
              }),
              membershipBefore,
            );
            const otherBatch = (
              await http('post', '/batches', admin, {
                reference: `B_${randomUUID()}`,
              }).expect(201)
            ).body;
            await http('post', `/batches/${otherBatch.id}/samples`, admin, {
              sampleIds,
            }).expect(409);
            pass(
              'membership permissions, atomic association and refusal of implicit transfers',
            );
            const precise = '150.12345678901234567890123456789';
            const operation = {
              stepTypeId: type.id,
              performedAt: '2026-10-30T14:30:00+01:00',
              result: 'SUCCESS',
              operatorId: other,
              parameterValues: type.parameters.map((d) => ({
                definitionId: d.id,
                value:
                  d.dataType === 'NUMBER'
                    ? precise
                    : d.dataType === 'TEXT'
                      ? 'PET'
                      : false,
              })),
            };
            const group = {
              operation,
              samples: sampleIds.map((sampleId, index) => ({
                sampleId,
                result: index ? 'FAILURE' : 'SUCCESS',
              })),
            };
            await http(
              'post',
              `/batches/${batch.id}/steps`,
              other,
              group,
            ).expect(403);
            const created = (
              await http(
                'post',
                `/batches/${batch.id}/steps`,
                owner,
                group,
              ).expect(201)
            ).body;
            assert.equal(created.length, 2);
            assert.notEqual(created[0].id, created[1].id);
            assert.deepEqual(
              created.map((s) => s.result),
              ['SUCCESS', 'FAILURE'],
            );
            for (const step of created) {
              assert.equal(step.recordedById, owner);
              assert.equal(step.operatorId, other);
              assert.equal(
                step.parameterValues.find(
                  (v) => v.definition.dataType === 'NUMBER',
                ).numericValue,
                precise,
              );
              assert.equal(
                step.parameterValues.find(
                  (v) => v.definition.dataType === 'BOOLEAN',
                ).booleanValue,
                false,
              );
            }
            pass(
              'independent SUCCESS/FAILURE realizations, exact decimal, TEXT/BOOLEAN and distinct operator',
            );
            const secondBefore = JSON.stringify(
              await tx.fabricationStep.findUnique({
                where: { id: created[1].id },
                include: {
                  parameterValues: { orderBy: { id: 'asc' } },
                  corrections: true,
                },
              }),
            );
            await http(
              'post',
              `/samples/${sampleIds[0]}/steps/${created[0].id}/corrections`,
              owner,
              {
                reason: 'Correction synthétique indépendante',
                expectedRevision: 0,
                observations: 'Uniquement cet échantillon',
              },
            ).expect(201);
            assert.equal(
              await tx.stepCorrection.count({
                where: { stepId: created[0].id },
              }),
              1,
            );
            assert.equal(
              JSON.stringify(
                await tx.fabricationStep.findUnique({
                  where: { id: created[1].id },
                  include: {
                    parameterValues: { orderBy: { id: 'asc' } },
                    corrections: true,
                  },
                }),
              ),
              secondBefore,
            );
            for (const id of sampleIds)
              assert.equal(
                (await http('get', `/samples/${id}/steps`, other).expect(200))
                  .body.length,
                1,
              );
            pass(
              'individual correction/audit do not change the other realization; global history consultation',
            );
            const count = await tx.fabricationStep.count();
            await tx.sample.update({
              where: { id: sampleIds[1] },
              data: { status: 'ABANDONED' },
            });
            await http(
              'post',
              `/batches/${batch.id}/steps`,
              owner,
              group,
            ).expect(409);
            assert.equal(await tx.fabricationStep.count(), count);
            await http(
              'post',
              `/batches/${batch.id}/steps`,
              admin,
              group,
            ).expect(409);
            assert.equal(await tx.fabricationStep.count(), count);
            await tx.sample.update({
              where: { id: sampleIds[1] },
              data: { status: 'ACTIVE' },
            });
            pass(
              'atomic rollback when second sample is abandoned, including ADMIN',
            );
            await http(
              'post',
              `/batches/${batch.id}/steps`,
              admin,
              group,
            ).expect(201);
            const beforeFailure = await tx.fabricationStep.count();
            // PostgreSQL failure on the second insert, entirely within this outer rollback.
            await tx.$executeRawUnsafe(
              `CREATE FUNCTION pg_temp.v2_batch_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sampleId" = '${sampleIds[1]}'::uuid THEN RAISE EXCEPTION 'Synthetic batch failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
            );
            await tx.$executeRawUnsafe(
              'CREATE TRIGGER v2_batch_fail BEFORE INSERT ON "FabricationStep" FOR EACH ROW EXECUTE FUNCTION pg_temp.v2_batch_fail()',
            );
            const failed = await http(
              'post',
              `/batches/${batch.id}/steps`,
              owner,
              group,
            );
            assert.ok(failed.status >= 400);
            assert.equal(await tx.fabricationStep.count(), beforeFailure);
            pass(
              'ADMIN entry allowed; actual SQL failure on second insert rolls back the first',
            );
          } finally {
            await app.close();
          }
          throw rollback;
        },
        { isolationLevel: 'Serializable', timeout: 90000, maxWait: 10000 },
      );
    } catch (error) {
      if (error !== rollback) runError = error;
    }
    assert.deepEqual(await fingerprints(), before);
    pass(
      'all V2 fingerprints unchanged after outer rollback; no synthetic account or fixture retained',
    );
    if (runError) throw runError;
    console.log(`${checks} V2 integration checks passed.`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : 'V2 batch integration failed; no credentials logged.',
  );
  process.exitCode = 1;
});
