// Opt-in only. Never imported by ordinary Jest tests. Requires a NEW, EMPTY,
// already migrated database; keeps its synthetic fixtures for inspection.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client.js');
const { UsersService } = require('../dist/users/users.service.js');
const { PasswordService } = require('../dist/auth/password.service.js');
const { ConflictException } = require('@nestjs/common');

async function main() {
  const raw = process.env.TEST_DATABASE_URL;
  assert.ok(
    raw,
    'TEST_DATABASE_URL required; no DATABASE_URL or .env fallback.',
  );
  const url = new URL(raw),
    database = decodeURIComponent(url.pathname.slice(1));
  const schema = process.env.TEST_SCHEMA ?? 'public';
  assert.match(schema, /^(public|concurrency_retry_[0-9]+)$/);
  assert.match(database, /^labo_echantillons_[a-z0-9_]*concurrency_test$/);
  assert.equal(
    process.env.ALLOW_CONCURRENCY_FIXTURES,
    'new-empty-database',
    'Explicit fixture opt-in required.',
  );
  const a = new PrismaClient({
    adapter: new PrismaPg({ connectionString: raw, max: 1 }, { schema }),
  });
  const b = new PrismaClient({
    adapter: new PrismaPg({ connectionString: raw, max: 1 }, { schema }),
  });
  try {
    const [pa, pb] = await Promise.all([
      a.$queryRaw`SELECT current_database() db, pg_backend_pid() pid`,
      b.$queryRaw`SELECT current_database() db, pg_backend_pid() pid`,
    ]);
    assert.equal(pa[0].db, database);
    assert.equal(pb[0].db, database);
    assert.notEqual(pa[0].pid, pb[0].pid);
    const tables =
      await a.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname=${schema} ORDER BY tablename`;
    const names = tables.map((row) => row.tablename);
    assert.deepEqual(names, [
      'Batch',
      'FabricationStep',
      'ParameterDefinition',
      'Sample',
      'StepCorrection',
      'StepParameterValue',
      'StepType',
      'User',
      '_prisma_migrations',
    ]);
    for (const table of names.filter((name) => name !== '_prisma_migrations')) {
      const rows = await a.$queryRawUnsafe(
        `SELECT count(*)::text count FROM "${schema}"."${table}"`,
      );
      assert.equal(
        rows[0].count,
        '0',
        'Refusing any preexisting business data.',
      );
    }
    const migrations = await a.$queryRawUnsafe(
      `SELECT migration_name FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    assert.deepEqual(
      migrations.map((row) => row.migration_name),
      [
        '20261028000000_init',
        '20261029000000_fabrication_structure',
        '20261030000000_user_activation',
      ],
    );
    const hash = await new PasswordService().hash(
      randomBytes(36).toString('base64url'),
    );
    const ids = [randomUUID(), randomUUID()];
    await a.user.createMany({
      data: ids.map((id, index) => ({
        id,
        name: `Concurrency ADMIN ${index}`,
        email: `${id}@example.test`,
        role: 'ADMIN',
        passwordHash: hash,
      })),
    });
    let arrivals = 0,
      release;
    const ready = new Promise((resolve) => {
      release = resolve;
    });
    const wrap = (client) => ({
      $transaction: (work, options) =>
        client.$transaction(
          async (tx) =>
            work({
              user: {
                findUnique: (args) => tx.user.findUnique(args),
                update: (args) => tx.user.update(args),
                count: async (args) => {
                  const result = await tx.user.count(args);
                  if (++arrivals === 2) release();
                  let timer;
                  try {
                    await Promise.race([
                      ready,
                      new Promise((_, reject) => {
                        timer = setTimeout(
                          () =>
                            reject(new Error('Concurrency barrier timeout')),
                          5000,
                        );
                      }),
                    ]);
                  } finally {
                    clearTimeout(timer);
                  }
                  return result;
                },
              },
            }),
          { ...options, timeout: 15000, maxWait: 10000 },
        ),
    });
    const sa = new UsersService(wrap(a), new PasswordService()),
      sb = new UsersService(wrap(b), new PasswordService());
    // Each active ADMIN tries to deactivate the other. Neither operation is a
    // self-deactivation. Both transactions see two active ADMINs before writing.
    const results = await Promise.allSettled([
      sa.updateStatus(ids[1], false, ids[0], 0),
      sb.updateStatus(ids[0], false, ids[1], 0),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected');
    if (!(failed?.reason instanceof ConflictException)) {
      const reason = failed?.reason;
      console.error(
        'Unexpected concurrency error shape:',
        JSON.stringify({
          name: reason?.constructor?.name,
          code: reason?.code,
          causeName: reason?.cause?.constructor?.name,
          causeCode: reason?.cause?.code,
          adapterKind: reason?.cause?.kind,
          adapterSqlState: reason?.cause?.originalCode,
          driverKind: reason?.meta?.driverAdapterError?.cause?.kind,
          sqlState: reason?.meta?.driverAdapterError?.cause?.originalCode,
        }),
      );
    }
    assert.ok(failed.reason instanceof ConflictException);
    assert.equal(failed.reason.getStatus(), 409);
    assert.equal(
      await a.user.count({ where: { role: 'ADMIN', isActive: true } }),
      1,
    );
    assert.deepEqual(
      (await a.user.findMany({ select: { authVersion: true } }))
        .map((u) => u.authVersion)
        .sort((left, right) => left - right),
      [0, 1],
    );
    console.log(
      'PASS two independent PostgreSQL connections: one commit, one 409, one active ADMIN remains.',
    );
    console.log(
      'Synthetic fixtures retained ONLY in the dedicated database; no reset, deletion or migration performed.',
    );
  } finally {
    await Promise.allSettled([a.$disconnect(), b.$disconnect()]);
  }
}
main().catch((error) => {
  // Never print connection strings, SQL payloads or fixture password hashes.
  console.error(
    'Concurrency test failed:',
    error instanceof assert.AssertionError
      ? error.message
      : 'Check dedicated database, migration state and fixture opt-in.',
  );
  process.exitCode = 1;
});
