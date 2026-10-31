// Run explicitly from backend, never imported by ordinary tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Client } = require('pg');

async function verify() {
  const raw = process.env.V2_TEST_DATABASE_URL;
  assert.ok(raw, 'V2_TEST_DATABASE_URL required; no default or V1 fallback.');
  const url = new URL(raw);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5433');
  assert.equal(url.username, 'labo_v2');
  assert.equal(url.pathname, '/labo_echantillons_v2');
  const client = new Client({ connectionString: raw });
  let inTransaction = false;
  try {
    await client.connect();
    const identity = (await client.query('SELECT current_database() db, current_user usr')).rows[0];
    assert.deepEqual(identity, { db: 'labo_echantillons_v2', usr: 'labo_v2' });
    const migrations = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;
    const names = ['20261028000000_init', '20261029000000_fabrication_structure', '20261030000000_user_activation', '20261103000000_attachments', '20261104000000_measurement_imports'];
    assert.deepEqual(migrations.map(m => m.migration_name), names);
    for (const m of migrations) {
      assert.ok(m.finished_at && !m.rolled_back_at);
      const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations', m.migration_name, 'migration.sql'));
      assert.equal(m.checksum, createHash('sha256').update(sql).digest('hex'));
    }
    async function fingerprints() {
      const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
      assert.equal(tables.length, 12);
      const result = {};
      for (const { tablename } of tables) {
        assert.match(tablename, /^[A-Za-z_]+$/);
        result[tablename] = (await client.query(`SELECT count(*)::text count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) hash FROM "${tablename}" t`)).rows[0];
      }
      return result;
    }
    const before = await fingerprints();
    await client.query('BEGIN'); inTransaction = true;
    const id = randomUUID();
    // Deliberately not a usable password hash; this transaction cannot log in.
    await client.query('INSERT INTO "User" (id,name,email,"passwordHash",role) VALUES ($1,$2,$3,$4,$5)', [id, 'V2 isolation fixture', `${id}@example.test`, 'synthetic-not-a-password-hash', 'RESEARCHER']);
    const fixture = (await client.query('SELECT "isActive", "authVersion" FROM "User" WHERE id=$1', [id])).rows[0];
    assert.deepEqual(fixture, { isActive: true, authVersion: 0 });
    await client.query('ROLLBACK'); inTransaction = false;
    assert.equal((await client.query('SELECT count(*)::int count FROM "User" WHERE id=$1', [id])).rows[0].count, 0);
    assert.deepEqual(await fingerprints(), before);
    console.log('PASS V2 exact identity; five migration checksums; synthetic write/defaults/rollback; twelve fingerprints unchanged.');
  } finally {
    if (inTransaction) await client.query('ROLLBACK');
    await client.end();
  }
}
verify().catch(() => {
  console.error('V2 isolation verification failed; check dedicated target and migrations. No connection secret is logged.');
  process.exitCode = 1;
});
