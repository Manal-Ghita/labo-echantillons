const { test } = require('node:test');
const assert = require('node:assert/strict');
const { containerEnvironment } = require('./start.cjs');

test('Docker URL preserves raw password including percent and URL punctuation', () => {
  const password = 'test@:/?#%ab $!';
  const environment = containerEnvironment('migrate', {
    POSTGRES_PASSWORD: password,
    DATABASE_URL: 'postgresql://localhost/wrong',
  });
  const url = new URL(environment.DATABASE_URL);
  assert.equal(url.hostname, 'db');
  assert.equal(url.port, '5432');
  assert.equal(url.username, 'labo');
  assert.equal(url.pathname, '/labo_echantillons');
  assert.equal(url.searchParams.get('schema'), 'public');
  assert.equal(decodeURIComponent(url.password), password);
});
test('migration needs no JWT secret and does not alter the source environment', () => {
  const source = { POSTGRES_PASSWORD: 'test-only' };
  containerEnvironment('migrate', source);
  assert.deepEqual(source, { POSTGRES_PASSWORD: 'test-only' });
});
test('missing password fails without revealing environment values', () => {
  assert.throws(() => containerEnvironment('migrate', {}), {
    message: 'POSTGRES_PASSWORD is required.',
  });
});
test('server refuses missing or short JWT secret', () => {
  for (const secret of [undefined, 'short'])
    assert.throws(
      () =>
        containerEnvironment('serve', {
          POSTGRES_PASSWORD: 'test-only',
          JWT_SECRET: secret,
        }),
      /at least 32 bytes/,
    );
});
test('server accepts an adequate secret and keeps CORS configuration', () => {
  const result = containerEnvironment('serve', {
    POSTGRES_PASSWORD: 'test-only',
    JWT_SECRET: 'x'.repeat(32),
    WEB_ORIGIN: 'http://localhost:8080',
  });
  assert.equal(result.WEB_ORIGIN, 'http://localhost:8080');
});
test('unexpected startup mode cannot run another Prisma operation', () => {
  assert.throws(
    () => containerEnvironment('reset', { POSTGRES_PASSWORD: 'test-only' }),
    /serve or migrate/,
  );
});
