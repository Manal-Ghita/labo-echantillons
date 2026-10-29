import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { Prisma } from './generated/prisma/client';
import { PasswordService } from './auth/password.service';
import {
  fabricationMock,
  stepIds,
} from '../test/support/fabrication-steps.fixture';

describe('Nouveaux endpoints HTTP avec vrais guards et Prisma simulé', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const oldSecret = process.env.JWT_SECRET;
  const profiles = [
    {
      id: stepIds.owner,
      name: 'Owner',
      email: 'owner@example.test',
      role: 'RESEARCHER',
      createdAt: new Date(),
    },
    {
      id: stepIds.other,
      name: 'Other',
      email: 'other@example.test',
      role: 'RESEARCHER',
      createdAt: new Date(),
    },
    {
      id: stepIds.admin,
      name: 'Admin',
      email: 'admin@example.test',
      role: 'ADMIN',
      createdAt: new Date(),
    },
  ];
  const sampleRecord = {
    id: stepIds.sample,
    creatorId: stepIds.owner,
    status: 'ACTIVE',
  };
  const legacy = {
    ...fabricationMock().legacy,
    sample: { creatorId: stepIds.owner },
  };
  const user = {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  };
  const sample = {
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  };
  const fabricationStep = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  };
  const stepCorrection = { create: jest.fn(), findMany: jest.fn() };
  const parameterDefinition = {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const tx = { user, sample, fabricationStep, stepCorrection };
  const prisma = {
    ...tx,
    parameterDefinition,
    $transaction: jest.fn((work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const auth = (id: string) => 'Bearer ' + jwt.sign({ sub: id });
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64url');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PasswordService)
      .useValue({
        hash: jest.fn().mockResolvedValue('test-hash'),
        verify: jest.fn(),
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
    jwt = app.get(JwtService);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        profiles.find((profile) => profile.id === where.id) ?? null,
      ),
    );
    user.create.mockResolvedValue({ ...profiles[0], id: stepIds.operator });
    user.findMany.mockResolvedValue(profiles);
    sample.findUnique.mockResolvedValue(sampleRecord);
    sample.findMany.mockResolvedValue([]);
    sample.update.mockResolvedValue({ ...sampleRecord, status: 'ABANDONED' });
    parameterDefinition.findUnique.mockResolvedValue({
      id: stepIds.number,
      dataType: 'NUMBER',
    });
    fabricationStep.findUnique.mockResolvedValue(legacy);
    fabricationStep.findFirst.mockResolvedValue({ id: legacy.id });
    fabricationStep.update.mockResolvedValue({ ...legacy, revision: 1 });
    stepCorrection.create.mockResolvedValue({ id: 'audit' });
    stepCorrection.findMany.mockResolvedValue([]);
  });
  afterAll(async () => {
    await app.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
  const account = {
    name: 'New researcher',
    email: 'new@example.test',
    password: 'test-password-only',
  };
  it('crée RESEARCHER pour ADMIN sans exposer les secrets', async () => {
    const result = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', auth(stepIds.admin))
      .send(account)
      .expect(201);
    expect(result.body.role).toBe('RESEARCHER');
    expect(result.body).not.toHaveProperty('passwordHash');
    expect(result.body).not.toHaveProperty('password');
    expect(user.create.mock.calls[0][0].data.role).toBe('RESEARCHER');
  });
  it.each(['get', 'post'] as const)(
    'refuse %s /users à RESEARCHER et sans JWT',
    async (method) => {
      await request(app.getHttpServer())
        [method]('/users')
        .send(method === 'post' ? account : undefined)
        .expect(401);
      await request(app.getHttpServer())
        [method]('/users')
        .set('Authorization', auth(stepIds.owner))
        .send(method === 'post' ? account : undefined)
        .expect(403);
      expect(user.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...account, role: 'ADMIN' },
    { ...account, password: 'short' },
    { ...account, password: 'é'.repeat(40) },
    { ...account, email: 'bad' },
    { ...account, name: '   ' },
  ])('rejette un compte invalide ou un rôle injecté', async (body) => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', auth(stepIds.admin))
      .send(body)
      .expect(400);
    expect(user.create).not.toHaveBeenCalled();
  });
  it('renvoie 409 pour un email déjà pris', async () => {
    user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', auth(stepIds.admin))
      .send(account)
      .expect(409);
  });
  it('transmet un filtre numérique authentifié', async () => {
    await request(app.getHttpServer())
      .get(
        `/samples?parameterDefinitionId=${stepIds.number}&min=0.123456789012345678901234567891&max=2`,
      )
      .set('Authorization', auth(stepIds.owner))
      .expect(200);
    expect(
      sample.findMany.mock.calls[0][0].where.steps.some.parameterValues.some.numericValue.gte.toFixed(),
    ).toBe('0.123456789012345678901234567891');
  });
  it('expose le sélecteur numérique seulement aux utilisateurs authentifiés', async () => {
    await request(app.getHttpServer())
      .get('/samples/numeric-parameters')
      .expect(401);
    await request(app.getHttpServer())
      .get('/samples/numeric-parameters')
      .set('Authorization', auth(stepIds.other))
      .expect(200, []);
  });
  it.each([
    'min=1',
    `parameterDefinitionId=${stepIds.number}&min=2&max=1`,
    `parameterDefinitionId=${stepIds.number}&min=NaN`,
    'parameterDefinitionId=bad',
    `parameterDefinitionId=${stepIds.number}&min=1&min=2`,
  ])('rejette la recherche invalide %s', async (query) => {
    await request(app.getHttpServer())
      .get('/samples?' + query)
      .set('Authorization', auth(stepIds.owner))
      .expect(400);
  });
  it.each([stepIds.owner, stepIds.admin])(
    'autorise le changement d’état pour %s',
    async (actor) => {
      await request(app.getHttpServer())
        .patch(`/samples/${stepIds.sample}/status`)
        .set('Authorization', auth(actor))
        .send({ status: 'ABANDONED' })
        .expect(200);
    },
  );
  it('protège le statut et valide sa valeur', async () => {
    const url = `/samples/${stepIds.sample}/status`;
    await request(app.getHttpServer())
      .patch(url)
      .send({ status: 'ACTIVE' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', auth(stepIds.other))
      .send({ status: 'ACTIVE' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', auth(stepIds.owner))
      .send({ status: 'DELETED' })
      .expect(400);
  });
  it('corrige une étape et enregistre le vrai auteur dans le journal', async () => {
    await request(app.getHttpServer())
      .post(`/samples/${stepIds.sample}/steps/${legacy.id}/corrections`)
      .set('Authorization', auth(stepIds.owner))
      .send({
        reason: 'Erreur de saisie',
        expectedRevision: 0,
        observations: 'Corrigées',
      })
      .expect(201);
    expect(stepCorrection.create.mock.calls[0][0].data.correctedById).toBe(
      stepIds.owner,
    );
  });
  it.each([
    { reason: '  ', expectedRevision: 0, observations: 'X' },
    { reason: 'R', expectedRevision: -1, observations: 'X' },
    { reason: 'R', expectedRevision: 0, recordedById: stepIds.other },
    { reason: 'R', expectedRevision: 0, stepTypeId: stepIds.type },
    { reason: 'R', expectedRevision: 0 },
  ])('refuse une correction invalide', async (body) => {
    await request(app.getHttpServer())
      .post(`/samples/${stepIds.sample}/steps/${legacy.id}/corrections`)
      .set('Authorization', auth(stepIds.owner))
      .send(body)
      .expect(400);
  });
  it('refuse les corrections concurrentes et les autres chercheurs', async () => {
    const url = `/samples/${stepIds.sample}/steps/${legacy.id}/corrections`;
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', auth(stepIds.other))
      .send({ reason: 'R', expectedRevision: 0, observations: 'X' })
      .expect(403);
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', auth(stepIds.owner))
      .send({ reason: 'R', expectedRevision: 2, observations: 'X' })
      .expect(409);
  });
  it('permet la lecture du journal à tout chercheur authentifié', async () => {
    const url = `/samples/${stepIds.sample}/steps/${legacy.id}/corrections`;
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer())
      .get(url)
      .set('Authorization', auth(stepIds.other))
      .expect(200, []);
  });
});
