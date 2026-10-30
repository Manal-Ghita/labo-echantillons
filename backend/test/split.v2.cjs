const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { runV2HttpTest } = require('./support/v2-http-transaction.cjs');

runV2HttpTest('lineage', async ({ tx, app, actors, http, pass }) => {
  const reference = () => `S_${randomUUID()}`;
  const batch = await tx.batch.create({
    data: { reference: `B_${randomUUID()}`, createdById: actors.owner },
  });
  const parent = await tx.sample.create({
    data: {
      reference: reference(),
      name: 'Capteur PET parent synthétique',
      creatorId: actors.owner,
      status: 'ACTIVE',
      batchId: batch.id,
    },
  });
  const type = await tx.stepType.create({
    data: { code: `D_${randomUUID()}`, name: 'Découpe synthétique' },
  });
  const step = await tx.fabricationStep.create({
    data: {
      sampleId: parent.id,
      operationName: type.name,
      stepTypeId: type.id,
      performedAt: new Date('2026-10-30T10:00:00Z'),
      result: 'SUCCESS',
      parameters: 'Support PET',
      observations: 'Historique parent conservé',
      recordedById: actors.owner,
      operatorId: actors.other,
      revision: 1,
    },
  });
  await tx.stepCorrection.create({
    data: {
      stepId: step.id,
      revision: 1,
      correctedById: actors.owner,
      reason: 'Correction synthétique antérieure',
      beforeSnapshot: {},
      afterSnapshot: {},
    },
  });
  const historyBefore = JSON.stringify(
    await tx.fabricationStep.findUnique({
      where: { id: step.id },
      include: { parameterValues: true, corrections: true },
    }),
  );
  const body = {
    originStepId: step.id,
    children: [
      { reference: reference(), name: 'Film gauche' },
      {
        reference: reference(),
        name: 'Film droit',
        description: 'Capteur souple',
      },
    ],
  };
  const url = `/samples/${parent.id}/split`;
  await request(app.getHttpServer()).post(url).send(body).expect(401);
  await http('post', url, 'other', body).expect(403);
  assert.equal(await tx.sample.count({ where: { parentId: parent.id } }), 0);
  pass('anonymous 401 and other researcher 403; no children created');
  const children = (await http('post', url, 'owner', body).expect(201)).body;
  assert.equal(children.length, 2);
  assert.notEqual(children[0].id, children[1].id);
  for (const child of children) {
    assert.equal(child.parentId, parent.id);
    assert.equal(child.originStepId, step.id);
    assert.equal(child.creatorId, actors.owner);
    assert.equal(child.status, 'ACTIVE');
    assert.equal(child.batchId, null);
    assert.notEqual(child.id, parent.id);
    assert.equal(
      await tx.fabricationStep.count({ where: { sampleId: child.id } }),
      0,
    );
  }
  assert.deepEqual(
    await tx.sample.findUnique({ where: { id: parent.id } }),
    parent,
  );
  assert.equal(
    JSON.stringify(
      await tx.fabricationStep.findUnique({
        where: { id: step.id },
        include: { parameterValues: true, corrections: true },
      }),
    ),
    historyBefore,
  );
  pass(
    'distinct children, explicit links; parent status/dates/batch/history/audit unchanged; no copied steps or lot',
  );
  const parentView = (
    await http('get', `/samples/${parent.id}`, 'other').expect(200)
  ).body;
  assert.equal(parentView.children.length, 2);
  const childView = (
    await http('get', `/samples/${children[0].id}`, 'other').expect(200)
  ).body;
  assert.equal(childView.parent.id, parent.id);
  assert.equal(childView.originStep.id, step.id);
  assert.deepEqual(
    (await http('get', `/samples/${children[0].id}/steps`, 'other').expect(200))
      .body,
    [],
  );
  pass(
    'global authenticated consultation exposes parent/children/origin and independent empty histories',
  );
  const adminChild = (
    await http('post', url, 'admin', {
      children: [{ reference: reference(), name: 'Partie administrative' }],
    }).expect(201)
  ).body[0];
  assert.equal(adminChild.creatorId, actors.admin);
  assert.equal(adminChild.parentId, parent.id);
  const grandchild = (
    await http('post', `/samples/${children[0].id}/split`, 'owner', {
      children: [{ reference: reference(), name: 'Partie secondaire' }],
    }).expect(201)
  ).body[0];
  assert.equal(grandchild.parentId, children[0].id);
  assert.notEqual(grandchild.parentId, parent.id);
  pass(
    'ADMIN uses own authenticated identity; multigeneration lineage remains explicit',
  );
  const foreign = await tx.sample.create({
    data: {
      reference: reference(),
      name: 'Autre parent',
      creatorId: actors.other,
    },
  });
  const foreignStep = await tx.fabricationStep.create({
    data: {
      sampleId: foreign.id,
      operationName: 'Autre opération',
      performedAt: new Date(),
      recordedById: actors.other,
    },
  });
  const count = await tx.sample.count();
  await http('post', url, 'owner', {
    ...body,
    originStepId: foreignStep.id,
  }).expect(400);
  await http('post', url, 'owner', {
    ...body,
    originStepId: randomUUID(),
  }).expect(404);
  await http('post', `/samples/${children[0].id}/split`, 'owner', body).expect(
    400,
  );
  await http('post', url, 'owner', {
    children: [
      {
        id: parent.id,
        parentId: children[0].id,
        reference: reference(),
        name: 'Cycle interdit',
      },
    ],
  }).expect(400);
  assert.equal(await tx.sample.count(), count);
  pass(
    'foreign/missing origin and client-supplied UUID/parent forbidden before writes',
  );
  const firstReference = reference();
  await http('post', url, 'owner', {
    children: [
      { reference: firstReference, name: 'Doit être annulé' },
      { reference: children[0].reference, name: 'Doublon existant' },
    ],
  }).expect(409);
  assert.equal(await tx.sample.count(), count);
  assert.equal(
    await tx.sample.findUnique({ where: { reference: firstReference } }),
    null,
  );
  pass(
    'actual SQL uniqueness failure on second insert rolls back the first child',
  );
  await tx.$executeRawUnsafe('SAVEPOINT synthetic_ancestry');
  const ancestor = await tx.sample.create({
    data: {
      reference: reference(),
      name: 'Ancêtre synthétique',
      creatorId: actors.owner,
      parentId: parent.id,
    },
  });
  await tx.sample.update({
    where: { id: parent.id },
    data: { parentId: ancestor.id },
  });
  await http('post', url, 'owner', {
    children: [{ reference: reference(), name: 'Refus du cycle existant' }],
  }).expect(409);
  assert.equal(await tx.sample.count(), count + 1);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT synthetic_ancestry');
  await tx.$executeRawUnsafe('RELEASE SAVEPOINT synthetic_ancestry');
  assert.deepEqual(
    await tx.sample.findUnique({ where: { id: parent.id } }),
    parent,
  );
  pass(
    'existing cyclic ancestry refused; temporary malformed fixture rolled back',
  );
  await tx.sample.update({
    where: { id: parent.id },
    data: { status: 'ABANDONED' },
  });
  await http('post', url, 'owner', {
    children: [{ reference: reference(), name: 'Filiation rétrospective' }],
  }).expect(201);
  assert.equal(
    (await tx.sample.findUnique({ where: { id: parent.id } })).status,
    'ABANDONED',
  );
  await http('post', `/samples/${parent.id}/steps`, 'owner', {
    stepTypeId: type.id,
    performedAt: '2026-10-30T12:00:00Z',
    result: 'SUCCESS',
    parameterValues: [],
  }).expect(409);
  pass(
    'retrospective links do not reactivate parent or bypass abandoned-step protection',
  );
}).catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : 'V2 lineage integration failed; credentials withheld.',
  );
  process.exitCode = 1;
});
