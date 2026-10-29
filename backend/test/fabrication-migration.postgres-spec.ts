import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PasswordService } from '../src/auth/password.service';
import { PrismaClient } from '../src/generated/prisma/client';

// Explicit PostgreSQL suite: requires an authorized, existing, empty test database.
// Never creates/drops a database, resets a schema, or connects to DATABASE_URL.
describe('Migration fabrication sur PostgreSQL dédié', () => {
  let sql: Client;
  let prisma: PrismaClient;
  let ready = false;
  const owner = randomUUID();
  const sample = randomUUID();
  const legacyStep = randomUUID();
  const type = randomUUID();
  const step = randomUUID();
  const definitions = {
    number: randomUUID(),
    text: randomUUID(),
    boolean: randomUUID(),
  };
  const backend = resolve(__dirname, '..');

  function migrate(config: string, connectionString: string) {
    const result = spawnSync(
      process.execPath,
      [
        resolve(backend, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        config,
      ],
      {
        cwd: backend,
        env: {
          ...process.env,
          DATABASE_URL: connectionString,
          TEST_DATABASE_URL: connectionString,
          CHECKPOINT_DISABLE: '1',
        },
        encoding: 'utf8',
        timeout: 60000,
      },
    );
    // Do not print captured CLI output: it may contain connection details.
    if (result.status !== 0)
      throw new Error(
        `Migration de test échouée (code ${result.status ?? 'timeout'}).`,
      );
  }

  beforeAll(async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    if (!connectionString)
      throw new Error(
        'TEST_DATABASE_URL obligatoire ; aucune connexion par défaut.',
      );
    let url: URL;
    try {
      url = new URL(connectionString);
    } catch {
      throw new Error('TEST_DATABASE_URL invalide (valeur masquée).');
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    if (
      !name.endsWith('_test') ||
      name === 'labo_echantillons' ||
      ![null, 'public'].includes(url.searchParams.get('schema'))
    ) {
      throw new Error(
        'Base de test dédiée terminant par _test requise, schéma public uniquement.',
      );
    }
    sql = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    await sql.connect();
    const actual = await sql.query<{ name: string }>(
      'SELECT current_database() AS name',
    );
    if (actual.rows[0].name !== name)
      throw new Error('Base connectée différente de la cible.');
    const tables = await sql.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    );
    if (tables.rowCount !== 0)
      throw new Error(
        'Base de test non vide : arrêt sans nettoyage automatique.',
      );

    const scratchRoot = resolve(backend, '.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(resolve(scratchRoot, 'fabrication-migration-'));
    const initial = resolve(scratch, 'migrations/20261028000000_init');
    mkdirSync(initial, { recursive: true });
    copyFileSync(
      resolve(backend, 'prisma/migrations/20261028000000_init/migration.sql'),
      resolve(initial, 'migration.sql'),
    );
    copyFileSync(
      resolve(backend, 'prisma/migrations/migration_lock.toml'),
      resolve(scratch, 'migrations/migration_lock.toml'),
    );
    const config = resolve(scratch, 'prisma.config.cjs');
    writeFileSync(
      config,
      `module.exports = require('prisma/config').defineConfig({ schema: ${JSON.stringify(resolve(backend, 'prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(resolve(scratch, 'migrations'))} }, datasource: { url: process.env.TEST_DATABASE_URL } });\n`,
    );
    migrate(config, connectionString);

    // These three fixtures intentionally survive the second migration.
    const passwordHash = await new PasswordService().hash(randomUUID());
    await sql.query(
      'INSERT INTO "User" (id,name,email,"passwordHash",role) VALUES ($1,$2,$3,$4,$5)',
      [
        owner,
        'Migration test',
        `migration-${owner}@example.test`,
        passwordHash,
        'RESEARCHER',
      ],
    );
    await sql.query(
      'INSERT INTO "Sample" (id,reference,name,"creatorId","updatedAt") VALUES ($1,$2,$3,$4,$5)',
      [
        sample,
        `LEGACY-${sample}`,
        'Historical sample',
        owner,
        new Date('2026-01-02T12:00:00Z'),
      ],
    );
    await sql.query(
      'INSERT INTO "FabricationStep" (id,"sampleId","operationName","performedAt",parameters,observations,"recordedById","recordedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        legacyStep,
        sample,
        'Historical deposition',
        new Date('2026-01-01T10:00:00Z'),
        'temperature=120 C; duration=300 s',
        'Historical observation',
        owner,
        new Date('2026-01-02T12:00:00Z'),
      ],
    );

    migrate(resolve(backend, 'prisma.config.ts'), connectionString);
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        connectionTimeoutMillis: 5000,
      }),
    });
    await prisma.$connect();
    ready = true;
  }, 150000);

  beforeEach(async () => {
    if (!ready) throw new Error('Préparation PostgreSQL incomplète.');
    await sql.query('BEGIN');
    await sql.query('INSERT INTO "StepType" (id,code,name) VALUES ($1,$2,$3)', [
      type,
      `TYPE-${type}`,
      'Test operation',
    ]);
    for (const [key, id] of Object.entries(definitions)) {
      const dataType =
        key === 'number' ? 'NUMBER' : key === 'text' ? 'TEXT' : 'BOOLEAN';
      await sql.query(
        'INSERT INTO "ParameterDefinition" (id,"stepTypeId",key,name,"dataType","isRequired") VALUES ($1,$2,$3,$3,$4,true)',
        [id, type, key, dataType],
      );
    }
    await sql.query(
      'INSERT INTO "FabricationStep" (id,"sampleId","operationName","performedAt","recordedById","stepTypeId",result) VALUES ($1,$2,$3,now(),$4,$5,$6)',
      [step, sample, 'Test operation', owner, type, 'SUCCESS'],
    );
  });
  afterEach(async () => {
    if (sql && ready) await sql.query('ROLLBACK');
  });
  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (sql) await sql.end();
  });

  async function rejected(
    statement: string,
    params: unknown[],
    code: string,
    constraint?: string,
  ) {
    await sql.query('SAVEPOINT constraint_probe');
    let failure: { code?: string; constraint?: string } | undefined;
    try {
      await sql.query(statement, params);
    } catch (error) {
      failure = error as typeof failure;
    } finally {
      await sql.query('ROLLBACK TO SAVEPOINT constraint_probe');
      await sql.query('RELEASE SAVEPOINT constraint_probe');
    }
    expect(failure?.code).toBe(code);
    if (constraint) expect(failure?.constraint).toBe(constraint);
  }

  const valueSql =
    'INSERT INTO "StepParameterValue" (id,"stepId","definitionId","numericValue","textValue","booleanValue") VALUES ($1,$2,$3,$4,$5,$6)';
  const correctionSql =
    'INSERT INTO "StepCorrection" (id,"stepId",revision,"correctedById",reason,"beforeSnapshot","afterSnapshot") VALUES ($1,$2,$3,$4,$5,$6,$7)';

  it('applique exactement les deux migrations et crée les cinq tables', async () => {
    const migrations = await sql.query(
      'SELECT migration_name, finished_at IS NOT NULL AS finished FROM "_prisma_migrations" ORDER BY migration_name',
    );
    expect(migrations.rows).toEqual([
      { migration_name: '20261028000000_init', finished: true },
      {
        migration_name: '20261029000000_fabrication_structure',
        finished: true,
      },
    ]);
    const tables = await sql.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    );
    for (const table of [
      'Batch',
      'StepType',
      'ParameterDefinition',
      'StepParameterValue',
      'StepCorrection',
    ]) {
      expect(
        tables.rows.map((row: { tablename: string }) => row.tablename),
      ).toContain(table);
    }
  });

  it('crée les index et valide les CHECK et les clés étrangères sans cascade', async () => {
    const indexes = await sql.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public'",
    );
    for (const name of [
      'Batch_reference_key',
      'Batch_createdById_idx',
      'StepType_code_key',
      'ParameterDefinition_stepTypeId_key_key',
      'StepParameterValue_definitionId_numericValue_idx',
      'StepParameterValue_stepId_definitionId_key',
      'StepCorrection_correctedById_correctedAt_idx',
      'StepCorrection_stepId_revision_key',
      'Sample_batchId_idx',
      'Sample_parentId_idx',
      'Sample_originStepId_idx',
      'Sample_status_idx',
      'FabricationStep_stepTypeId_performedAt_idx',
      'FabricationStep_operatorId_idx',
    ]) {
      expect(
        indexes.rows.map((row: { indexname: string }) => row.indexname),
      ).toContain(name);
    }
    const constraints = await sql.query(
      "SELECT contype, convalidated, confdeltype FROM pg_constraint WHERE connamespace='public'::regnamespace",
    );
    expect(
      constraints.rows.filter(
        (row: { contype: string }) => row.contype === 'c',
      ),
    ).toHaveLength(8);
    const fks = constraints.rows.filter(
      (row: { contype: string }) => row.contype === 'f',
    );
    expect(fks).toHaveLength(14);
    expect(
      fks.every(
        (row: { confdeltype: string; convalidated: boolean }) =>
          row.confdeltype === 'r' && row.convalidated,
      ),
    ).toBe(true);
    expect(
      constraints.rows.every(
        (row: { convalidated: boolean }) => row.convalidated,
      ),
    ).toBe(true);
  });

  it('préserve intégralement une étape de l’ancien modèle', async () => {
    const historical = await prisma.fabricationStep.findUniqueOrThrow({
      where: { id: legacyStep },
    });
    expect(historical).toMatchObject({
      operationName: 'Historical deposition',
      parameters: 'temperature=120 C; duration=300 s',
      observations: 'Historical observation',
      recordedById: owner,
      revision: 0,
      stepTypeId: null,
      operatorId: null,
      result: null,
    });
    expect(historical.performedAt.toISOString()).toBe(
      '2026-01-01T10:00:00.000Z',
    );
    expect(historical.recordedAt.toISOString()).toBe(
      '2026-01-02T12:00:00.000Z',
    );
    const oldSample = await prisma.sample.findUniqueOrThrow({
      where: { id: sample },
    });
    expect(oldSample).toMatchObject({
      creatorId: owner,
      batchId: null,
      parentId: null,
      originStepId: null,
      status: null,
    });
  });

  it.each([
    [null, null, null],
    ['12', 'text', null],
    ['12', null, true],
    [null, 'text', false],
  ])(
    'refuse une absence ou plusieurs valeurs : %j',
    async (number, text, boolean) => {
      await rejected(
        valueSql,
        [randomUUID(), step, definitions.number, number, text, boolean],
        '23514',
        'StepParameterValue_exactly_one_value_check',
      );
    },
  );
  it('refuse NaN', async () => {
    await rejected(
      valueSql,
      [randomUUID(), step, definitions.number, 'NaN', null, null],
      '23514',
      'StepParameterValue_finite_numeric_check',
    );
  });
  it('accepte zéro, false et le texte vide comme valeurs présentes', async () => {
    await sql.query(valueSql, [
      randomUUID(),
      step,
      definitions.number,
      '0',
      null,
      null,
    ]);
    await sql.query(valueSql, [
      randomUUID(),
      step,
      definitions.boolean,
      null,
      null,
      false,
    ]);
    await sql.query(valueSql, [
      randomUUID(),
      step,
      definitions.text,
      null,
      '',
      null,
    ]);
  });
  it('refuse l’auto-parenté et une origine sans parent', async () => {
    await rejected(
      'UPDATE "Sample" SET "parentId"=id WHERE id=$1',
      [sample],
      '23514',
      'Sample_parent_not_self_check',
    );
    await rejected(
      'UPDATE "Sample" SET "originStepId"=$1 WHERE id=$2',
      [legacyStep, sample],
      '23514',
      'Sample_origin_requires_parent_check',
    );
  });
  it('refuse les révisions invalides, les motifs blancs et les snapshots non objets', async () => {
    await rejected(
      'UPDATE "FabricationStep" SET revision=-1 WHERE id=$1',
      [step],
      '23514',
      'FabricationStep_revision_nonnegative_check',
    );
    await rejected(
      correctionSql,
      [randomUUID(), step, 0, owner, 'Reason', '{}', '{}'],
      '23514',
      'StepCorrection_revision_positive_check',
    );
    await rejected(
      correctionSql,
      [randomUUID(), step, 1, owner, ' \t\n ', '{}', '{}'],
      '23514',
      'StepCorrection_reason_not_blank_check',
    );
    await rejected(
      correctionSql,
      [randomUUID(), step, 1, owner, 'Reason', '[]', '{}'],
      '23514',
      'StepCorrection_snapshot_objects_check',
    );
  });
  it('refuse les références orphelines et les doublons', async () => {
    await rejected(
      valueSql,
      [randomUUID(), randomUUID(), definitions.number, '1', null, null],
      '23503',
    );
    await rejected(
      'INSERT INTO "StepType" (id,code,name) VALUES ($1,$2,$3)',
      [randomUUID(), `TYPE-${type}`, 'Duplicate'],
      '23505',
    );
    await sql.query(valueSql, [
      randomUUID(),
      step,
      definitions.number,
      '1',
      null,
      null,
    ]);
    await rejected(
      valueSql,
      [randomUUID(), step, definitions.number, '2', null, null],
      '23505',
    );
    await sql.query(correctionSql, [
      randomUUID(),
      step,
      1,
      owner,
      'Reason',
      '{}',
      '{}',
    ]);
    await rejected(
      correctionSql,
      [randomUUID(), step, 1, owner, 'Reason', '{}', '{}'],
      '23505',
    );
  });

  it('utilise le client Prisma régénéré et recherche une valeur décimale sans perte', async () => {
    const rollback = new Error('Rollback Prisma test');
    await expect(
      prisma.$transaction(async (tx) => {
        const catalog = await tx.stepType.create({
          data: {
            code: `PRISMA-${randomUUID()}`,
            name: 'Prisma operation',
            parameters: {
              create: {
                key: 'temperature',
                name: 'Temperature',
                dataType: 'NUMBER',
                unit: 'C',
                isRequired: true,
              },
            },
          },
          include: { parameters: true },
        });
        const created = await tx.fabricationStep.create({
          data: {
            sampleId: sample,
            operationName: catalog.name,
            performedAt: new Date(),
            recordedById: owner,
            stepTypeId: catalog.id,
            result: 'FAILURE',
            parameterValues: {
              create: {
                definitionId: catalog.parameters[0].id,
                numericValue: '120.1234567890123456789',
              },
            },
          },
          include: { parameterValues: true },
        });
        const found = await tx.stepParameterValue.findMany({
          where: {
            definitionId: catalog.parameters[0].id,
            numericValue: { gte: '120', lt: '121' },
          },
        });
        expect(found).toHaveLength(1);
        expect(found[0].numericValue?.toString()).toBe(
          '120.1234567890123456789',
        );
        expect(created.result).toBe('FAILURE');
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
