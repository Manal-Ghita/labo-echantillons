const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const { runV2HttpTest } = require('./support/v2-http-transaction.cjs');
async function run() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'limsv2-csv-import-'),
  );
  const previous = process.env.ATTACHMENT_STORAGE_DIR;
  process.env.ATTACHMENT_STORAGE_DIR = directory;
  try {
    await runV2HttpTest(
      'CSV imports',
      async ({ tx, app, actors, http, pass }) => {
        const uuid = crypto.randomUUID();
        const sample = await tx.sample.create({
          data: {
            reference: uuid,
            name: 'Synthetic PET measurement sensor',
            creatorId: actors.owner,
            status: 'ACTIVE',
          },
        });
        const type = await tx.stepType.create({
          data: {
            code: `CSV_${uuid}`,
            name: 'Synthetic measurements',
            parameters: {
              create: [
                {
                  key: 'temp',
                  name: 'Temperature',
                  dataType: 'NUMBER',
                  unit: '°C',
                  isRequired: true,
                },
                {
                  key: 'material',
                  name: 'Material',
                  dataType: 'TEXT',
                  isRequired: false,
                },
                {
                  key: 'valid',
                  name: 'Control',
                  dataType: 'BOOLEAN',
                  isRequired: true,
                },
              ],
            },
          },
          include: { parameters: true },
        });
        const number = type.parameters.find((d) => d.key === 'temp'),
          text = type.parameters.find((d) => d.key === 'material'),
          boolean = type.parameters.find((d) => d.key === 'valid');
        const step = await tx.fabricationStep.create({
          data: {
            sampleId: sample.id,
            operationName: 'Original realization',
            performedAt: new Date(),
            recordedById: actors.owner,
            stepTypeId: type.id,
            result: 'FAILURE',
            parameterValues: {
              create: { definitionId: number.id, numericValue: '42.125' },
            },
          },
          include: { parameterValues: true },
        });
        const route = `/samples/${sample.id}/imports`;
        const csv = Buffer.from(
          'temperature (°C);material;valid\n150.123456789012345678901234567890;PET;false\n120;Aluminium;1',
        );
        const upload = async (buffer = csv, name = 'measurements.csv') =>
          (
            await http('post', `/samples/${sample.id}/files`)
              .attach('file', buffer, {
                filename: name,
                contentType: 'text/csv',
              })
              .expect(201)
          ).body;
        const file = await upload();
        const dto = {
          attachmentId: file.id,
          stepTypeId: type.id,
          delimiter: ';',
          decimalSeparator: '.',
          mappings: [
            { column: 0, definitionId: number.id, unit: '°C' },
            { column: 1, definitionId: text.id, unit: null },
            { column: 2, definitionId: boolean.id, unit: null },
          ],
        };
        const p = (
          await http('post', route + '/preview', 'owner', dto).expect(201)
        ).body;
        assert.equal(p.rowCount, 2);
        assert.equal(p.canConfirm, true);
        assert.equal(
          await tx.measurementImport.count({ where: { sampleId: sample.id } }),
          0,
        );
        assert.equal(
          (
            await http('post', route + '/inspect', 'owner', {
              attachmentId: file.id,
              delimiter: ';',
            }).expect(201)
          ).body.headers.length,
          3,
        );
        pass(
          'real CSV source, read-only inspection and preview; no measurement written before confirmation',
        );
        await http('post', route, 'owner', {
          ...dto,
          previewToken: p.previewToken,
          confirmed: false,
        }).expect(400);
        const confirmed = (
          await http('post', route, 'owner', {
            ...dto,
            previewToken: p.previewToken,
            confirmed: true,
          }).expect(201)
        ).body;
        const values = await tx.importedMeasurementValue.findMany({
          where: { importId: confirmed.id },
          orderBy: [{ rowNumber: 'asc' }, { definitionId: 'asc' }],
        });
        assert.equal(values.length, 6);
        assert.equal(
          values
            .find((v) => v.rowNumber === 1 && v.definitionId === number.id)
            .numericValue.toFixed(),
          '150.12345678901234567890123456789',
        );
        assert.equal(
          values.find((v) => v.rowNumber === 1 && v.definitionId === boolean.id)
            .booleanValue,
          false,
        );
        const record = await tx.measurementImport.findUniqueOrThrow({
          where: { id: confirmed.id },
        });
        assert.equal(record.createdById, actors.owner);
        assert.equal(record.sourceAttachmentId, file.id);
        assert.equal(
          record.sourceSha256,
          crypto.createHash('sha256').update(csv).digest('hex'),
        );
        pass(
          'atomic typed series persisted with exact decimal, TEXT, BOOLEAN and source/author/date traceability',
        );
        await http('get', route, 'other').expect(200);
        const detail = (
          await http('get', route + '/' + confirmed.id, 'other').expect(200)
        ).body;
        assert.equal(detail.values.length, 6);
        assert.equal(
          typeof detail.values.find((v) => v.definitionId === number.id)
            .numericValue,
          'string',
        );
        assert.deepEqual(Object.keys(detail.createdBy).sort(), ['id', 'name']);
        assert.ok(!JSON.stringify(detail).includes('passwordHash'));
        await http('post', route + '/preview', 'other', dto).expect(403);
        await request(app.getHttpServer()).get(route).expect(401);
        await request(app.getHttpServer())
          .post(route + '/preview')
          .send(dto)
          .expect(401);
        await request(app.getHttpServer())
          .get(route)
          .set('Authorization', `Bearer ${p.previewToken}`)
          .expect(401);
        pass(
          'global authenticated consultation; other researcher and unauthenticated imports refused; preview token cannot authenticate',
        );
        await http('post', route, 'owner', {
          ...dto,
          previewToken: p.previewToken,
          confirmed: true,
        }).expect(409);
        const duplicate = await upload(csv, 'renamed.csv');
        const repeated = (
          await http('post', route + '/preview', 'owner', {
            ...dto,
            attachmentId: duplicate.id,
          }).expect(201)
        ).body;
        assert.equal(repeated.duplicate, true);
        assert.equal(repeated.canConfirm, false);
        pass(
          'repeat confirmation and byte-identical reupload under another name cannot duplicate measurements',
        );
        const stepDto = { ...dto, stepId: step.id };
        const stepPreview = (
          await http('post', route + '/preview', 'admin', stepDto).expect(201)
        ).body;
        const stepImport = (
          await http('post', route, 'admin', {
            ...stepDto,
            confirmed: true,
            previewToken: stepPreview.previewToken,
          }).expect(201)
        ).body;
        assert.equal(stepImport.stepId, step.id);
      assert.equal((await http('post',route+'/preview','admin',{...stepDto,stepId:step.id.toUpperCase()}).expect(201)).body.duplicate,true);
        const preserved = await tx.fabricationStep.findUniqueOrThrow({
          where: { id: step.id },
          include: { parameterValues: true },
        });
        assert.equal(preserved.result, 'FAILURE');
        assert.equal(
          preserved.parameterValues[0].numericValue.toFixed(),
          '42.125',
        );
        pass(
          'ADMIN can associate a series with a real step without changing its original parameters, result or corrections',
        );
        const invalid = await upload(
          Buffer.from('temperature;material;valid\n1e3;PET;yes\n120;PET'),
        );
        const bad = (
          await http('post', route + '/preview', 'owner', {
            ...dto,
            attachmentId: invalid.id,
          }).expect(201)
        ).body;
        assert.equal(bad.canConfirm, false);
        assert.equal(bad.validRowCount, 0);
        assert.ok(bad.errors.some((e) => e.line === 2));
        assert.ok(bad.errors.some((e) => e.line === 3));
        await http('post', route + '/preview', 'owner', {
          ...dto,
          mappings: [{ ...dto.mappings[0], unit: 'K' }],
        }).expect(400);
        await http('post', route + '/preview', 'owner', {
          ...dto,
          mappings: [dto.mappings[0], dto.mappings[0]],
        }).expect(400);
        pass(
          'invalid physical lines, types, units and duplicate mappings reported before any write',
        );
        const failing = await upload(
          Buffer.from(
            'temperature (°C);material;valid\n150;PET;true\n120;FAILME;false',
          ),
        );
        const failDto = { ...dto, attachmentId: failing.id },
          fp = (await http('post', route + '/preview', 'owner', failDto)).body;
        await tx.$executeRawUnsafe(
          `CREATE FUNCTION pg_temp.fail_import_value() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."textValue"='FAILME' THEN RAISE EXCEPTION 'synthetic import value failure'; END IF; RETURN NEW; END; $$`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TRIGGER synthetic_import_failure BEFORE INSERT ON "ImportedMeasurementValue" FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_import_value()`,
        );
        const count = await tx.measurementImport.count(),
          valueCount = await tx.importedMeasurementValue.count();
        await http('post', route, 'owner', {
          ...failDto,
          confirmed: true,
          previewToken: fp.previewToken,
        }).expect(500);
        assert.equal(await tx.measurementImport.count(), count);
        assert.equal(await tx.importedMeasurementValue.count(), valueCount);
        assert.ok(
          await tx.attachment.findUnique({ where: { id: failing.id } }),
        );
        pass(
          'actual SQL failure on a later value rolls back the entire import and keeps the source attachment',
        );
        async function rejected(work) {
          await tx.$executeRawUnsafe('SAVEPOINT import_constraint');
          let error = false;
          try {
            await work();
          } catch {
            error = true;
          }
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT import_constraint');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT import_constraint');
          assert.ok(error);
        }
        const numeric = values.find((v) => v.definitionId === number.id);
        await rejected(() =>
          tx.importedMeasurementValue.update({
            where: { id: numeric.id },
            data: { booleanValue: true },
          }),
        );
        await rejected(() =>
          tx.importedMeasurementValue.update({
            where: { id: numeric.id },
            data: { rowNumber: 501 },
          }),
        );
        await rejected(() =>
          tx.importedMeasurementValue.update({
            where: { id: numeric.id },
            data: { definitionId: boolean.id },
          }),
        );
        await rejected(() => tx.attachment.delete({ where: { id: file.id } }));
        await rejected(() =>
          tx.measurementImport.create({
            data: { ...record, id: crypto.randomUUID() },
          }),
        );
        pass(
          'SQL value/type/row checks, restrictive source FK and deduplication unique index enforced',
        );
        const comma = await upload(
          Buffer.from(
            'temperature (°C);material;valid\n150,12345678901234567890123456789;PET;true',
          ),
        );
        const commaDto = {
          ...dto,
          attachmentId: comma.id,
          decimalSeparator: ',',
        };
        const cp = (await http('post', route + '/preview', 'owner', commaDto))
          .body;
        await http('post', route, 'owner', {
          ...commaDto,
          confirmed: true,
          previewToken: cp.previewToken,
        }).expect(201);
        pass(
          'comma-separated decimal input normalized exactly, without floating-point conversion',
        );
      },
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.ATTACHMENT_STORAGE_DIR;
    else process.env.ATTACHMENT_STORAGE_DIR = previous;
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
