const { spawn } = require('node:child_process');

function containerEnvironment(mode, source = process.env) {
  if (!['serve', 'migrate'].includes(mode))
    throw new Error('Docker mode must be serve or migrate.');
  if (!source.POSTGRES_PASSWORD)
    throw new Error('POSTGRES_PASSWORD is required.');
  if (
    mode === 'serve' &&
    (!source.JWT_SECRET || Buffer.byteLength(source.JWT_SECRET, 'utf8') < 32)
  )
    throw new Error('JWT_SECRET must contain at least 32 bytes.');
  return {
    ...source,
    // Construct from raw credentials; ignore host-only DATABASE_URL values.
    DATABASE_URL: `postgresql://labo:${encodeURIComponent(source.POSTGRES_PASSWORD)}@db:5432/labo_echantillons?schema=public`,
  };
}

function main() {
  const mode = process.argv[2];
  try {
    Object.assign(process.env, containerEnvironment(mode));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (mode === 'serve') {
    require('../dist/main.js');
    return;
  }
  const child = spawn(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--config',
      'prisma.config.ts',
    ],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => child.kill(signal));
  child.on('error', () => {
    console.error('Unable to start Prisma migrations.');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

module.exports = { containerEnvironment };
if (require.main === module) main();
