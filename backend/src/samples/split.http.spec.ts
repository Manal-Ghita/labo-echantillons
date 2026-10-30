import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { SamplesModule } from './samples.module';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  fabricationMock,
  stepIds,
} from '../../test/support/fabrication-steps.fixture';

const ancestorId = 'a25dd475-83ce-47d7-8538-d2c53fcfcb4e';
const originId = 'ceae0b43-b7c7-4a59-9101-e0749bf7b875';
function context() {
  const fixture = fabricationMock();
  const parent = {
    id: stepIds.sample,
    reference: 'K24-017',
    name: 'Film parent',
    creatorId: stepIds.owner,
    status: 'ACTIVE',
    parentId: null as string | null,
    batchId: stepIds.type,
  };
  const ancestor = { ...parent, id: ancestorId };
  const sample = {
    findUnique: jest
      .fn()
      .mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === parent.id
            ? parent
            : where.id === ancestorId
              ? ancestor
              : null,
        ),
      ),
    create: jest
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: randomUUID(), ...data }),
      ),
    update: jest.fn(),
  };
  const fabricationStep = {
    findUnique: jest.fn().mockResolvedValue({ sampleId: parent.id }),
  };
  const tx = { sample, fabricationStep };
  const prisma = {
    ...fixture.prisma,
    sample,
    $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  return { parent, ancestor, prisma, tx };
}

describe('Découpe et filiation HTTP, vrais guards et Prisma simulé', () => {
  let fixture = context();
  const prisma = fixture.prisma;
  let app: INestApplication, tokens: Record<string, string>;
  const oldSecret = process.env.JWT_SECRET;
  const url = `/samples/${stepIds.sample}/split`;
  const input = () => ({
    children: [
      { reference: 'K24-018', name: 'Film gauche' },
      {
        reference: 'K24-019',
        name: 'Film droit',
        description: 'Capteur imprimé',
      },
    ],
  });
  const auth = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64url');
    const module = await Test.createTestingModule({ imports: [SamplesModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    await app.init();
    const jwt = module.get(JwtService);
    tokens = Object.fromEntries(
      await Promise.all(
        ['owner', 'admin', 'other'].map(async (role) => [
          role,
          await jwt.signAsync({
            sub: stepIds[role as 'owner' | 'admin' | 'other'],
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
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });

  it.each(['owner', 'admin'])(
    'crée pour %s des enfants indépendants avec auteur JWT, sans modifier le parent',
    async (role) => {
      const before = { ...fixture.parent };
      const response = await request(app.getHttpServer())
        .post(url)
        .set(auth(role))
        .send({ ...input(), originStepId: originId })
        .expect(201);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).not.toBe(response.body[1].id);
      for (const child of response.body) {
        expect(child.parentId).toBe(stepIds.sample);
        expect(child.creatorId).toBe(stepIds[role as 'owner' | 'admin']);
        expect(child.originStepId).toBe(originId);
        expect(child.status).toBe('ACTIVE');
        expect(child).not.toHaveProperty('steps');
        expect(child).not.toHaveProperty('batchId');
      }
      expect(fixture.parent).toEqual(before);
      expect(fixture.tx.sample.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
        timeout: 15000,
      });
    },
  );
  it('ne requiert pas d’étape d’origine et normalise les espaces comme la création individuelle', async () => {
    await request(app.getHttpServer())
      .post(url)
      .set(auth('owner'))
      .send({ children: [{ reference: ' K24-018 ', name: ' Film ' }] })
      .expect(201);
    expect(fixture.tx.sample.create.mock.calls[0][0].data).toMatchObject({
      reference: 'K24-018',
      name: 'Film',
    });
    expect(fixture.tx.fabricationStep.findUnique).not.toHaveBeenCalled();
  });
  it('consigne une filiation rétrospective sans réactiver un parent abandonné', async () => {
    fixture.parent.status = 'ABANDONED';
    await request(app.getHttpServer())
      .post(url)
      .set(auth('owner'))
      .send(input())
      .expect(201);
    expect(fixture.parent.status).toBe('ABANDONED');
    expect(fixture.tx.sample.update).not.toHaveBeenCalled();
  });
  it('refuse les personnes non authentifiées et un autre chercheur', async () => {
    await request(app.getHttpServer()).post(url).send(input()).expect(401);
    await request(app.getHttpServer())
      .post(url)
      .set(auth('other'))
      .send(input())
      .expect(403);
    expect(fixture.tx.sample.create).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { children: [] },
    { children: null },
    { children: [null] },
    { children: [{ reference: 'X', name: ' ' }] },
    {
      children: [
        { reference: 'X', name: 'Film' },
        { reference: ' X ', name: 'Autre' },
      ],
    },
    { ...input(), parentId: stepIds.other },
    { ...input(), originStepId: 'bad' },
    { children: [{ reference: 'X', name: 'Film', id: stepIds.sample }] },
    { children: [{ reference: 'X', name: 'Film', parentId: stepIds.other }] },
    { children: [{ reference: 'X', name: 'Film', creatorId: stepIds.other }] },
    { children: [{ reference: 'X', name: 'Film', batchId: stepIds.type }] },
  ])(
    'rejette une entrée invalide ou une tentative de réaffectation (%#)',
    async (body) => {
      await request(app.getHttpServer())
        .post(url)
        .set(auth('owner'))
        .send(body)
        .expect(400);
      expect(fixture.tx.sample.create).not.toHaveBeenCalled();
    },
  );
  it('refuse une étape d’origine absente ou extérieure au parent', async () => {
    fixture.tx.fabricationStep.findUnique.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .post(url)
      .set(auth('owner'))
      .send({ ...input(), originStepId: originId })
      .expect(404);
    fixture.tx.fabricationStep.findUnique.mockResolvedValueOnce({
      sampleId: ancestorId,
    });
    await request(app.getHttpServer())
      .post(url)
      .set(auth('owner'))
      .send({ ...input(), originStepId: originId })
      .expect(400);
    expect(fixture.tx.sample.create).not.toHaveBeenCalled();
  });
  it('refuse les cycles présents dans l’ascendance', async () => {
    fixture.parent.parentId = ancestorId;
    fixture.ancestor.parentId = stepIds.sample;
    await request(app.getHttpServer())
      .post(url)
      .set(auth('owner'))
      .send(input())
      .expect(409);
    expect(fixture.tx.sample.create).not.toHaveBeenCalled();
  });
  it('refuse une ascendance incohérente ou un parent absent', async () => {
    fixture.parent.parentId = stepIds.other;
    await request(app.getHttpServer())
      .post(url)
      .set(auth('owner'))
      .send(input())
      .expect(409);
    fixture.tx.sample.findUnique.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .post(url)
      .set(auth('owner'))
      .send(input())
      .expect(404);
  });
  it.each(['P2002', 'P2034'])(
    'traduit le conflit %s sans succès trompeur',
    async (code) => {
      fixture.tx.sample.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('synthetic', {
          code,
          clientVersion: '7.10.1',
        }),
      );
      await request(app.getHttpServer())
        .post(url)
        .set(auth('owner'))
        .send(input())
        .expect(409);
    },
  );
  it('charge les liens publics en une requête de détail pour tout chercheur', async () => {
    await request(app.getHttpServer())
      .get(`/samples/${stepIds.sample}`)
      .set(auth('other'))
      .expect(200);
    expect(fixture.prisma.sample.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          parent: expect.any(Object),
          children: expect.any(Object),
          originStep: expect.any(Object),
        }),
      }),
    );
  });
});
