import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureCors } from '../src/configure-cors';
import {
  createStepInput,
  exactDecimal,
  fabricationMock,
  stepIds,
} from './support/fabrication-steps.fixture';

describe('API complète (Prisma simulé, aucune écriture réelle)', () => {
  let app: INestApplication;
  let token: string;
  const userId = '3fd8de68-8847-42fc-94df-99459f699ba9';
  const oldSecret = process.env.JWT_SECRET;
  let fabrication: ReturnType<typeof fabricationMock>;
  const prisma = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    sample: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    stepType: { findMany: jest.fn() },
    fabricationStep: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    configureCors(app, 'http://localhost:5173');
    await app.init();
    token = await moduleFixture.get(JwtService).signAsync({ sub: userId });
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    prisma.sample.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      role: 'RESEARCHER',
    });
    prisma.stepType.findMany.mockResolvedValue([]);
    fabrication = fabricationMock();
    prisma.sample.findUnique.mockImplementation(
      fabrication.tx.sample.findUnique,
    );
    prisma.fabricationStep.findMany.mockResolvedValue([fabrication.legacy]);
    prisma.$transaction.mockImplementation(
      (work: (client: typeof fabrication.tx) => Promise<unknown>) =>
        work(fabrication.tx),
    );
  });

  it('GET /health confirme la disponibilité de PostgreSQL', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200, { status: 'ok', database: 'up' });
  });

  it('autorise le preflight Authorization de la seule origine frontend configurée', async () => {
    const response = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(response.headers['access-control-allow-headers']).toContain(
      'Authorization',
    );
    expect(
      response.headers['access-control-allow-credentials'],
    ).toBeUndefined();
  });

  it('ne renvoie aucun en-tête CORS pour une autre origine', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://external.example')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('GET /health signale une panne PostgreSQL', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('Simulated outage'));
    await request(app.getHttpServer())
      .get('/health')
      .expect(503, { status: 'error', database: 'down' });
  });

  it('préserve la recherche authentifiée', async () => {
    await request(app.getHttpServer())
      .get('/samples?q=film')
      .auth(token, { type: 'bearer' })
      .expect(200, []);
    expect(prisma.sample.findMany).toHaveBeenCalled();
  });

  it('intègre le catalogue authentifié et refuse les consultations anonymes', async () => {
    await request(app.getHttpServer())
      .get('/step-types')
      .auth(token, { type: 'bearer' })
      .expect(200, []);
    await request(app.getHttpServer()).get('/step-types').expect(401);
    await request(app.getHttpServer()).get('/samples').expect(401);
  });

  it('interdit une création sans JWT', async () => {
    await request(app.getHttpServer())
      .post('/samples')
      .send({ reference: 'LAB', name: 'Film' })
      .expect(401);
    expect(prisma.sample.create).not.toHaveBeenCalled();
  });

  it('intègre la saisie répétée SUCCESS/FAILURE et un historique compatible avec les anciennes étapes', async () => {
    const route = '/samples/' + stepIds.sample + '/steps';
    const success = await request(app.getHttpServer())
      .post(route)
      .auth(token, { type: 'bearer' })
      .send(createStepInput())
      .expect(201);
    const failure = await request(app.getHttpServer())
      .post(route)
      .auth(token, { type: 'bearer' })
      .send({
        ...createStepInput(),
        result: 'FAILURE',
        performedAt: '2026-10-28T10:00:00Z',
      })
      .expect(201);
    expect(success.body.recordedById).toBe(userId);
    expect(success.body.id).not.toBe(failure.body.id);
    const first =
      await fabrication.tx.fabricationStep.create.mock.results[0].value;
    const second =
      await fabrication.tx.fabricationStep.create.mock.results[1].value;
    prisma.fabricationStep.findMany.mockResolvedValue([
      fabrication.legacy,
      second,
      first,
    ]);
    const history = await request(app.getHttpServer())
      .get(route)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(
      history.body.map((step: { result: string | null }) => step.result),
    ).toEqual([null, 'FAILURE', 'SUCCESS']);
    expect(history.body[0].parameters).toBe('temperature=120 C');
    expect(
      history.body[2].parameterValues.find(
        (value: { definitionId: string }) =>
          value.definitionId === stepIds.number,
      ).numericValue,
    ).toBe(exactDecimal);
    expect(prisma.fabricationStep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ performedAt: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer())
      .post(route)
      .send(createStepInput())
      .expect(401);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
});
