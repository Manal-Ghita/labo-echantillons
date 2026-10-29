// Explicitly authorized real HTTP/SQL tests. Never part of npm test or Docker startup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '..');
const secrets = [];
let stage = 'preflight';
let checks = 0;
const tables = [
  'User',
  'Sample',
  'FabricationStep',
  'Batch',
  'StepType',
  'ParameterDefinition',
  'StepParameterValue',
  'StepCorrection',
  '_prisma_migrations',
];
const precise =
  '12345678901234567890123456789012345.123456789012345678901234567891';

function dockerState() {
  return ['db', 'backend', 'frontend', 'migrate'].map((service) => {
    const container = JSON.parse(
      execFileSync('docker', ['inspect', `labo-echantillons-${service}-1`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    )[0];
    return {
      service,
      id: container.Id,
      started: container.State.StartedAt,
      status: container.State.Status,
      volume:
        service === 'db'
          ? container.Mounts.find(
              (m) => m.Destination === '/var/lib/postgresql/data',
            ).Name
          : undefined,
    };
  });
}
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function closedPort(port) {
  await freePort(port);
}
async function bounded(work, milliseconds = 5000) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Test cleanup timed out')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function report(name) {
  checks++;
  console.log(`PASS ${checks}: ${name}`);
}

async function main() {
  assert.ok(
    process.argv.includes('--allow-test-writes'),
    'Explicit authorization flag required.',
  );
  process.chdir(backend);
  const local = require('dotenv').parse(
    fs.readFileSync(path.join(root, '.env')),
  );
  assert.ok(local.POSTGRES_PASSWORD, 'Local PostgreSQL credential required.');
  const connectionString = `postgresql://labo:${encodeURIComponent(local.POSTGRES_PASSWORD)}@127.0.0.1:5432/labo_echantillons_test?schema=public`;
  const url = new URL(connectionString);
  assert.equal(url.pathname, '/labo_echantillons_test');
  secrets.push(
    local.POSTGRES_PASSWORD,
    encodeURIComponent(local.POSTGRES_PASSWORD),
    connectionString,
  );
  process.env.DATABASE_URL = connectionString;
  process.env.JWT_SECRET = randomBytes(48).toString('base64url');
  process.env.WEB_ORIGIN = 'http://localhost:5180';
  secrets.push(process.env.JWT_SECRET);
  await freePort(3100);
  await freePort(5180);
  const originalDocker = dockerState();
  const { Test } = require('@nestjs/testing');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { PrismaClient, Prisma } = require('../dist/generated/prisma/client');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const { PasswordService } = require('../dist/auth/password.service');
  const { AppModule } = require('../dist/app.module');
  const { configureCors } = require('../dist/configure-cors');
  const { chromium, expect } = require(
    path.join(root, 'frontend/node_modules/@playwright/test'),
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5000,
    }),
  });
  const snapshot = async () => {
    const state = {};
    for (const table of tables)
      state[table] = await prisma.$queryRawUnsafe(
        `SELECT count(*)::text AS count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY id), '')) AS fingerprint FROM "${table}" t`,
      );
    return state;
  };
  let baseline;
  try {
    assert.equal(
      (await prisma.$queryRaw`SELECT current_database() AS name`)[0].name,
      'labo_echantillons_test',
    );
    const migrations =
      await prisma.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
    const dirs = fs
      .readdirSync(path.join(backend, 'prisma/migrations'), {
        withFileTypes: true,
      })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    assert.deepEqual(dirs, [
      '20261028000000_init',
      '20261029000000_fabrication_structure',
    ]);
    assert.deepEqual(
      migrations.map((m) => m.migration_name),
      dirs,
    );
    for (const migration of migrations) {
      assert.ok(migration.finished_at);
      assert.equal(migration.rolled_back_at, null);
      assert.equal(
        migration.checksum.toLowerCase(),
        createHash('sha256')
          .update(
            fs.readFileSync(
              path.join(
                backend,
                'prisma/migrations',
                migration.migration_name,
                'migration.sql',
              ),
            ),
          )
          .digest('hex'),
      );
    }
    baseline = await snapshot();
    report('exclusive test database and both SQL migration checksums verified');

    for (const viewport of [
      { name: 'desktop', width: 1440, height: 1000 },
      { name: 'mobile', width: 375, height: 812 },
    ]) {
      const rollback = new Error('EXPECTED_FIXTURE_ROLLBACK');
      const ids = [];
      try {
        await prisma.$transaction(
          async (tx) => {
            let app, vite, browser;
            const failures = [];
            let queue = Promise.resolve();
            let isolationFailure;
            let savepoint = 0;
            let fault = false;
            let auditFault = false;
            let sqlFault;
            const serial = (work) => {
              const run = queue.then(() => {
                if (isolationFailure) throw isolationFailure;
                return work();
              });
              queue = run.catch((error) => {
                isolationFailure = error;
              });
              return run;
            };
            const sql = (statement) => tx.$executeRawUnsafe(statement);
            let scoped;
            const nested = async (work, options) => {
              assert.equal(options?.isolationLevel, 'Serializable');
              const name = `service_${++savepoint}`;
              await sql(`SAVEPOINT "${name}"`);
              try {
                const result = await work(scoped);
                await sql(`RELEASE SAVEPOINT "${name}"`);
                return result;
              } catch (error) {
                await sql(`ROLLBACK TO SAVEPOINT "${name}"`);
                await sql(`RELEASE SAVEPOINT "${name}"`);
                throw error;
              }
            };
            const steps = new Proxy(tx.fabricationStep, {
              get(target, property) {
                if (property !== 'create')
                  return Reflect.get(target, property, target);
                return async (args) => {
                  if (!fault) return tx.fabricationStep.create(args);
                  fault = false;
                  const values = args.data.parameterValues.create.map(
                    (value) =>
                      value.numericValue !== undefined
                        ? { ...value, numericValue: new Prisma.Decimal('NaN') }
                        : value,
                  );
                  try {
                    return await tx.fabricationStep.create({
                      ...args,
                      data: {
                        ...args.data,
                        parameterValues: { create: values },
                      },
                    });
                  } catch (error) {
                    sqlFault = error;
                    throw error;
                  }
                };
              },
            });
            const audits = new Proxy(tx.stepCorrection, {
              get(target, property) {
                if (property !== 'create')
                  return Reflect.get(target, property, target);
                return (args) => {
                  if (!auditFault) return tx.stepCorrection.create(args);
                  auditFault = false;
                  return tx.stepCorrection.create({
                    ...args,
                    data: { ...args.data, reason: ' ' },
                  });
                };
              },
            });
            scoped = new Proxy(tx, {
              get(target, property) {
                if (property === '$transaction') return nested;
                if (property === 'fabricationStep') return steps;
                if (property === 'stepCorrection') return audits;
                return Reflect.get(target, property, target);
              },
            });
            try {
              stage = `${viewport.name}: transaction isolation`;
              assert.equal(
                (await tx.$queryRaw`SELECT current_database() AS name`)[0].name,
                'labo_echantillons_test',
              );
              assert.equal(
                (await tx.$queryRaw`SHOW transaction_isolation`)[0]
                  .transaction_isolation,
                'serializable',
              );
              await sql('SAVEPOINT isolation_probe');
              let rejected = false;
              try {
                await tx.$queryRaw`SELECT 1 / 0`;
              } catch {
                rejected = true;
              }
              assert.ok(rejected);
              await sql('ROLLBACK TO SAVEPOINT isolation_probe');
              await sql('RELEASE SAVEPOINT isolation_probe');
              assert.equal((await tx.$queryRaw`SELECT 1 AS value`)[0].value, 1);
              report(
                `${viewport.name}: real SQL savepoint recovery verified before fixtures`,
              );
              const actors = {};
              for (const name of ['owner', 'other', 'admin']) {
                const password = randomBytes(24).toString('base64url');
                secrets.push(password);
                const user = await tx.user.create({
                  data: {
                    name: `Functional ${name}`,
                    email: `functional-${name}-${randomUUID()}@example.test`,
                    passwordHash: await new PasswordService().hash(password),
                    role: name === 'admin' ? 'ADMIN' : 'RESEARCHER',
                  },
                });
                ids.push(user.id);
                actors[name] = { ...user, password };
              }
              const abandoned = await tx.sample.create({
                data: {
                  reference: `ABANDONED-${randomUUID()}`,
                  name: 'Functional abandoned',
                  creatorId: actors.owner.id,
                  status: 'ABANDONED',
                },
              });
              const module = await Test.createTestingModule({
                imports: [AppModule],
              })
                .overrideProvider(PrismaService)
                .useValue(scoped)
                .compile();
              app = module.createNestApplication({ logger: false });
              app.use((_req, res, next) => {
                // Observe close immediately: StrictMode can abort a queued GET
                // before its turn. Such requests must never wait for a lost event.
                const completed = new Promise((resolve) => {
                  res.once('finish', () => resolve(res.statusCode < 400));
                  res.once('close', () => resolve(false));
                });
                void serial(async () => {
                  if (res.destroyed || res.writableEnded) return;
                  const name = `http_${++savepoint}`;
                  await sql(`SAVEPOINT "${name}"`);
                  if (!res.destroyed) next();
                  const successful = await completed;
                  if (!successful) await sql(`ROLLBACK TO SAVEPOINT "${name}"`);
                  await sql(`RELEASE SAVEPOINT "${name}"`);
                }).catch(() => {
                  if (!res.headersSent)
                    res.status(503).json({ message: 'Test isolation failed' });
                });
              });
              configureCors(app);
              await app.listen(3100, '127.0.0.1');
              const viteEnv = {
                ...process.env,
                VITE_API_URL: 'http://localhost:3100',
              };
              for (const key of [
                'DATABASE_URL',
                'TEST_DATABASE_URL',
                'JWT_SECRET',
                'POSTGRES_PASSWORD',
                'ADMIN_NAME',
                'ADMIN_EMAIL',
                'ADMIN_PASSWORD',
              ])
                delete viteEnv[key];
              vite = spawn(
                process.execPath,
                [
                  path.join(root, 'frontend/node_modules/vite/bin/vite.js'),
                  '--host',
                  'localhost',
                  '--port',
                  '5180',
                  '--strictPort',
                ],
                {
                  cwd: path.join(root, 'frontend'),
                  env: viteEnv,
                  windowsHide: true,
                  stdio: 'ignore',
                },
              );
              for (let attempt = 0; ; attempt++) {
                assert.ok(attempt < 100, 'Vite startup timeout');
                try {
                  if ((await fetch('http://localhost:5180')).ok) break;
                } catch {
                  /* bounded startup wait */
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              const edge =
                'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
              browser = await chromium.launch({
                headless: true,
                executablePath:
                  process.env.BROWSER_EXECUTABLE ||
                  (fs.existsSync(edge) ? edge : undefined),
              });
              if (process.argv.includes('--verify-failure-cleanup')) {
                stage = 'intentional cleanup probe';
                throw new Error(
                  'Intentional failure to verify rollback and cleanup',
                );
              }
              const pages = {};
              let forbiddenNetwork = false;
              async function login(name) {
                const context = await browser.newContext({
                  viewport: { width: viewport.width, height: viewport.height },
                  isMobile: viewport.name === 'mobile',
                  hasTouch: viewport.name === 'mobile',
                  timezoneId: 'Europe/Paris',
                });
                await context.route('**/*', (route) => {
                  const target = new URL(route.request().url());
                  if (
                    ['http:', 'https:'].includes(target.protocol) &&
                    (!['localhost', '127.0.0.1'].includes(target.hostname) ||
                      !['3100', '5180'].includes(target.port))
                  ) {
                    forbiddenNetwork = true;
                    return route.abort();
                  }
                  return route.continue();
                });
                const page = await context.newPage();
                page.setDefaultTimeout(10000);
                await page.goto('http://localhost:5180/login');
                await page
                  .getByLabel('Email', { exact: true })
                  .fill(actors[name].email);
                await page
                  .getByLabel('Mot de passe', { exact: true })
                  .fill(actors[name].password);
                const identity = page.waitForResponse(
                  (r) => r.url() === 'http://localhost:3100/auth/me',
                );
                await page
                  .getByRole('button', { name: 'Se connecter' })
                  .click();
                const response = await identity;
                assert.equal(response.status(), 200);
                assert.equal(
                  response.headers()['access-control-allow-origin'],
                  'http://localhost:5180',
                );
                assert.equal((await response.json()).id, actors[name].id);
                await expect(
                  page.getByRole('heading', {
                    name: 'Échantillons',
                    exact: true,
                  }),
                ).toBeVisible();
                const token = await page.evaluate(
                  () =>
                    JSON.parse(sessionStorage.getItem('labo.session')).token,
                );
                secrets.push(token);
                pages[name] = page;
                return page;
              }
              async function http(
                page,
                pathname,
                method = 'GET',
                body,
                authenticated = true,
              ) {
                assert.ok(
                  pathname.startsWith('/') && !pathname.startsWith('//'),
                );
                return page.evaluate(
                  async ({ pathname, method, body, authenticated }) => {
                    const session = sessionStorage.getItem('labo.session');
                    const headers = {};
                    if (authenticated && session)
                      headers.Authorization = `Bearer ${JSON.parse(session).token}`;
                    if (body !== undefined)
                      headers['Content-Type'] = 'application/json';
                    const options = { method, headers };
                    if (body !== undefined) options.body = JSON.stringify(body);
                    const response = await fetch(
                      `http://localhost:3100${pathname}`,
                      options,
                    );
                    return {
                      status: response.status,
                      body: await response.json(),
                    };
                  },
                  { pathname, method, body, authenticated },
                );
              }
              stage = `${viewport.name}: ADMIN catalogue UI`;
              const adminPage = await login('admin');
              await adminPage.goto('http://localhost:5180/step-types/new');
              await adminPage
                .getByLabel('Code *')
                .fill(`FUNCTIONAL-${randomUUID()}`);
              await adminPage
                .getByLabel('Nom *', { exact: true })
                .fill('Functional deposition');
              for (const definition of [
                { key: 'number', name: 'Température', type: 'NUMBER' },
                { key: 'text', name: 'Gaz', type: 'TEXT' },
                { key: 'boolean', name: 'Sous vide', type: 'BOOLEAN' },
              ]) {
                await adminPage
                  .getByRole('button', { name: 'Ajouter un paramètre' })
                  .click();
                const field = adminPage.getByRole('group').last();
                await field.getByLabel('Clé *').fill(definition.key);
                await field
                  .getByLabel('Nom du paramètre *')
                  .fill(definition.name);
                await field
                  .getByLabel('Type de valeur *')
                  .selectOption(definition.type);
                await field.getByLabel('Paramètre obligatoire').check();
                if (definition.type === 'NUMBER')
                  await field.getByLabel('Unité', { exact: true }).fill('°C');
              }
              const createdTypeResponse = adminPage.waitForResponse(
                (r) =>
                  r.url() === 'http://localhost:3100/step-types' &&
                  r.request().method() === 'POST',
              );
              await adminPage
                .getByRole('button', { name: 'Créer le type', exact: true })
                .click();
              const typeResponse = await createdTypeResponse;
              assert.equal(typeResponse.status(), 201);
              const type = await typeResponse.json();
              assert.equal(type.parameters.length, 3);
              const definitions = Object.fromEntries(
                type.parameters.map((p) => [p.key, p.id]),
              );
              report(
                `${viewport.name}: ADMIN login, profile and catalogue creation through real React/HTTP/SQL`,
              );

              stage = `${viewport.name}: owner sample UI`;
              await adminPage.goto('http://localhost:5180/users');
              const provisionedPassword = randomBytes(24).toString('base64url');
              secrets.push(provisionedPassword);
              const provisionedEmail = `functional-provisioned-${randomUUID()}@example.test`;
              await adminPage
                .getByLabel('Nom du chercheur *')
                .fill('Functional provisioned');
              await adminPage
                .getByLabel('Email du chercheur *')
                .fill(provisionedEmail);
              await adminPage
                .getByLabel('Mot de passe initial *')
                .fill(provisionedPassword);
              await adminPage
                .getByLabel('Confirmer le mot de passe *')
                .fill(provisionedPassword);
              const provisionedResponse = adminPage.waitForResponse(
                (r) =>
                  r.url() === 'http://localhost:3100/users' &&
                  r.request().method() === 'POST',
              );
              await adminPage
                .getByRole('button', { name: 'Créer le compte RESEARCHER' })
                .click();
              const provisioned = await provisionedResponse;
              assert.equal(provisioned.status(), 201);
              const newUser = await provisioned.json();
              assert.equal(newUser.role, 'RESEARCHER');
              assert.ok(!Object.hasOwn(newUser, 'passwordHash'));
              assert.ok(!Object.hasOwn(newUser, 'password'));
              actors.provisioned = {
                ...newUser,
                password: provisionedPassword,
              };
              ids.push(newUser.id);
              await expect(
                adminPage.getByLabel('Mot de passe initial *'),
              ).toHaveValue('');
              const provisionedPage = await login('provisioned');
              assert.equal((await http(provisionedPage, '/users')).status, 403);
              report(
                `${viewport.name}: ADMIN provisions RESEARCHER through UI, password cleared, real login succeeds, account administration forbidden to RESEARCHER`,
              );
              const ownerPage = await login('owner');
              await ownerPage
                .getByRole('link', { name: 'Créer un échantillon' })
                .click();
              const reference = `FUNCTIONAL-${randomUUID()}`;
              await ownerPage.getByLabel('Référence *').fill(reference);
              await ownerPage
                .getByLabel('Nom *', { exact: true })
                .fill('Functional flexible film');
              await ownerPage
                .getByLabel('Description', { exact: true })
                .fill('Functional browser fixture');
              const sampleResponsePromise = ownerPage.waitForResponse(
                (r) =>
                  r.url() === 'http://localhost:3100/samples' &&
                  r.request().method() === 'POST',
              );
              await ownerPage
                .getByRole('button', { name: 'Enregistrer l’échantillon' })
                .click();
              const sampleResponse = await sampleResponsePromise;
              assert.equal(sampleResponse.status(), 201);
              const sample = await sampleResponse.json();
              assert.equal(sample.creatorId, actors.owner.id);
              const samplePath = `/samples/${sample.id}`;
              await expect(
                ownerPage.getByRole('heading', {
                  name: sample.name,
                  exact: true,
                }),
              ).toBeVisible();
              await serial(() =>
                tx.fabricationStep.create({
                  data: {
                    sampleId: sample.id,
                    operationName: 'Functional legacy',
                    performedAt: new Date('2026-10-20T08:00:00Z'),
                    parameters: 'Historical power = 120 W',
                    observations: 'Legacy fixture',
                    recordedById: actors.owner.id,
                  },
                }),
              );
              report(
                `${viewport.name}: RESEARCHER login and sample creation with JWT ownership`,
              );

              async function addStep(page, result, localDate, boolean) {
                await page
                  .getByRole('button', {
                    name: 'Enregistrer une étape',
                    exact: true,
                  })
                  .click();
                await page
                  .getByLabel('Type d’opération *')
                  .selectOption(type.id);
                await page.getByLabel('Date de réalisation *').fill(localDate);
                await page.getByLabel('Résultat *').selectOption(result);
                await page.getByLabel('Température (°C) *').fill(precise);
                await page.getByLabel('Gaz *', { exact: true }).fill('Argon');
                await page
                  .getByLabel('Sous vide *')
                  .selectOption(String(boolean));
                await page
                  .getByLabel('Opérateur réel (UUID, facultatif)')
                  .fill(actors.other.id);
                await page
                  .getByLabel('Observations', { exact: true })
                  .fill(`Functional ${result}`);
                const created = page.waitForResponse(
                  (r) =>
                    r.url() === `http://localhost:3100${samplePath}/steps` &&
                    r.request().method() === 'POST',
                );
                await page
                  .getByRole('button', {
                    name: 'Enregistrer l’étape',
                    exact: true,
                  })
                  .click();
                const response = await created;
                assert.equal(response.status(), 201);
                const body = response.request().postDataJSON();
                assert.equal(
                  body.parameterValues.find(
                    (p) => p.definitionId === definitions.number,
                  ).value,
                  precise,
                );
                assert.equal(
                  typeof body.parameterValues.find(
                    (p) => p.definitionId === definitions.number,
                  ).value,
                  'string',
                );
                assert.ok(!Object.hasOwn(body, 'recordedById'));
                await expect(
                  page.getByText('Étape enregistrée.', { exact: true }),
                ).toBeVisible();
                const step = await response.json();
                await expect(
                  page
                    .locator(`.step-history > li`)
                    .filter({ hasText: `Functional ${result}` })
                    .first(),
                ).toBeVisible();
                return step;
              }
              stage = `${viewport.name}: structured steps and history`;
              const success = await addStep(
                ownerPage,
                'SUCCESS',
                '2026-10-29T10:30',
                false,
              );
              assert.equal(success.performedAt, '2026-10-29T09:30:00.000Z');
              const failure = await addStep(
                ownerPage,
                'FAILURE',
                '2026-10-28T10:30',
                true,
              );
              const historyResponse = await http(
                ownerPage,
                `${samplePath}/steps`,
              );
              assert.equal(historyResponse.status, 200);
              const history = historyResponse.body;
              assert.equal(history.length, 3);
              assert.equal(history[0].parameters, 'Historical power = 120 W');
              assert.equal(history[1].id, failure.id);
              assert.equal(history[2].id, success.id);
              assert.equal(success.recordedById, actors.owner.id);
              assert.equal(success.operatorId, actors.other.id);
              assert.equal(
                success.parameterValues.find(
                  (v) => v.definitionId === definitions.boolean,
                ).booleanValue,
                false,
              );
              assert.equal(
                failure.parameterValues.find(
                  (v) => v.definitionId === definitions.boolean,
                ).booleanValue,
                true,
              );
              await serial(async () => {
                const persisted = await tx.stepParameterValue.findFirst({
                  where: {
                    stepId: success.id,
                    definitionId: definitions.number,
                  },
                });
                assert.equal(persisted.numericValue.toFixed(), precise);
                assert.equal(
                  await tx.stepParameterValue.count({
                    where: { stepId: success.id },
                  }),
                  3,
                );
              });
              await expect(ownerPage.locator('.step-history > li')).toHaveCount(
                3,
              );
              await expect(
                ownerPage.locator('.step-history > li').nth(1),
              ).toContainText('Échouée (FAILURE)');
              await expect(
                ownerPage.getByText('Historical power = 120 W', {
                  exact: true,
                }),
              ).toBeVisible();
              assert.equal(
                await ownerPage.evaluate(
                  () =>
                    document.documentElement.scrollWidth <=
                    document.documentElement.clientWidth,
                ),
                true,
              );
              report(
                `${viewport.name}: exact DECIMAL(65,30), TEXT, false/true, SUCCESS/FAILURE, repeated operations, chronological and legacy history`,
              );

              const valid = {
                stepTypeId: type.id,
                performedAt: '2026-10-30T08:00:00Z',
                result: 'SUCCESS',
                parameterValues: [
                  { definitionId: definitions.number, value: '0.125' },
                  { definitionId: definitions.text, value: '' },
                  { definitionId: definitions.boolean, value: false },
                ],
              };
              stage = `${viewport.name}: permission matrix`;
              const otherPage = await login('other');
              await otherPage.goto(`http://localhost:5180${samplePath}`);
              await expect(otherPage.locator('.step-history > li')).toHaveCount(
                3,
              );
              await expect(
                otherPage.getByRole('button', {
                  name: 'Enregistrer une étape',
                  exact: true,
                }),
              ).toHaveCount(0);
              assert.equal(
                (await http(otherPage, `${samplePath}/steps`, 'POST', valid))
                  .status,
                403,
              );
              assert.equal(
                (
                  await http(otherPage, '/step-types', 'POST', {
                    code: randomUUID(),
                    name: 'Forbidden',
                    parameters: [],
                  })
                ).status,
                403,
              );
              assert.equal(
                (
                  await http(
                    ownerPage,
                    `${samplePath}/steps`,
                    'POST',
                    valid,
                    false,
                  )
                ).status,
                401,
              );
              await adminPage.goto(`http://localhost:5180${samplePath}`);
              const adminStep = await addStep(
                adminPage,
                'SUCCESS',
                '2026-10-30T10:30',
                false,
              );
              assert.equal(adminStep.recordedById, actors.admin.id);
              for (const page of [ownerPage, adminPage]) {
                await page.goto(
                  `http://localhost:5180/samples/${abandoned.id}`,
                );
                await expect(
                  page.getByText(/Cet échantillon est abandonné/),
                ).toBeVisible();
                await expect(
                  page.getByRole('button', {
                    name: 'Enregistrer une étape',
                    exact: true,
                  }),
                ).toHaveCount(0);
                assert.equal(
                  (
                    await http(
                      page,
                      `/samples/${abandoned.id}/steps`,
                      'POST',
                      valid,
                    )
                  ).status,
                  409,
                );
              }
              report(
                `${viewport.name}: owner/other RESEARCHER/ADMIN permissions, anonymous 401 and abandoned 409`,
              );

              stage = `${viewport.name}: validation errors and savepoints`;
              const inactive = await http(adminPage, '/step-types', 'POST', {
                code: `INACTIVE-${randomUUID()}`,
                name: 'Inactive fixture',
                parameters: [
                  {
                    key: 'unused_number',
                    name: 'Unused numeric',
                    dataType: 'NUMBER',
                    isRequired: false,
                  },
                ],
              });
              assert.equal(inactive.status, 201);
              assert.equal(
                (
                  await http(
                    adminPage,
                    `/step-types/${inactive.body.id}`,
                    'PATCH',
                    { isActive: false },
                  )
                ).status,
                200,
              );
              assert.equal(
                (
                  await http(ownerPage, `${samplePath}/steps`, 'POST', {
                    ...valid,
                    stepTypeId: inactive.body.id,
                    parameterValues: [],
                  })
                ).status,
                409,
              );
              const beforeErrors = await serial(() =>
                tx.fabricationStep.count({ where: { sampleId: sample.id } }),
              );
              for (const body of [
                { ...valid, recordedById: actors.other.id },
                {
                  ...valid,
                  parameterValues: valid.parameterValues.slice(0, 2),
                },
                {
                  ...valid,
                  parameterValues: [
                    ...valid.parameterValues,
                    valid.parameterValues[0],
                  ],
                },
                {
                  ...valid,
                  parameterValues: [
                    ...valid.parameterValues,
                    { definitionId: randomUUID(), value: 'unknown' },
                  ],
                },
                {
                  ...valid,
                  parameterValues: [
                    { definitionId: definitions.number, value: 1 },
                    ...valid.parameterValues.slice(1),
                  ],
                },
                {
                  ...valid,
                  parameterValues: [
                    { definitionId: definitions.number, value: '1e3' },
                    ...valid.parameterValues.slice(1),
                  ],
                },
                {
                  ...valid,
                  parameterValues: [
                    { definitionId: definitions.number, value: '9'.repeat(36) },
                    ...valid.parameterValues.slice(1),
                  ],
                },
                {
                  ...valid,
                  parameterValues: [
                    ...valid.parameterValues.slice(0, 2),
                    { definitionId: definitions.boolean, value: 'false' },
                  ],
                },
                { ...valid, operatorId: randomUUID() },
              ])
                assert.equal(
                  (await http(ownerPage, `${samplePath}/steps`, 'POST', body))
                    .status,
                  400,
                );
              assert.equal(
                (
                  await http(ownerPage, '/samples', 'POST', {
                    reference,
                    name: 'Duplicate fixture',
                  })
                ).status,
                409,
              );
              assert.equal(
                await serial(() =>
                  tx.fabricationStep.count({ where: { sampleId: sample.id } }),
                ),
                beforeErrors,
              );
              report(
                `${viewport.name}: invalid/missing/unknown/duplicate parameters, JWT author spoofing, operator and reference conflicts rejected without partial writes`,
              );

              stage = `${viewport.name}: actual PostgreSQL failure atomicity`;
              const valuesBefore = await serial(() =>
                tx.stepParameterValue.count(),
              );
              fault = true;
              assert.equal(
                (await http(ownerPage, `${samplePath}/steps`, 'POST', valid))
                  .status,
                500,
              );
              assert.ok(
                sqlFault instanceof Prisma.PrismaClientKnownRequestError,
              );
              assert.equal(
                await serial(() =>
                  tx.fabricationStep.count({ where: { sampleId: sample.id } }),
                ),
                beforeErrors,
              );
              assert.equal(
                await serial(() => tx.stepParameterValue.count()),
                valuesBefore,
              );
              assert.equal(
                (await http(ownerPage, `${samplePath}/steps`)).status,
                200,
              );
              report(
                `${viewport.name}: real SQL constraint failure rolls back step and values; connection remains usable`,
              );

              stage = `${viewport.name}: corrections UI and immutable audit`;
              await ownerPage.goto(`http://localhost:5180${samplePath}`);
              const correctedCard = ownerPage
                .locator('.step-history > li')
                .filter({ hasText: 'Functional SUCCESS' })
                .first();
              await correctedCard
                .getByRole('button', { name: 'Corriger l’étape' })
                .click();
              await correctedCard
                .getByLabel('Motif de correction *')
                .fill('Functional transcription correction');
              await correctedCard
                .getByLabel('Température (°C) *')
                .fill('42.125');
              await correctedCard
                .getByLabel('Observations corrigées')
                .fill('Validated correction');
              const correctionUrl = `${samplePath}/steps/${success.id}/corrections`;
              const correctionResponse = ownerPage.waitForResponse(
                (r) =>
                  r.url() === `http://localhost:3100${correctionUrl}` &&
                  r.request().method() === 'POST',
              );
              await correctedCard
                .getByRole('button', { name: 'Confirmer la correction' })
                .click();
              const correction = await correctionResponse;
              assert.equal(correction.status(), 201);
              assert.equal((await correction.json()).revision, 1);
              const revisedCard = ownerPage
                .locator('.step-history > li')
                .filter({ hasText: 'Validated correction' });
              await expect(
                revisedCard.getByText('42.125', { exact: true }),
              ).toBeVisible();
              await revisedCard
                .getByRole('button', { name: 'Afficher les corrections' })
                .click();
              await expect(
                revisedCard.getByText(
                  'Motif : Functional transcription correction',
                ),
              ).toBeVisible();
              const audit = await http(otherPage, correctionUrl);
              assert.equal(audit.status, 200);
              assert.equal(audit.body.length, 1);
              assert.equal(audit.body[0].correctedById, actors.owner.id);
              assert.equal(
                audit.body[0].beforeSnapshot.parameterValues.find(
                  (v) => v.definitionId === definitions.number,
                ).numericValue,
                precise,
              );
              assert.equal(
                audit.body[0].afterSnapshot.parameterValues.find(
                  (v) => v.definitionId === definitions.number,
                ).numericValue,
                '42.125',
              );
              assert.equal(
                (
                  await http(otherPage, correctionUrl, 'POST', {
                    expectedRevision: 1,
                    reason: 'Forbidden',
                    observations: 'X',
                  })
                ).status,
                403,
              );
              assert.equal(
                (
                  await http(ownerPage, correctionUrl, 'POST', {
                    expectedRevision: 0,
                    reason: 'Stale',
                    observations: 'X',
                  })
                ).status,
                409,
              );
              auditFault = true;
              assert.equal(
                (
                  await http(ownerPage, correctionUrl, 'POST', {
                    expectedRevision: 1,
                    reason: 'Rollback audit test',
                    observations: 'Must roll back',
                  })
                ).status,
                500,
              );
              const afterAuditFailure = await http(
                ownerPage,
                `${samplePath}/steps`,
              );
              const unchanged = afterAuditFailure.body.find(
                (step) => step.id === success.id,
              );
              assert.equal(unchanged.revision, 1);
              assert.equal(unchanged.observations, 'Validated correction');
              assert.equal(
                (await http(ownerPage, correctionUrl)).body.length,
                1,
              );
              report(
                `${viewport.name}: correction UI, exact before/after audit, stale revision 409, unauthorized 403 and SQL audit failure atomicity`,
              );

              stage = `${viewport.name}: numeric search UI`;
              assert.equal(
                (
                  await http(adminPage, `/step-types/${type.id}`, 'PATCH', {
                    isActive: false,
                  })
                ).status,
                200,
              );
              const searchable = await http(
                ownerPage,
                '/samples/numeric-parameters',
              );
              assert.equal(searchable.status, 200);
              assert.ok(
                searchable.body.some(
                  (definition) =>
                    definition.id === definitions.number &&
                    definition.stepType.isActive === false,
                ),
              );
              assert.ok(
                !searchable.body.some(
                  (definition) => definition.stepType.id === inactive.body.id,
                ),
              );
              assert.equal(
                (
                  await http(ownerPage, correctionUrl, 'POST', {
                    expectedRevision: 1,
                    reason: 'Correction of archived operation',
                    observations: 'Archived operation correction',
                  })
                ).status,
                201,
              );
              await ownerPage.goto('http://localhost:5180/samples');
              await ownerPage
                .getByRole('button', { name: 'Recherche par paramètres' })
                .click();
              await ownerPage
                .getByLabel('Définition du paramètre')
                .selectOption(definitions.number);
              await ownerPage.getByLabel('Valeur minimale').fill('42.125');
              await ownerPage.getByLabel('Valeur maximale').fill('42.125');
              const firstSearch = ownerPage.waitForResponse((r) => {
                const url = new URL(r.url());
                return (
                  url.pathname === '/samples' &&
                  url.searchParams.get('min') === '42.125' &&
                  url.searchParams.get('max') === '42.125'
                );
              });
              await ownerPage
                .getByRole('button', { name: 'Rechercher', exact: true })
                .click();
              const firstSearchResponse = await firstSearch;
              assert.equal(firstSearchResponse.status(), 200);
              assert.equal((await firstSearchResponse.json()).length, 1);
              await expect(
                ownerPage.getByRole('link', { name: sample.name, exact: true }),
              ).toBeVisible();
              await ownerPage.getByLabel('Valeur minimale').fill('42.126');
              await ownerPage.getByLabel('Valeur maximale').fill('42.126');
              const secondSearch = ownerPage.waitForResponse((r) => {
                const url = new URL(r.url());
                return (
                  url.pathname === '/samples' &&
                  url.searchParams.get('min') === '42.126' &&
                  url.searchParams.get('max') === '42.126'
                );
              });
              await ownerPage
                .getByRole('button', { name: 'Rechercher', exact: true })
                .click();
              const secondSearchResponse = await secondSearch;
              assert.equal(secondSearchResponse.status(), 200);
              assert.equal((await secondSearchResponse.json()).length, 0);
              await expect(
                ownerPage.getByRole('heading', { name: 'Aucun résultat' }),
              ).toBeVisible();
              assert.equal(
                (
                  await http(adminPage, `/step-types/${type.id}`, 'PATCH', {
                    isActive: true,
                  })
                ).status,
                200,
              );
              const singleton = await http(ownerPage, '/samples', 'POST', {
                reference: `SINGLE-${randomUUID()}`,
                name: 'Single-value fixture',
              });
              assert.equal(singleton.status, 201);
              const singleStep = await http(
                ownerPage,
                `/samples/${singleton.body.id}/steps`,
                'POST',
                {
                  ...valid,
                  parameterValues: valid.parameterValues.map((value) =>
                    value.definitionId === definitions.number
                      ? { ...value, value: '5' }
                      : value,
                  ),
                },
              );
              assert.equal(singleStep.status, 201);
              assert.equal(
                (
                  await http(
                    ownerPage,
                    `/samples/${singleton.body.id}/steps/${singleStep.body.id}/corrections`,
                    'POST',
                    {
                      expectedRevision: 0,
                      reason: 'Search current values',
                      parameterValues: valid.parameterValues.map((value) =>
                        value.definitionId === definitions.number
                          ? { ...value, value: '7' }
                          : value,
                      ),
                    },
                  )
                ).status,
                201,
              );
              assert.equal(
                (
                  await http(
                    ownerPage,
                    `/samples?parameterDefinitionId=${definitions.number}&min=5&max=5`,
                  )
                ).body.length,
                0,
              );
              const currentMatch = await http(
                ownerPage,
                `/samples?parameterDefinitionId=${definitions.number}&min=7&max=7`,
              );
              assert.equal(currentMatch.body[0].id, singleton.body.id);
              report(
                `${viewport.name}: inclusive numeric search through React; SQL searches current values and excludes old audit snapshots`,
              );

              stage = `${viewport.name}: abandon and reactivate UI`;
              await ownerPage.goto(`http://localhost:5180${samplePath}`);
              const historyCount = (
                await http(ownerPage, `${samplePath}/steps`)
              ).body.length;
              await ownerPage
                .getByRole('button', { name: 'Abandonner l’échantillon' })
                .click();
              await ownerPage
                .getByRole('button', { name: 'Confirmer l’abandon' })
                .click();
              await expect(
                ownerPage.getByRole('button', {
                  name: 'Réactiver l’échantillon',
                }),
              ).toBeVisible();
              await expect(
                ownerPage.getByRole('button', {
                  name: 'Enregistrer une étape',
                  exact: true,
                }),
              ).toHaveCount(0);
              assert.equal(
                (await http(ownerPage, `${samplePath}/steps`, 'POST', valid))
                  .status,
                409,
              );
              assert.equal(
                (
                  await http(otherPage, `${samplePath}/status`, 'PATCH', {
                    status: 'ACTIVE',
                  })
                ).status,
                403,
              );
              await ownerPage
                .getByRole('button', { name: 'Réactiver l’échantillon' })
                .click();
              await ownerPage
                .getByRole('button', { name: 'Confirmer la réactivation' })
                .click();
              await expect(
                ownerPage.getByRole('button', {
                  name: 'Enregistrer une étape',
                  exact: true,
                }),
              ).toBeVisible();
              assert.equal(
                (await http(ownerPage, `${samplePath}/steps`)).body.length,
                historyCount,
              );
              assert.equal(
                (await http(ownerPage, `${samplePath}/steps`, 'POST', valid))
                  .status,
                201,
              );
              assert.equal(
                (await http(ownerPage, `${samplePath}/steps`)).body.length,
                historyCount + 1,
              );
              report(
                `${viewport.name}: abandon/reactivate confirmation, ownership guards, steps blocked while abandoned and complete history preserved`,
              );

              stage = `${viewport.name}: logout and network isolation`;
              await ownerPage
                .getByRole('button', { name: 'Se déconnecter', exact: true })
                .click();
              await expect(
                ownerPage.getByRole('heading', {
                  name: 'Connexion',
                  exact: true,
                }),
              ).toBeVisible();
              assert.equal(
                await ownerPage.evaluate(() =>
                  sessionStorage.getItem('labo.session'),
                ),
                null,
              );
              assert.equal(forbiddenNetwork, false);
              await bounded(queue);
              if (isolationFailure) throw isolationFailure;
              report(
                `${viewport.name}: logout, exclusive test HTTP ports and transaction isolation maintained`,
              );
            } catch (error) {
              failures.push(error);
            } finally {
              const cleanup = await Promise.allSettled([
                bounded(browser ? browser.close() : Promise.resolve()),
                bounded(
                  (async () => {
                    if (vite && vite.exitCode === null) {
                      const exited = new Promise((resolve) =>
                        vite.once('exit', resolve),
                      );
                      vite.kill();
                      await exited;
                    }
                  })(),
                ),
                bounded(app ? app.close() : Promise.resolve()),
              ]);
              const settledQueue = await Promise.allSettled([bounded(queue)]);
              for (const result of [...cleanup, ...settledQueue])
                if (result.status === 'rejected') failures.push(result.reason);
            }
            if (failures.length)
              throw new AggregateError(
                failures,
                'Functional scenario or cleanup failed',
              );
            // Never return normally: even a successful scenario MUST roll back.
            throw rollback;
          },
          { isolationLevel: 'Serializable', timeout: 180000, maxWait: 5000 },
        );
        assert.fail('Fixture transaction unexpectedly committed');
      } catch (error) {
        if (error !== rollback) throw error;
      }
      stage = `${viewport.name}: rollback verification`;
      assert.deepEqual(await snapshot(), baseline);
      assert.equal(await prisma.user.count({ where: { id: { in: ids } } }), 0);
      await closedPort(3100);
      await closedPort(5180);
      report(
        `${viewport.name}: rollback verified, all 9 table fingerprints unchanged, temporary users absent, test servers stopped`,
      );
    }
  } finally {
    try {
      if (baseline) {
        assert.deepEqual(await snapshot(), baseline);
        console.log(
          'CLEANUP VERIFIED: all 9 test-table fingerprints match the original baseline, including after any scenario failure.',
        );
      }
    } finally {
      await prisma.$disconnect();
    }
    assert.deepEqual(dockerState(), originalDocker);
    await closedPort(3100);
    await closedPort(5180);
  }
  console.log(
    `SUCCESS: ${checks} checkpoints. Only labo_echantillons_test connected; Docker containers unchanged. No fixtures persisted.`,
  );
}

main().catch((error) => {
  let detail = [
    error.stack || String(error),
    ...(error.errors || []).map((item) => item.stack || String(item)),
  ].join('\n');
  for (const secret of secrets
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    detail = detail.split(secret).join('[REDACTED]');
  console.error(`FAIL during ${stage}:\n${detail}`);
  process.exitCode = 1;
});
