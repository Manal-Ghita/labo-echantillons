const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { runV2HttpTest } = require('./support/v2-http-transaction.cjs');

runV2HttpTest('advanced-search', async ({ tx, actors, http, pass }) => {
  const marker = `ADV_${randomUUID()}`;
  const lotA = await tx.batch.create({
    data: { reference: `A_${randomUUID()}`, createdById: actors.owner },
  });
  const lotB = await tx.batch.create({
    data: { reference: `B_${randomUUID()}`, createdById: actors.owner },
  });
  const anneal = await tx.stepType.create({
    data: {
      code: `R_${randomUUID()}`,
      name: 'Recuit synthétique',
      parameters: {
        create: [
          {
            key: 'temperature',
            name: 'Température',
            dataType: 'NUMBER',
            unit: '°C',
            isRequired: true,
          },
          {
            key: 'duration',
            name: 'Durée',
            dataType: 'NUMBER',
            unit: 'min',
            isRequired: true,
          },
          {
            key: 'material',
            name: 'Matériau',
            dataType: 'TEXT',
            isRequired: false,
          },
        ],
      },
    },
    include: { parameters: true },
  });
  const temp = anneal.parameters.find((d) => d.key === 'temperature').id;
  const duration = anneal.parameters.find((d) => d.key === 'duration').id;
  const text = anneal.parameters.find((d) => d.key === 'material').id;
  const depot = await tx.stepType.create({
    data: { code: `D_${randomUUID()}`, name: 'Dépôt synthétique' },
  });
  const archived = await tx.stepType.create({
    data: {
      code: `H_${randomUUID()}`,
      name: 'Recuit historique',
      isActive: false,
    },
  });
  const unused = await tx.stepType.create({
    data: {
      code: `U_${randomUUID()}`,
      name: 'Inactif sans historique',
      isActive: false,
    },
  });
  async function sample(label, status = 'ACTIVE', batchId = lotA.id) {
    return tx.sample.create({
      data: {
        reference: `S_${randomUUID()}`,
        name: `${marker} ${label}`,
        creatorId: actors.owner,
        status,
        batchId,
      },
    });
  }
  async function step(sampleId, temperature, minutes, result = 'SUCCESS') {
    return tx.fabricationStep.create({
      data: {
        sampleId,
        stepTypeId: anneal.id,
        operationName: anneal.name,
        performedAt: new Date(),
        recordedById: actors.owner,
        result,
        parameterValues: {
          create: [
            { definitionId: temp, numericValue: temperature },
            { definitionId: duration, numericValue: minutes },
          ],
        },
      },
    });
  }
  const all = await sample('même étape');
  await step(all.id, '150', '20');
  await step(all.id, '120', '10');
  const separated = await sample('étapes différentes');
  await step(separated.id, '150', '5');
  await step(separated.id, '120', '20');
  const cross = await sample('types différents');
  await step(cross.id, '150', '5');
  await tx.fabricationStep.create({
    data: {
      sampleId: cross.id,
      stepTypeId: depot.id,
      operationName: depot.name,
      performedAt: new Date(),
      recordedById: actors.owner,
    },
  });
  const abandoned = await sample('abandonné', 'ABANDONED');
  await step(abandoned.id, '150', '20', 'FAILURE');
  const otherLot = await sample('autre lot', 'ACTIVE', lotB.id);
  await step(otherLot.id, '150', '20');
  const empty = await sample('sans étape', 'ACTIVE', null);
  const unspecified = await sample('statut historique', null, null);
  const preciseA = '150.' + '0'.repeat(29) + '1',
    preciseB = '150.' + '0'.repeat(29) + '2';
  const highA = await sample('précision A');
  await step(highA.id, preciseA, '20');
  const highB = await sample('précision B');
  await step(highB.id, preciseB, '20');
  const corrected = await sample('corrigé');
  const old = await step(corrected.id, '149', '20');
  await http(
    'post',
    `/samples/${corrected.id}/steps/${old.id}/corrections`,
    'owner',
    {
      reason: 'Valeur courante corrigée',
      expectedRevision: 0,
      parameterValues: [
        { definitionId: temp, value: '150' },
        { definitionId: duration, value: '20' },
      ],
    },
  ).expect(201);
  const history = await sample('type archivé');
  await tx.fabricationStep.create({
    data: {
      sampleId: history.id,
      stepTypeId: archived.id,
      operationName: archived.name,
      performedAt: new Date(),
      recordedById: actors.owner,
    },
  });
  const search = async (fields) =>
    (
      await http(
        'get',
        '/samples?' + new URLSearchParams({ q: marker, ...fields }).toString(),
        'other',
      ).expect(200)
    ).body
      .map((s) => s.id)
      .sort((a, b) => String(a).localeCompare(String(b)));
  const numbers = (filters) => JSON.stringify(filters);
  const pair = numbers([
    { parameterDefinitionId: temp, eq: '150' },
    { parameterDefinitionId: duration, min: '20', max: '20' },
  ]);
  const base = {
    status: 'ACTIVE',
    batchId: lotA.id,
    stepTypeId: anneal.id,
    numericFilters: pair,
  };
  assert.deepEqual(
    await search({ ...base, matchMode: 'SAME_STEP' }),
    [all.id, corrected.id].sort((a, b) => String(a).localeCompare(String(b))),
  );
  assert.deepEqual(
    await search({ ...base, matchMode: 'ANY_STEP' }),
    [all.id, separated.id, corrected.id].sort((a, b) =>
      String(a).localeCompare(String(b)),
    ),
  );
  pass(
    'AND on text/status/lot/type/numbers distinguishes same realization from separate realizations',
  );
  const differentTypes = {
    stepTypeId: depot.id,
    numericFilters: numbers([{ parameterDefinitionId: temp, eq: '150' }]),
  };
  assert.deepEqual(await search({ ...differentTypes, matchMode: 'ANY_STEP' }), [
    cross.id,
  ]);
  assert.deepEqual(
    await search({ ...differentTypes, matchMode: 'SAME_STEP' }),
    [],
  );
  pass('operation type participates in the selected step scope');
  const repeated = numbers([
    { parameterDefinitionId: temp, eq: '120' },
    { parameterDefinitionId: temp, eq: '150' },
  ]);
  assert.deepEqual(
    await search({ numericFilters: repeated, matchMode: 'ANY_STEP' }),
    [all.id, separated.id].sort((a, b) => String(a).localeCompare(String(b))),
  );
  assert.deepEqual(
    await search({ numericFilters: repeated, matchMode: 'SAME_STEP' }),
    [],
  );
  pass(
    'repeated parameter criteria remain separate; no unintended merging across steps',
  );
  assert.deepEqual(
    await search({
      numericFilters: numbers([{ parameterDefinitionId: temp, eq: preciseA }]),
    }),
    [highA.id],
  );
  assert.deepEqual(
    await search({
      numericFilters: numbers([
        { parameterDefinitionId: temp, min: preciseA, max: preciseB },
      ]),
    }),
    [highA.id, highB.id].sort((a, b) => String(a).localeCompare(String(b))),
  );
  pass(
    'PostgreSQL distinguishes decimal values differing in their 30th fractional digit, inclusive bounds',
  );
  const exact = await search({
    parameterDefinitionId: temp,
    min: '150',
    max: '150',
  });
  assert.deepEqual(
    exact,
    [
      all.id,
      separated.id,
      cross.id,
      abandoned.id,
      otherLot.id,
      corrected.id,
    ].sort((a, b) => String(a).localeCompare(String(b))),
  );
  assert.deepEqual(
    await search({ parameterDefinitionId: temp, min: '149', max: '149' }),
    [],
  );
  assert.deepEqual(
    await search({
      status: 'ABANDONED',
      numericFilters: numbers([
        { parameterDefinitionId: temp, min: '150', max: '150' },
      ]),
    }),
    [abandoned.id],
  );
  pass(
    'legacy exact search preserved; current corrected values only; FAILURE and abandoned samples retained',
  );
  assert.ok((await search({ status: 'ACTIVE' })).includes(empty.id));
  assert.deepEqual(await search({ status: 'UNSPECIFIED' }), [unspecified.id]);
  assert.deepEqual(await search({ stepTypeId: archived.id }), [history.id]);
  const options = (
    await http('get', '/samples/search-operation-types', 'other').expect(200)
  ).body;
  assert.ok(options.some((t) => t.id === archived.id));
  assert.ok(!options.some((t) => t.id === unused.id));
  assert.ok(
    options.every(
      (t) =>
        Object.keys(t)
          .sort((a, b) => String(a).localeCompare(String(b)))
          .join(',') === 'code,id,isActive,name',
    ),
  );
  pass(
    'samples without steps, unspecified status and used archived operations remain searchable',
  );
  assert.deepEqual(await search({ q: all.reference.toLowerCase() }), [all.id]);
  const combined = await search({
    parameterDefinitionId: temp,
    min: '150',
    max: '150',
    numericFilters: numbers([{ parameterDefinitionId: duration, eq: '20' }]),
    matchMode: 'SAME_STEP',
    status: 'ACTIVE',
    batchId: lotA.id,
  });
  assert.deepEqual(
    combined,
    [all.id, corrected.id].sort((a, b) => String(a).localeCompare(String(b))),
  );
  pass(
    'reference search and legacy/new criteria combine without changing compatibility',
  );
  for (const filters of [
    [{ parameterDefinitionId: temp, eq: 150 }],
    [{ parameterDefinitionId: text, eq: '150' }],
    [{ parameterDefinitionId: temp, min: '151', max: '150' }],
    Array.from({ length: 11 }, () => ({
      parameterDefinitionId: temp,
      eq: '150',
    })),
  ])
    await http(
      'get',
      '/samples?' +
        new URLSearchParams({
          numericFilters: JSON.stringify(filters),
        }).toString(),
      'other',
    ).expect(400);
  pass(
    'invalid numeric types, non-NUMBER definitions, inverted intervals and excess filters rejected',
  );
}).catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : 'V2 advanced search integration failed; credentials withheld.',
  );
  process.exitCode = 1;
});
