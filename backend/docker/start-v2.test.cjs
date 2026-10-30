const { test } = require('node:test');
const assert = require('node:assert/strict');
const { v2Environment, verifyTarget } = require('./start-v2.cjs');

test('V2 ignores V1 URL and encodes its separate password', () => {
  const env = v2Environment('migrate', {
    DATABASE_URL: 'postgresql://unused@v1/labo_echantillons',
    V2_POSTGRES_PASSWORD: 'synthetic:@/password',
  });
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.hostname, 'db-v2');
  assert.equal(url.pathname, '/labo_echantillons_v2');
  assert.equal(url.username, 'labo_v2');
  assert.equal(decodeURIComponent(url.password), 'synthetic:@/password');
});
test('V1 password cannot substitute for missing V2 configuration', () => {
  assert.throws(() => v2Environment('migrate', { POSTGRES_PASSWORD: 'synthetic' }));
  assert.throws(() => v2Environment('serve', { V2_POSTGRES_PASSWORD: 'synthetic', JWT_SECRET: 'short' }));
  assert.throws(() => v2Environment('reset', { V2_POSTGRES_PASSWORD: 'synthetic' }));
});
test('unexpected targets are refused before opening any connection', async () => {
  for (const url of [
    'postgresql://labo@db:5432/labo_echantillons',
    'postgresql://labo_v2@db-v2:5432/labo_echantillons',
    'postgresql://labo_v2@localhost:5432/labo_echantillons_v2',
  ]) await assert.rejects(verifyTarget(url), /Refusing/);
});
