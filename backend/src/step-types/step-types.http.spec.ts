import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StepTypesModule } from './step-types.module';

describe('StepTypes HTTP, vrais guards JWT/rôles et Prisma simulé', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let adminToken: string;
  let researcherToken: string;
  const previousSecret = process.env.JWT_SECRET;
  const adminId = '3fd8de68-8847-42fc-94df-99459f699ba9';
  const researcherId = '6cc012be-8908-4c8d-b43b-e1df6664e4d0';
  const id = '762849cc-220e-4e4f-b4af-2e1593697d0e';
  const missingId = 'ba7fd88d-c78f-431c-9d90-2532e9187a0e';
  const parameter = {
    key: 'temperature',
    name: 'Température',
    dataType: 'NUMBER',
    unit: 'C',
    isRequired: true,
  };
  const body = { code: 'DEPOSITION', name: 'Dépôt', parameters: [parameter] };
  let catalog: typeof body & { id: string; isActive: boolean };
  const prisma = {
    user: { findUnique: jest.fn() },
    stepType: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64');
    const module = await Test.createTestingModule({
      imports: [StepTypesModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
    adminToken = await jwt.signAsync({ sub: adminId });
    researcherToken = await jwt.signAsync({ sub: researcherId });
  });
  beforeEach(() => {
    jest.resetAllMocks();
    catalog = { ...body, id, isActive: true };
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === adminId
            ? { id: adminId, role: 'ADMIN' }
            : where.id === researcherId
              ? { id: researcherId, role: 'RESEARCHER' }
              : null,
        ),
    );
    prisma.stepType.findMany.mockImplementation(
      ({ where }: { where: { isActive?: boolean } }) =>
        Promise.resolve(where.isActive && !catalog.isActive ? [] : [catalog]),
    );
    prisma.stepType.findFirst.mockImplementation(
      ({ where }: { where: { id: string; isActive?: boolean } }) =>
        Promise.resolve(
          where.id === id &&
            (where.isActive === undefined ||
              where.isActive === catalog.isActive)
            ? catalog
            : null,
        ),
    );
    prisma.stepType.create.mockImplementation(
      ({
        data,
      }: {
        data: typeof body & { parameters: { create: typeof body.parameters } };
      }) =>
        Promise.resolve({
          id,
          code: data.code,
          name: data.name,
          isActive: true,
          parameters: data.parameters.create,
        }),
    );
    prisma.stepType.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...catalog, ...data }),
    );
  });
  afterAll(async () => {
    if (app) await app.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it.each(['get', 'post', 'patch'] as const)(
    'retourne 401 sans token pour %s',
    async (method) => {
      const url = method === 'patch' ? '/step-types/' + id : '/step-types';
      await request(app.getHttpServer())[method](url).send(body).expect(401);
      expect(prisma.stepType.create).not.toHaveBeenCalled();
      expect(prisma.stepType.update).not.toHaveBeenCalled();
    },
  );
  it('rejette un token invalide', async () => {
    await request(app.getHttpServer())
      .get('/step-types')
      .auth('invalid', { type: 'bearer' })
      .expect(401);
  });
  it.each(['ADMIN', 'RESEARCHER'])(
    'permet la consultation authentifiée au rôle %s',
    async (role) => {
      const token = role === 'ADMIN' ? adminToken : researcherToken;
      const response = await request(app.getHttpServer())
        .get('/step-types')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(response.body[0].parameters).toEqual([parameter]);
      expect(prisma.stepType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      await request(app.getHttpServer())
        .get('/step-types/' + id)
        .auth(token, { type: 'bearer' })
        .expect(200);
    },
  );
  it('masque les types inactifs aux chercheurs', async () => {
    catalog.isActive = false;
    await request(app.getHttpServer())
      .get('/step-types')
      .auth(researcherToken, { type: 'bearer' })
      .expect(200, []);
    await request(app.getHttpServer())
      .get('/step-types/' + id)
      .auth(researcherToken, { type: 'bearer' })
      .expect(404);
  });
  it('permet à ADMIN de retrouver les types inactifs', async () => {
    catalog.isActive = false;
    const response = await request(app.getHttpServer())
      .get('/step-types?includeInactive=true')
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(response.body[0].isActive).toBe(false);
    await request(app.getHttpServer())
      .get('/step-types/' + id)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
  });
  it('retourne 403 si un chercheur demande les types inactifs', async () => {
    await request(app.getHttpServer())
      .get('/step-types?includeInactive=true')
      .auth(researcherToken, { type: 'bearer' })
      .expect(403);
    expect(prisma.stepType.findMany).not.toHaveBeenCalled();
  });
  it('interprète includeInactive=false sans coercition en true', async () => {
    await request(app.getHttpServer())
      .get('/step-types?includeInactive=false')
      .auth(researcherToken, { type: 'bearer' })
      .expect(200);
    expect(prisma.stepType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });
  it.each([
    '?includeInactive=1',
    '?includeInactive=',
    '?includeInactive=true&includeInactive=false',
    '?role=ADMIN',
  ])('rejette la requête %s', async (query) => {
    await request(app.getHttpServer())
      .get('/step-types' + query)
      .auth(adminToken, { type: 'bearer' })
      .expect(400);
    expect(prisma.stepType.findMany).not.toHaveBeenCalled();
  });
  it.each(['get', 'patch'] as const)(
    'valide les UUID pour %s',
    async (method) => {
      await request(app.getHttpServer())
        [method]('/step-types/not-an-uuid')
        .auth(adminToken, { type: 'bearer' })
        .send({ isActive: false })
        .expect(400);
    },
  );
  it('retourne 404 pour un type absent', async () => {
    await request(app.getHttpServer())
      .get('/step-types/' + missingId)
      .auth(researcherToken, { type: 'bearer' })
      .expect(404);
  });
  it.each(['post', 'patch'] as const)('réserve %s à ADMIN', async (method) => {
    await request(app.getHttpServer())
      [method](method === 'patch' ? '/step-types/' + id : '/step-types')
      .auth(researcherToken, { type: 'bearer' })
      .send(method === 'patch' ? { isActive: false } : body)
      .expect(403);
    expect(prisma.stepType.create).not.toHaveBeenCalled();
    expect(prisma.stepType.update).not.toHaveBeenCalled();
  });
  it('ignore un rôle ADMIN revendiqué dans le JWT et vérifie celui en base', async () => {
    const forgedRole = await jwt.signAsync({
      sub: researcherId,
      role: 'ADMIN',
    });
    await request(app.getHttpServer())
      .post('/step-types')
      .auth(forgedRole, { type: 'bearer' })
      .send(body)
      .expect(403);
  });
  it('crée les définitions NUMBER/TEXT/BOOLEAN avec ADMIN', async () => {
    const parameters = [
      parameter,
      {
        key: 'atmosphere',
        name: 'Atmosphère',
        dataType: 'TEXT',
        isRequired: false,
      },
      { key: 'vacuum', name: 'Vide', dataType: 'BOOLEAN', isRequired: true },
    ];
    const response = await request(app.getHttpServer())
      .post('/step-types')
      .auth(adminToken, { type: 'bearer' })
      .send({ ...body, parameters })
      .expect(201);
    expect(response.body.parameters).toEqual(parameters);
  });
  it('normalise les blancs des noms, codes et clés', async () => {
    await request(app.getHttpServer())
      .post('/step-types')
      .auth(adminToken, { type: 'bearer' })
      .send({
        code: ' CODE ',
        name: ' Opération ',
        parameters: [
          {
            ...parameter,
            key: ' temperature ',
            name: ' Température ',
            unit: ' C ',
          },
        ],
      })
      .expect(201);
    expect(prisma.stepType.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'CODE',
          name: 'Opération',
          parameters: { create: [parameter] },
        }),
      }),
    );
  });
  it('accepte un type sans réglages', async () => {
    await request(app.getHttpServer())
      .post('/step-types')
      .auth(adminToken, { type: 'bearer' })
      .send({ ...body, parameters: [] })
      .expect(201);
  });
  it.each([
    {},
    { ...body, code: ' ' },
    { ...body, name: ' ' },
    { code: 'X', name: 'X' },
    { ...body, parameters: null },
    { ...body, parameters: {} },
    { ...body, parameters: [null] },
    { ...body, parameters: [{ ...parameter, key: 'bad key' }] },
    { ...body, parameters: [{ ...parameter, dataType: 'FLOAT' }] },
    {
      ...body,
      parameters: [{ key: 'temperature', name: 'T', dataType: 'NUMBER' }],
    },
    { ...body, parameters: [{ ...parameter, isRequired: 'true' }] },
    { ...body, parameters: [{ ...parameter, unit: null }] },
    { ...body, parameters: [{ ...parameter, unit: ' ' }] },
    { ...body, parameters: [{ ...parameter, name: '' }] },
    {
      ...body,
      parameters: [parameter, { ...parameter, key: ' temperature ' }],
    },
    { ...body, parameters: [{ ...parameter, unexpected: 'value' }] },
    { ...body, isActive: false },
    { ...body, createdById: adminId },
  ])('retourne 400 pour une création invalide (%#)', async (invalid) => {
    await request(app.getHttpServer())
      .post('/step-types')
      .auth(adminToken, { type: 'bearer' })
      .send(invalid)
      .expect(400);
    expect(prisma.stepType.create).not.toHaveBeenCalled();
  });
  it('retourne 409 sur un code déjà pris', async () => {
    prisma.stepType.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );
    await request(app.getHttpServer())
      .post('/step-types')
      .auth(adminToken, { type: 'bearer' })
      .send(body)
      .expect(409);
  });
  it('permet à ADMIN de renommer, désactiver et réactiver sans changer les paramètres', async () => {
    const response = await request(app.getHttpServer())
      .patch('/step-types/' + id)
      .auth(adminToken, { type: 'bearer' })
      .send({ name: 'Nouveau libellé', description: null, isActive: false })
      .expect(200);
    expect(response.body.parameters).toEqual([parameter]);
    expect(response.body.isActive).toBe(false);
    await request(app.getHttpServer())
      .patch('/step-types/' + id)
      .auth(adminToken, { type: 'bearer' })
      .send({ isActive: true })
      .expect(200);
  });
  it.each([
    {},
    { name: ' ' },
    { name: null },
    { isActive: 'false' },
    { isActive: null },
    { description: 42 },
    { code: 'NEW' },
    { parameters: [{ ...parameter, dataType: 'TEXT' }] },
    { parameters: [{ ...parameter, unit: 'K' }] },
    { parameters: [{ ...parameter, key: 'new_key' }] },
    { parameters: [{ ...parameter, name: 'Nouvelle signification' }] },
  ])('rejette un PATCH invalide ou incompatible (%#)', async (invalid) => {
    await request(app.getHttpServer())
      .patch('/step-types/' + id)
      .auth(adminToken, { type: 'bearer' })
      .send(invalid)
      .expect(400);
    expect(prisma.stepType.update).not.toHaveBeenCalled();
  });
  it('retourne 404 pour une modification inexistante', async () => {
    prisma.stepType.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Missing', {
        code: 'P2025',
        clientVersion: '7.10.1',
      }),
    );
    await request(app.getHttpServer())
      .patch('/step-types/' + missingId)
      .auth(adminToken, { type: 'bearer' })
      .send({ isActive: false })
      .expect(404);
  });
  it('n’expose aucune suppression physique ni modification directe de définition', async () => {
    await request(app.getHttpServer())
      .delete('/step-types/' + id)
      .auth(adminToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .patch('/step-types/' + id + '/parameters/' + missingId)
      .auth(adminToken, { type: 'bearer' })
      .send({ unit: 'K' })
      .expect(404);
  });
});
