// Opt-in migration guard: refuses all targets except the isolated local V2.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const names = [
  '20261028000000_init',
  '20261029000000_fabrication_structure',
  '20261030000000_user_activation',
  '20261103000000_attachments',
];
async function run() {
  assert.ok(
    process.env.V2_TEST_DATABASE_URL,
    'Explicit V2_TEST_DATABASE_URL required',
  );
  const url = new URL(process.env.V2_TEST_DATABASE_URL);
  assert.deepEqual(
    [url.hostname, url.port, url.username, url.pathname],
    ['127.0.0.1', '5433', 'labo_v2', '/labo_echantillons_v2'],
  );
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    assert.deepEqual(
      (await client.query('SELECT current_database() db, current_user usr'))
        .rows[0],
      { db: 'labo_echantillons_v2', usr: 'labo_v2' },
    );
    const disk = fs
      .readdirSync(path.join(__dirname, '../prisma/migrations'))
      .filter((n) => /^\d/.test(n))
      .sort();
    assert.deepEqual(disk, names, 'Unexpected local migration');
    const previous = (
      await client.query(
        'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assert.deepEqual(
      previous.map((m) => m.migration_name),
      names.slice(0, previous.length),
    );
    assert.ok(previous.length === 3 || previous.length === 4);
    for (const m of previous) {
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
    async function fingerprints() {
      const result = {};
      for (const { tablename } of (
        await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' AND tablename <> 'Attachment' ORDER BY tablename",
        )
      ).rows) {
        assert.match(tablename, /^[A-Za-z]+$/);
        result[tablename] = (
          await client.query(
            `SELECT count(*)::text count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) hash FROM "${tablename}" t`,
          )
        ).rows[0];
      }
      assert.equal(Object.keys(result).length, 8);
      return result;
    }
    const before = await fingerprints();
    console.log(
      'VERIFIED before migration: labo_echantillons_v2, labo_v2, local port 5433, eight existing table fingerprints saved.',
    );
    execFileSync(
      process.execPath,
      [
        path.join(__dirname, '../node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'inherit',
      },
    );
    assert.deepEqual(await fingerprints(), before);
    const applied = (
      await client.query(
        'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assert.deepEqual(
      applied.map((m) => m.migration_name),
      names,
    );
    assert.ok(applied.every((m) => m.finished_at && !m.rolled_back_at));
    console.log(
      'PASS: only expected V2 migration deployed; existing eight business tables unchanged.',
    );
  } finally {
    await client.end();
  }
}
run().catch(() => {
  console.error(
    'V2 guarded migration failed. No V1 fallback or automatic recovery.',
  );
  process.exitCode = 1;
});
