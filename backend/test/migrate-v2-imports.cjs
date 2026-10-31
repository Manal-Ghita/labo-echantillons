const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
async function run() {
  const raw = process.env.V2_TEST_DATABASE_URL;
  assert.ok(raw, 'Explicit V2 URL required');
  const url = new URL(raw);
  assert.deepEqual(
    [url.hostname, url.port, url.username, url.pathname],
    ['127.0.0.1', '5433', 'labo_v2', '/labo_echantillons_v2'],
  );
  const client = new Client({ connectionString: raw });
  await client.connect();
  try {
    assert.deepEqual(
      (await client.query('SELECT current_database() db,current_user usr'))
        .rows[0],
      { db: 'labo_echantillons_v2', usr: 'labo_v2' },
    );
    const names = [
      '20261028000000_init',
      '20261029000000_fabrication_structure',
      '20261030000000_user_activation',
      '20261103000000_attachments',
      '20261104000000_measurement_imports',
    ];
    assert.deepEqual(
      fs
        .readdirSync(path.join(__dirname, '../prisma/migrations'))
        .filter((n) => /^\d/.test(n))
        .sort(),
      names,
    );
    const rows = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((r) => r.migration_name),
      names.slice(0, 4),
    );
    for (const row of rows) {
      assert.ok(row.finished_at && !row.rolled_back_at);
      assert.equal(
        row.checksum,
        createHash('sha256')
          .update(
            fs.readFileSync(
              path.join(
                __dirname,
                '../prisma/migrations',
                row.migration_name,
                'migration.sql',
              ),
            ),
          )
          .digest('hex'),
      );
    }
    async function fingerprints() {
      const data = {};
      for (const { tablename } of (
        await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','MeasurementImport','ImportedMeasurementValue') ORDER BY tablename",
        )
      ).rows) {
        assert.match(tablename, /^[A-Za-z]+$/);
        data[tablename] = (
          await client.query(
            `SELECT count(*)::text count,md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) hash FROM "${tablename}" t`,
          )
        ).rows[0];
      }
      assert.equal(Object.keys(data).length, 9);
      return data;
    }
    const before = await fingerprints();
    console.log(
      'VERIFIED exact target labo_echantillons_v2 on port 5433, distinct V2 user; only measurement_imports pending.',
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
        env: { ...process.env, DATABASE_URL: raw },
        stdio: 'inherit',
      },
    );
    assert.deepEqual(await fingerprints(), before);
    assert.deepEqual(
      (
        await client.query(
          'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
        )
      ).rows.map((r) => r.migration_name),
      names,
    );
    console.log(
      'PASS additive V2 imports migration; nine existing business tables unchanged.',
    );
  } finally {
    await client.end();
  }
}
run().catch(() => {
  console.error(
    'Guarded V2 imports migration failed. No fallback or automatic recovery.',
  );
  process.exitCode = 1;
});
