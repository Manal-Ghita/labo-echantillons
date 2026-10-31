require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../../dist/generated/prisma/client');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');

async function runV2HttpTest(label, scenario) {
  const raw = process.env.V2_TEST_DATABASE_URL;
  assert.ok(
    raw,
    'Explicit V2_TEST_DATABASE_URL required; no environment-file fallback.',
  );
  const url = new URL(raw);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/labo_echantillons_v2');
  assert.equal(url.username, 'labo_v2');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: raw }),
  });
  let checks = 0;
  const pass = (message) => {
    checks++;
    console.log(`PASS ${label} ${checks}: ${message}`);
  };
  async function fingerprints() {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const tables =
        await tx.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
      assert.equal(tables.length, 10);
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
  const oldSecret = process.env.JWT_SECRET;
  try {
    assert.deepEqual(
      (
        await prisma.$queryRaw`SELECT current_database() db, current_user usr`
      )[0],
      { db: 'labo_echantillons_v2', usr: 'labo_v2' },
    );
    const migrations =
      await prisma.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
    assert.deepEqual(
      migrations.map((m) => m.migration_name),
      [
        '20261028000000_init',
        '20261029000000_fabrication_structure',
        '20261030000000_user_activation',
        '20261103000000_attachments',
      ],
    );
    for (const m of migrations) {
      assert.ok(m.finished_at && !m.rolled_back_at);
      assert.equal(
        m.checksum,
        createHash('sha256')
          .update(
            fs.readFileSync(
              path.join(
                __dirname,
                '../../prisma/migrations',
                m.migration_name,
                'migration.sql',
              ),
            ),
          )
          .digest('hex'),
      );
    }
    pass(
      'exact V2 identity and four migration checksums verified before writes',
    );
    const before = await fingerprints();
    const rollback = new Error('EXPECTED_V2_OUTER_ROLLBACK');
    let failure;
    try {
      await prisma.$transaction(
        async (tx) => {
          const actors = {
            owner: randomUUID(),
            other: randomUUID(),
            admin: randomUUID(),
          };
          for (const [role, id] of Object.entries(actors))
            await tx.user.create({
              data: {
                id,
                name: `V2 synthetic ${role}`,
                email: `${id}@example.test`,
                passwordHash: 'synthetic-unusable',
                role: role === 'admin' ? 'ADMIN' : 'RESEARCHER',
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
          facade.$queryRaw = tx.$queryRaw.bind(tx);
          facade.$transaction = async (work) => {
            const name = `v2_request_${++savepoint}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              const value = await work(tx);
              await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
              return value;
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
                Object.entries(actors).map(async ([role, id]) => [
                  role,
                  await jwt.signAsync({ sub: id, authVersion: 0 }),
                ]),
              ),
            );
            const http = (method, route, role = 'owner', body) =>
              request(app.getHttpServer())
                [method](route)
                .set('Authorization', `Bearer ${tokens[role]}`)
                .send(body);
            await scenario({ tx, app, actors, http, pass });
          } finally {
            await app.close();
          }
          throw rollback;
        },
        { isolationLevel: 'Serializable', timeout: 90000, maxWait: 10000 },
      );
    } catch (error) {
      if (error !== rollback) failure = error;
    }
    assert.deepEqual(await fingerprints(), before);
    pass(
      'outer rollback verified: ten fingerprints unchanged and synthetic fixtures removed',
    );
    if (failure) throw failure;
    console.log(`${checks} ${label} V2 checks passed.`);
  } finally {
    await prisma.$disconnect();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
}
module.exports = { runV2HttpTest };
