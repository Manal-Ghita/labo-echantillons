const { Client } = require('pg');
const { spawn } = require('node:child_process');

function v2Environment(mode, source = process.env) {
  if (!['serve', 'migrate'].includes(mode)) throw new Error('Invalid V2 mode.');
  if (!source.V2_POSTGRES_PASSWORD) throw new Error('V2_POSTGRES_PASSWORD required.');
  if (mode === 'serve' && Buffer.byteLength(source.JWT_SECRET || '', 'utf8') < 32)
    throw new Error('V2 JWT secret must contain at least 32 bytes.');
  return {
    ...source,
    // Never reuse a host DATABASE_URL or the V1 startup defaults.
    DATABASE_URL: `postgresql://labo_v2:${encodeURIComponent(source.V2_POSTGRES_PASSWORD)}@db-v2:5432/labo_echantillons_v2?schema=public`,
  };
}

async function verifyTarget(connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== 'db-v2' || url.port !== '5432' ||
      url.pathname !== '/labo_echantillons_v2' || url.username !== 'labo_v2')
    throw new Error('Refusing non-V2 PostgreSQL target.');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query('SELECT current_database() db, current_user usr');
    if (rows[0].db !== 'labo_echantillons_v2' || rows[0].usr !== 'labo_v2')
      throw new Error('Unexpected V2 PostgreSQL identity.');
    await client.query('ROLLBACK');
    console.log('Verified PostgreSQL V2 identity: labo_echantillons_v2 / labo_v2.');
  } finally { await client.end(); }
}

async function main() {
  const mode = process.argv[2];
  const environment = v2Environment(mode);
  await verifyTarget(environment.DATABASE_URL);
  Object.assign(process.env, environment);
  if (mode === 'serve') { require('../dist/main.js'); return; }
  const child = spawn(process.execPath, [
    'node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', 'prisma.config.ts',
  ], { stdio: 'inherit', env: environment });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('V2 migration process failed.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}

module.exports = { v2Environment, verifyTarget };
if (require.main === module) main().catch(() => {
  // Connection errors can contain credentials: do not log their raw message.
  console.error('V2 startup refused: check isolated configuration and database identity.');
  process.exitCode = 1;
});
