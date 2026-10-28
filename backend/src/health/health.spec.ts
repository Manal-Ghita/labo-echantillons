import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { HealthModule } from './health.module';
import { HealthService } from './health.service';

describe('Health (Prisma simulé)', () => {
  let app: INestApplication;
  let health: HealthService;
  const prisma = { $queryRaw: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [HealthModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    await app.init();
    health = module.get(HealthService);
  });
  beforeEach(() => {
    jest.resetAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  afterAll(async () => {
    await app.close();
  });

  it('retourne HTTP 200 après une requête PostgreSQL réussie', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await request(app.getHttpServer())
      .get('/health')
      .expect(200, { status: 'ok', database: 'up' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('retourne HTTP 503 sans exposer les détails de connexion', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('internal connection details'),
    );
    await request(app.getHttpServer())
      .get('/health')
      .expect(503, { status: 'error', database: 'down' });
  });
  it('limite à trois secondes l’attente d’une base qui ne répond plus', async () => {
    jest.useFakeTimers();
    prisma.$queryRaw.mockReturnValue(new Promise<never>(() => {}));
    const result = expect(health.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await jest.advanceTimersByTimeAsync(3000);
    await result;
    expect(jest.getTimerCount()).toBe(0);
  });
});
