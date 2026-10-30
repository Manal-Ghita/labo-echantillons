import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { Prisma } from '../generated/prisma/client';

describe('Statut et révocation — HTTP réel, Prisma simulé', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const oldSecret = process.env.JWT_SECRET;
  const ids = [
    '7d36e8fa-a367-430a-aa32-24d2e23ca9a1',
    '7d36e8fa-a367-430a-aa32-24d2e23ca9a2',
    '7d36e8fa-a367-430a-aa32-24d2e23ca9a3',
  ];
  const initial = ids.map((id, index) => ({
    id,
    name: `User ${index}`,
    email: `user${index}@example.test`,
    role: index === 2 ? 'RESEARCHER' : 'ADMIN',
    isActive: true,
    authVersion: 0,
    passwordHash: 'secret-hash',
    createdAt: new Date('2026-10-29'),
  }));
  let users: typeof initial;
  const user = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const sampleId = '7d36e8fa-a367-430a-aa32-24d2e23ca9a4';
  const sampleRecord = { id: sampleId, creatorId: ids[2] };
  const stepRecord = {
    id: ids[2],
    sampleId,
    recordedById: ids[2],
    operatorId: ids[2],
    recordedBy: { id: ids[2], name: 'User 2' },
    operator: { id: ids[2], name: 'User 2' },
    parameterValues: [],
  };
  const sample = { findUnique: jest.fn(async () => sampleRecord) };
  const fabricationStep = {
    findMany: jest.fn(async () => [stepRecord]),
    findFirst: jest.fn(async () => ({ id: stepRecord.id })),
  };
  const stepCorrection = {
    findMany: jest.fn(async () => [
      {
        id: 'audit',
        correctedById: ids[2],
        correctedBy: { id: ids[2], name: 'User 2' },
      },
    ]),
  };
  const tx = { user };
  const prisma = {
    user,
    sample,
    fabricationStep,
    stepCorrection,
    $transaction: jest.fn((work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const token = (index: number, version = 0) =>
    jwt.sign({ sub: ids[index], authVersion: version });
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64url');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PasswordService)
      .useValue({ hash: jest.fn(), verify: jest.fn(async () => true) })
      .compile();
    app = module.createNestApplication();
    await app.init();
    jwt = app.get(JwtService);
  });
  beforeEach(() => {
    users = structuredClone(initial);
    user.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; email?: string } }) =>
        Promise.resolve(
          users.find((u) =>
            where.id ? u.id === where.id : u.email === where.email,
          ) ?? null,
        ),
    );
    user.findMany.mockImplementation(() => Promise.resolve(users));
    user.count.mockImplementation(() =>
      Promise.resolve(
        users.filter((u) => u.role === 'ADMIN' && u.isActive).length,
      ),
    );
    user.update.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: { isActive: boolean };
      }) => {
        const u = users.find((u) => u.id === where.id)!;
        u.isActive = data.isActive;
        u.authVersion++;
        return Promise.resolve(u);
      },
    );
    user.update.mockClear();
  });
  afterAll(async () => {
    await app.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
  it('révoque le JWT avant/après réactivation et exige une nouvelle connexion', async () => {
    const old = token(2),
      admin = token(0);
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(old, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/users/${ids[2]}/status`)
      .auth(admin, { type: 'bearer' })
      .send({ isActive: false })
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(old, { type: 'bearer' })
      .expect(401);
    const denied = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: users[2].email, password: 'fake-password-42' })
      .expect(401);
    expect(denied.body.message).toBe('Email ou mot de passe incorrect.');
    await request(app.getHttpServer())
      .patch(`/users/${ids[2]}/status`)
      .auth(admin, { type: 'bearer' })
      .send({ isActive: true })
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(old, { type: 'bearer' })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: users[2].email, password: 'fake-password-42' })
      .expect(200);
    expect(jwt.verify(login.body.access_token).authVersion).toBe(2);
    const profile = await request(app.getHttpServer())
      .get('/auth/me')
      .auth(login.body.access_token, { type: 'bearer' })
      .expect(200);
    expect(profile.body).not.toHaveProperty('authVersion');
    expect(profile.body).not.toHaveProperty('passwordHash');
    expect(users[2]).toMatchObject({ ...initial[2], authVersion: 2 });
  });
  it.each([undefined, -1, 0.5, '0', null])(
    'refuse une version JWT absente ou invalide %s',
    async (authVersion) => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .auth(jwt.sign({ sub: ids[0], authVersion }), { type: 'bearer' })
        .expect(401);
    },
  );
  it('refuse la route sans JWT et pour RESEARCHER', async () => {
    await request(app.getHttpServer())
      .patch(`/users/${ids[1]}/status`)
      .send({ isActive: false })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/users/${ids[1]}/status`)
      .auth(token(2), { type: 'bearer' })
      .send({ isActive: false })
      .expect(403);
  });
  it.each([
    {},
    { isActive: 'false' },
    { isActive: 0 },
    { isActive: null },
    { isActive: false, role: 'ADMIN' },
    { isActive: false, authVersion: 9 },
  ])('valide strictement le corps %j', async (body) => {
    await request(app.getHttpServer())
      .patch(`/users/${ids[1]}/status`)
      .auth(token(0), { type: 'bearer' })
      .send(body)
      .expect(400);
    expect(user.update).not.toHaveBeenCalled();
  });
  it('refuse UUID invalide, cible absente et auto-désactivation', async () => {
    await request(app.getHttpServer())
      .patch('/users/not-uuid/status')
      .auth(token(0), { type: 'bearer' })
      .send({ isActive: false })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/users/7d36e8fa-a367-430a-aa32-24d2e23ca9a4/status')
      .auth(token(0), { type: 'bearer' })
      .send({ isActive: false })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/users/${ids[0]}/status`)
      .auth(token(0), { type: 'bearer' })
      .send({ isActive: false })
      .expect(403);
  });
  it('retourne 409 sur un conflit Serializable sans changement de compte', async () => {
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: '7.10.1',
      }),
    );
    await request(app.getHttpServer())
      .patch(`/users/${ids[1]}/status`)
      .auth(token(0), { type: 'bearer' })
      .send({ isActive: false })
      .expect(409);
    expect(users[1].isActive).toBe(true);
    expect(user.update).not.toHaveBeenCalled();
  });
  it('retourne aussi 409 quand adapter-pg remonte directement le conflit au commit', async () => {
    prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('TransactionWriteConflict'), {
        name: 'DriverAdapterError',
        cause: { kind: 'TransactionWriteConflict', originalCode: '40001' },
      }),
    );
    await request(app.getHttpServer())
      .patch(`/users/${ids[1]}/status`)
      .auth(token(0), { type: 'bearer' })
      .send({ isActive: false })
      .expect(409);
    expect(users[1].isActive).toBe(true);
    expect(user.update).not.toHaveBeenCalled();
  });
  it.each([{ isActive: false }, { authVersion: 7 }])(
    'interdit de choisir les champs de sécurité à la création %j',
    async (extra) => {
      await request(app.getHttpServer())
        .post('/users')
        .auth(token(0), { type: 'bearer' })
        .send({
          name: 'New',
          email: 'new@example.test',
          password: 'fake-password-42',
          ...extra,
        })
        .expect(400);
    },
  );
  it('ne révèle ni version ni hash dans liste et mutation ; conserve les opérateurs désactivés', async () => {
    const changed = await request(app.getHttpServer())
      .patch(`/users/${ids[2]}/status`)
      .auth(token(0), { type: 'bearer' })
      .send({ isActive: false })
      .expect(200);
    expect(Object.keys(changed.body).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'isActive',
      'name',
      'role',
    ]);
    const list = await request(app.getHttpServer())
      .get('/users')
      .auth(token(0), { type: 'bearer' })
      .expect(200);
    for (const u of list.body) {
      expect(u).not.toHaveProperty('authVersion');
      expect(u).not.toHaveProperty('passwordHash');
    }
    const operators = await request(app.getHttpServer())
      .get('/users/operators')
      .auth(token(0), { type: 'bearer' })
      .expect(200);
    expect(operators.body).toContainEqual({ id: ids[2], name: users[2].name });
    for (const u of operators.body)
      expect(Object.keys(u).sort()).toEqual(['id', 'name']);
    const retainedSample = await request(app.getHttpServer())
      .get(`/samples/${sampleId}`)
      .auth(token(0), { type: 'bearer' })
      .expect(200);
    expect(retainedSample.body.creatorId).toBe(ids[2]);
    const history = await request(app.getHttpServer())
      .get(`/samples/${sampleId}/steps`)
      .auth(token(0), { type: 'bearer' })
      .expect(200);
    expect(history.body[0]).toMatchObject({
      recordedById: ids[2],
      operatorId: ids[2],
    });
    const audit = await request(app.getHttpServer())
      .get(`/samples/${sampleId}/steps/${stepRecord.id}/corrections`)
      .auth(token(0), { type: 'bearer' })
      .expect(200);
    expect(audit.body[0].correctedById).toBe(ids[2]);
    expect(sampleRecord.creatorId).toBe(ids[2]);
    expect(stepRecord.operatorId).toBe(ids[2]);
  });
});
