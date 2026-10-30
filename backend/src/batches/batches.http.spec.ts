import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { BatchesModule } from './batches.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  createStepInput,
  fabricationMock,
  stepIds,
} from '../../test/support/fabrication-steps.fixture';
import { Prisma } from '../generated/prisma/client';

const batchId = '3deeffc4-a338-416b-af8d-a3c1cfe0e838';
const secondId = 'f25dd475-83ce-47d7-8538-d2c53fcfcb4e';
function context() {
  const fixture = fabricationMock();
  const records = [stepIds.sample, secondId].map((id) => ({
    id,
    creatorId: stepIds.owner,
    status: 'ACTIVE',
    batchId: batchId as string | null,
  }));
  const batch = {
    id: batchId,
    reference: 'LOT-01',
    createdById: stepIds.owner,
  };
  const batches = {
    findUnique: jest.fn().mockResolvedValue(batch),
    findMany: jest.fn().mockResolvedValue([batch]),
    create: jest.fn().mockResolvedValue(batch),
  };
  const sample = {
    ...fixture.tx.sample,
    findMany: jest.fn().mockResolvedValue(records),
    updateMany: jest.fn().mockResolvedValue({ count: 2 }),
  };
  sample.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(records.find((r) => r.id === where.id) ?? null),
  );
  const tx = { ...fixture.tx, batch: batches, sample };
  const prisma = {
    ...fixture.prisma,
    batch: batches,
    sample,
    $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  return { prisma, tx, records, batch };
}

