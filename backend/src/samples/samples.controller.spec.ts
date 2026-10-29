import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('SamplesController HTTP (service simulé)', () => {
  let app: INestApplication;
  const service = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() };
  const guard = { canActivate: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SamplesController],
      providers: [{ provide: SamplesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guard)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    guard.canActivate.mockReturnValue(true);
  });
  afterAll(async () => {
    await app.close();
  });

  it('expose la liste', async () => {
    service.findAll.mockResolvedValue([]);
    await request(app.getHttpServer()).get('/samples').expect(200, []);
  });
  it('transmet la recherche', async () => {
    service.findAll.mockResolvedValue([]);
    await request(app.getHttpServer()).get('/samples?q=film').expect(200);
    expect(service.findAll).toHaveBeenCalledWith(
      'film',
      expect.objectContaining({ q: 'film' }),
    );
  });
  it.each([
    '/samples?q=a&q=b',
    '/samples?createdById=intrus',
    '/samples/pas-un-uuid',
  ])('rejette %s', async (url) => {
    await request(app.getHttpServer()).get(url).expect(400);
    expect(service.findAll).not.toHaveBeenCalled();
    expect(service.findOne).not.toHaveBeenCalled();
  });
  it('expose la consultation par UUID', async () => {
    const id = 'b25dd475-83ce-47d7-8538-d2c53fcfcb4e';
    service.findOne.mockResolvedValue({ id });
    await request(app.getHttpServer())
      .get('/samples/' + id)
      .expect(200, { id });
    expect(service.findOne).toHaveBeenCalledWith(id);
  });
  it('ne permet aucune création HTTP sans authentification', async () => {
    guard.canActivate.mockReturnValue(false);
    await request(app.getHttpServer())
      .post('/samples')
      .send({ reference: 'X', name: 'Film', createdById: 'intrus' })
      .expect(403);
    expect(service.create).not.toHaveBeenCalled();
  });
});
