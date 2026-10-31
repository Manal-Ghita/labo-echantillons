const assert = require('node:assert/strict');
const { mkdtemp, readdir, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const join = (...parts) => path.join(...parts);
const crypto = require('node:crypto');
const randomUUID = () => crypto.randomUUID();
const createHash = (algorithm) => crypto.createHash(algorithm);
const request = require('supertest');
const { runV2HttpTest } = require('./support/v2-http-transaction.cjs');

async function run() {
  const directory = await mkdtemp(join(tmpdir(), 'limsv2-attachments-pg-'));
  const old = process.env.ATTACHMENT_STORAGE_DIR;
  process.env.ATTACHMENT_STORAGE_DIR = directory;
  try {
    await runV2HttpTest(
      'attachments',
      async ({ tx, app, actors, http, pass }) => {
        const prefix = randomUUID();
        const sample = await tx.sample.create({
          data: {
            reference: prefix,
            name: 'Synthetic flexible PET sensor',
            creatorId: actors.owner,
            status: 'ACTIVE',
          },
        });
        const other = await tx.sample.create({
          data: {
            reference: `${prefix}-other`,
            name: 'Other synthetic sensor',
            creatorId: actors.other,
          },
        });
        const step = await tx.fabricationStep.create({
          data: {
            sampleId: sample.id,
            operationName: 'Synthetic measurement',
            performedAt: new Date(),
            recordedById: actors.owner,
            parameters: 'historic text retained',
            result: 'FAILURE',
          },
        });
        const route = `/samples/${sample.id}/files`,
          stepRoute = `/samples/${sample.id}/steps/${step.id}/files`;
        const buffer = Buffer.from(
          'time;value\n0;120.123456789012345678901234567890\n',
        );
        const upload = (
          path,
          role = 'owner',
          name = 'measure.csv',
          data = buffer,
          type = 'text/csv',
        ) =>
          http('post', path, role).attach('file', data, {
            filename: name,
            contentType: type,
          });
        const created = await upload(route).expect(201);
        const meta = await tx.attachment.findUniqueOrThrow({
          where: { id: created.body.id },
        });
        assert.equal(meta.sampleId, sample.id);
        assert.equal(meta.stepId, null);
        assert.equal(meta.createdById, actors.owner);
        assert.equal(meta.size, buffer.length);
        assert.equal(
          meta.sha256,
          createHash('sha256').update(buffer).digest('hex'),
        );
        assert.deepEqual(
          await readFile(join(directory, meta.storageKey)),
          buffer,
        );
        assert.ok(!JSON.stringify(created.body).includes(meta.storageKey));
        assert.deepEqual(Object.keys(created.body.createdBy).sort(), [
          'id',
          'name',
        ]);
        pass(
          'real multipart HTTP upload, metadata, JWT author, SHA-256 and exact CSV bytes stored privately',
        );

        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64',
        );
        const onStep = await upload(
          stepRoute,
          'owner',
          'photo.png',
          png,
          'image/png',
        ).expect(201);
        assert.equal(onStep.body.stepId, step.id);
        await upload(
          route,
          'admin',
          'report.pdf',
          Buffer.from('%PDF-1.7\n%%EOF'),
          'application/pdf',
        ).expect(201);
        await upload(
          route,
          'owner',
          'photo.jpg',
          Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]),
          'image/jpeg',
        ).expect(201);
        pass(
          'PNG attached to the actual step; PDF and JPEG supported; ADMIN can upload on another owner’s sample',
        );

        assert.equal(
          (await http('get', route, 'other').expect(200)).body.length,
          3,
        );
        assert.equal(
          (await http('get', stepRoute, 'other').expect(200)).body.length,
          1,
        );
        const downloaded = await http(
          'get',
          `/files/${created.body.id}/download`,
          'other',
        ).expect(200);
        assert.equal(downloaded.text, buffer.toString());
        assert.match(downloaded.headers['content-disposition'], /^attachment;/);
        assert.equal(downloaded.headers['x-content-type-options'], 'nosniff');
        pass(
          'all authenticated researchers can list and download, sample/step lists stay separate',
        );

        await request(app.getHttpServer()).get(route).expect(401);
        await request(app.getHttpServer())
          .get(`/files/${created.body.id}/download`)
          .expect(401);
        await request(app.getHttpServer())
          .post(route)
          .attach('file', buffer, 'measure.csv')
          .expect(401);
        const before = await readdir(directory);
        await upload(route, 'other').expect(403);
        await upload(
          `/samples/${other.id}/steps/${step.id}/files`,
          'admin',
        ).expect(404);
        await upload(`/samples/${randomUUID()}/files`).expect(404);
        assert.deepEqual(await readdir(directory), before);
        pass(
          'missing JWT, other researcher, absent sample and mismatched step rejected without filesystem writes',
        );

        await upload(route, 'owner', 'fake.png').expect(415);
        await upload(route, 'owner', 'bad.csv', Buffer.from([0, 255])).expect(
          415,
        );
        await upload(route, 'owner', 'empty.csv', Buffer.alloc(0)).expect(400);
        await upload(
          route,
          'owner',
          'big.csv',
          Buffer.alloc(10485761, 65),
        ).expect(413);
        await http('post', route)
          .field('createdById', actors.admin)
          .attach('file', buffer, 'measure.csv')
          .expect(400);
        assert.deepEqual(await readdir(directory), before);
        pass(
          'forged formats, binary CSV, empty/oversized uploads and forged author fields rejected',
        );

        await tx.$executeRawUnsafe(
          `CREATE FUNCTION pg_temp.reject_test_attachment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."originalName" = 'fail.csv' THEN RAISE EXCEPTION 'synthetic metadata failure'; END IF; RETURN NEW; END; $$`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TRIGGER synthetic_attachment_failure BEFORE INSERT ON "Attachment" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_test_attachment()`,
        );
        const count = await tx.attachment.count();
        await upload(route, 'owner', 'fail.csv').expect(500);
        assert.equal(await tx.attachment.count(), count);
        assert.deepEqual(await readdir(directory), before);
        pass(
          'real database failure rolls metadata back and compensates the newly written file',
        );

        async function constraint(sql) {
          await tx.$executeRawUnsafe('SAVEPOINT attachment_constraint');
          let rejected = false;
          try {
            await sql();
          } catch {
            rejected = true;
          }
          await tx.$executeRawUnsafe(
            'ROLLBACK TO SAVEPOINT attachment_constraint',
          );
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT attachment_constraint');
          assert.ok(rejected, 'SQL constraint must reject the statement');
        }
        await constraint(() =>
          tx.attachment.update({ where: { id: meta.id }, data: { size: 0 } }),
        );
        await constraint(() =>
          tx.attachment.update({
            where: { id: meta.id },
            data: { mimeType: 'text/html' },
          }),
        );
        await constraint(() =>
          tx.attachment.update({
            where: { id: meta.id },
            data: { sha256: 'bad' },
          }),
        );
        await constraint(() =>
          tx.attachment.update({
            where: { id: meta.id },
            data: { stepId: step.id, sampleId: other.id },
          }),
        );
        await constraint(() =>
          tx.fabricationStep.update({
            where: { id: step.id },
            data: { sampleId: other.id },
          }),
        );
        await constraint(() => tx.sample.delete({ where: { id: sample.id } }));
        pass(
          'SQL checks, association triggers and restrictive foreign keys protect metadata and histories',
        );
      const indexes = await tx.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='Attachment'`;
      assert.equal(indexes.length, 5);
      const triggers = await tx.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgname IN ('Attachment_sample_step_check', 'FabricationStep_attachment_sample_check')`;
      assert.equal(triggers.length, 2);
      pass('five attachment indexes and both association triggers verified in PostgreSQL catalogs');

        await tx.sample.update({
          where: { id: sample.id },
          data: { status: 'ABANDONED' },
        });
        await upload(route, 'owner', 'retrospective.csv').expect(201);
        const preserved = await tx.fabricationStep.findUniqueOrThrow({
          where: { id: step.id },
        });
        assert.equal(preserved.parameters, 'historic text retained');
        assert.equal(preserved.result, 'FAILURE');
        pass(
          'retrospective documents permitted without adding an operation or changing existing history',
        );

        await rm(join(directory, meta.storageKey));
        await http('get', `/files/${meta.id}/download`).expect(503);
        await http('get', `/files/${randomUUID()}/download`).expect(404);
        pass(
          'missing bytes are reported without deleting metadata; absent attachment returns 404',
        );
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (old === undefined) delete process.env.ATTACHMENT_STORAGE_DIR;
    else process.env.ATTACHMENT_STORAGE_DIR = old;
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