describe('Lots HTTP : JWT réels et Prisma simulé', () => {
  let app: INestApplication;
  let fixture = context();
  const prisma = fixture.prisma;
  let tokens: Record<string, string>;
  const previous = process.env.JWT_SECRET;
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64url');
    const module = await Test.createTestingModule({ imports: [BatchesModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    await app.init();
    const jwt = module.get(JwtService);
    tokens = Object.fromEntries(
      await Promise.all(
        ['owner', 'other', 'admin'].map(async (key) => [
          key,
          await jwt.signAsync({
            sub: stepIds[key as 'owner' | 'admin' | 'other'],
            authVersion: 0,
          }),
        ]),
      ),
    );
  });
  beforeEach(() => {
    fixture = context();
    Object.assign(prisma, fixture.prisma);
  });
  afterAll(async () => {
    await app?.close();
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  const group = () => ({
    operation: createStepInput(),
    samples: [
      { sampleId: stepIds.sample, result: 'SUCCESS' },
      { sampleId: secondId, result: 'FAILURE' },
    ],
  });
  const auth = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  it.each(['/batches', `/batches/${batchId}`])(
    'refuse %s sans JWT',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
    },
  );
  it.each(['owner', 'other', 'admin'])(
    'autorise %s à consulter les lots',
    async (role) => {
      await request(app.getHttpServer())
        .get('/batches')
        .set(auth(role))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/batches/${batchId}`)
        .set(auth(role))
        .expect(200);
    },
  );
  it('crée avec auteur JWT et traduit un conflit de référence', async () => {
    await request(app.getHttpServer())
      .post('/batches')
      .set(auth('owner'))
      .send({ reference: ' LOT-01 ' })
      .expect(201);
    expect(fixture.prisma.batch.create.mock.calls[0][0]).toMatchObject({
      data: { reference: 'LOT-01', createdById: stepIds.owner },
    });
    fixture.prisma.batch.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );
    await request(app.getHttpServer())
      .post('/batches')
      .set(auth('owner'))
      .send({ reference: 'LOT-01' })
      .expect(409);
  });
  it.each([
    { reference: '' },
    { reference: 'X', createdById: stepIds.other },
    { reference: 42 },
  ])('rejette une création invalide %j', async (body) => {
    await request(app.getHttpServer())
      .post('/batches')
      .set(auth('owner'))
      .send(body)
      .expect(400);
    expect(fixture.prisma.batch.create).not.toHaveBeenCalled();
  });
  it.each(['owner', 'admin'])(
    'associe pour %s sans déplacer un autre lot',
    async (role) => {
      fixture.records.forEach((sample) => {
        sample.batchId = null;
      });
      await request(app.getHttpServer())
        .post(`/batches/${batchId}/samples`)
        .set(auth(role))
        .send({ sampleIds: [stepIds.sample, secondId] })
        .expect(201);
      expect(fixture.tx.sample.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [stepIds.sample, secondId].sort() } },
        data: { batchId },
      });
      fixture.records[1].batchId = stepIds.type;
      fixture.tx.sample.updateMany.mockClear();
      await request(app.getHttpServer())
        .post(`/batches/${batchId}/samples`)
        .set(auth(role))
        .send({ sampleIds: [stepIds.sample, secondId] })
        .expect(409);
      expect(fixture.tx.sample.updateMany).not.toHaveBeenCalled();
    },
  );
  it('une association déjà présente ne modifie pas les dates des échantillons', async () => {
    await request(app.getHttpServer())
      .post(`/batches/${batchId}/samples`)
      .set(auth('owner'))
      .send({ sampleIds: [stepIds.sample, secondId] })
      .expect(201, { attached: 0 });
    expect(fixture.tx.sample.updateMany).not.toHaveBeenCalled();
  });
  it('refuse le lot ou les échantillons d’autrui', async () => {
    const url = `/batches/${batchId}/samples`;
    await request(app.getHttpServer())
      .post(url)
      .set(auth('other'))
      .send({ sampleIds: [stepIds.sample, secondId] })
      .expect(403);
    fixture.records[1].creatorId = stepIds.other;
    await request(app.getHttpServer())
      .post(url)
      .set(auth('owner'))
      .send({ sampleIds: [stepIds.sample, secondId] })
      .expect(403);
    expect(fixture.tx.sample.updateMany).not.toHaveBeenCalled();
  });
  it.each(
    [[], [stepIds.sample, stepIds.sample.toUpperCase()], ['bad'], [null]].map(
      (sampleIds) => ({ sampleIds }),
    ),
  )('valide la sélection %j', async ({ sampleIds }) => {
    await request(app.getHttpServer())
      .post(`/batches/${batchId}/samples`)
      .set(auth('owner'))
      .send({ sampleIds })
      .expect(400);
  });
  it.each(['owner', 'admin'])(
    'crée pour %s deux réalisations distinctes avec résultats et paramètres exacts',
    async (role) => {
      const response = await request(app.getHttpServer())
        .post(`/batches/${batchId}/steps`)
        .set(auth(role))
        .send(group())
        .expect(201);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).not.toBe(response.body[1].id);
      expect(response.body.map((s: { result: string }) => s.result)).toEqual([
        'SUCCESS',
        'FAILURE',
      ]);
      expect(response.body[0].recordedById).toBe(
        stepIds[role as 'owner' | 'admin'],
      );
      expect(response.body[0].parameterValues[0].numericValue).toBe(
        createStepInput().parameterValues[0].value,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['ABANDONED', 'foreign', 'outside', 'missing'])(
    'refuse un membre %s',
    async (state) => {
      if (state === 'ABANDONED') fixture.records[1].status = 'ABANDONED';
      if (state === 'foreign') fixture.records[1].creatorId = stepIds.other;
      if (state === 'outside') fixture.records[1].batchId = stepIds.type;
      if (state === 'missing') fixture.records.pop();
      await request(app.getHttpServer())
        .post(`/batches/${batchId}/steps`)
        .set(auth('owner'))
        .send(group())
        .expect(state === 'foreign' ? 403 : state === 'missing' ? 404 : 409);
    },
  );
  it.each([
    {},
    { operation: null, samples: [] },
    { ...group(), samples: [] },
    { ...group(), samples: [{ sampleId: 42, result: 'SUCCESS' }] },
    { ...group(), samples: [{ sampleId: secondId, result: 'INVALID' }] },
    {
      ...group(),
      samples: [
        { sampleId: secondId, result: 'SUCCESS' },
        { sampleId: secondId.toUpperCase(), result: 'FAILURE' },
      ],
    },
    { ...group(), recordedById: stepIds.other },
    {
      ...group(),
      operation: {
        ...createStepInput(),
        parameterValues: [{ definitionId: stepIds.number, value: 150 }],
      },
    },
  ])('rejette une saisie groupée invalide (%#)', async (body) => {
    await request(app.getHttpServer())
      .post(`/batches/${batchId}/steps`)
      .set(auth('owner'))
      .send(body)
      .expect(400);
  });
  it('renvoie 404 pour un lot absent', async () => {
    fixture.prisma.batch.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/batches/${batchId}`)
      .set(auth('other'))
      .expect(404);
  });
});
