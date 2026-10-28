import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('API complète (Prisma simulé, aucune écriture réelle)', () => {
  let app: INestApplication;
  const oldSecret = process.env.JWT_SECRET;
  const prisma = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    sample: { findMany: jest.fn(), create: jest.fn() },
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
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    prisma.sample.findMany.mockResolvedValue([]);
  });

  it('GET /health confirme la disponibilité de PostgreSQL', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200, { status: 'ok', database: 'up' });
  });

  it('GET /health signale une panne PostgreSQL', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('Simulated outage'));
    await request(app.getHttpServer())
      .get('/health')
      .expect(503, { status: 'error', database: 'down' });
  });

  it('préserve la recherche publique', async () => {
    await request(app.getHttpServer()).get('/samples?q=film').expect(200, []);
    expect(prisma.sample.findMany).toHaveBeenCalled();
  });

  it('interdit une création sans JWT', async () => {
    await request(app.getHttpServer())
      .post('/samples')
      .send({ reference: 'LAB', name: 'Film' })
      .expect(401);
    expect(prisma.sample.create).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
});
