import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SamplesModule } from '../samples/samples.module';
import { AuthModule } from './auth.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { Roles, RolesGuard } from './roles.guard';

@Controller('test-admin')
class AdminProbeController {
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  get() {
    return { ok: true };
  }
}

describe('Authentification et samples HTTP (Prisma simulé)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let passwordHash: string;
  let token: string;
  const oldSecret = process.env.JWT_SECRET;
  const id = '3fd8de68-8847-42fc-94df-99459f699ba9';
  const user = {
    id,
    name: 'Chercheur test',
    email: 'researcher@example.test',
    role: 'RESEARCHER',
    createdAt: new Date('2026-01-01'),
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    sample: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64');
    passwordHash = await new PasswordService().hash('password-for-test');
    const module = await Test.createTestingModule({
      imports: [AuthModule, SamplesModule],
      controllers: [AdminProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
    token = await jwt.signAsync({ sub: id });
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockImplementation(
      ({
        where,
        select,
      }: {
        where: { id?: string; email?: string };
        select: Record<string, boolean>;
      }) => {
        if (
          (where.id && where.id !== id) ||
          (where.email && where.email !== user.email)
        )
          return Promise.resolve(null);
        const record = { ...user, passwordHash };
        return Promise.resolve(
          Object.fromEntries(
            Object.entries(record).filter(([key]) => select[key]),
          ),
        );
      },
    );
    prisma.sample.findMany.mockResolvedValue([]);
    prisma.sample.create.mockImplementation(
      ({
        data,
      }: {
        data: {
          reference: string;
          name: string;
          creator: { connect: { id: string } };
        };
      }) =>
        Promise.resolve({
          id: 'sample-test',
          reference: data.reference,
          name: data.name,
          creatorId: data.creator.connect.id,
        }),
    );
  });
  afterAll(async () => {
    if (app) await app.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });

  it('connecte un utilisateur existant avec bcrypt et fournit un JWT signé', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'password-for-test' })
      .expect(200);
    expect(Object.keys(response.body).sort()).toEqual([
      'access_token',
      'expires_in',
      'token_type',
    ]);
    const claims = await jwt.verifyAsync<{
      sub: string;
      exp: number;
      iat: number;
    }>(response.body.access_token as string);
    expect(claims.sub).toBe(id);
    expect(claims.exp - claims.iat).toBe(3600);
  });
  it.each([
    { email: 'unknown@example.test', password: 'password-for-test' },
    { email: user.email, password: 'wrong-password' },
  ])(
    'retourne la même erreur pour des identifiants incorrects',
    async (body) => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send(body)
        .expect(401);
      expect(response.body.message).toBe('Email ou mot de passe incorrect.');
    },
  );
  it.each([
    {},
    { email: 'bad', password: 'x' },
    { email: user.email, password: '' },
    { email: user.email, password: 42 },
    { email: user.email, password: 'x', role: 'ADMIN' },
  ])('rejette un login invalide', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('ne propose aucune inscription publique', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({})
      .expect(404);
  });
  it('retourne uniquement les champs publics pour /me', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(response.body).toEqual({
      ...user,
      createdAt: user.createdAt.toISOString(),
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });
  });
  it.each(['/auth/me', '/samples'])(
    'refuse une requête sans token vers %s',
    async (path) => {
      if (path === '/samples')
        await request(app.getHttpServer()).post(path).send({}).expect(401);
      else await request(app.getHttpServer()).get(path).expect(401);
    },
  );
  it('refuse un token malformé', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth('invalid', { type: 'bearer' })
      .expect(401);
  });
  it('refuse une mauvaise signature', async () => {
    const forged = await jwt.signAsync(
      { sub: id },
      { secret: randomBytes(48).toString('base64') },
    );
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(forged, { type: 'bearer' })
      .expect(401);
  });
  it('refuse un token expiré', async () => {
    const expired = await jwt.signAsync({ sub: id }, { expiresIn: -1 });
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(expired, { type: 'bearer' })
      .expect(401);
  });
  it('refuse un autre destinataire', async () => {
    const other = await jwt.signAsync({ sub: id }, { audience: 'other-api' });
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(other, { type: 'bearer' })
      .expect(401);
  });
  it('refuse un sujet invalide', async () => {
    const bad = await jwt.signAsync({ sub: 'not-a-uuid' });
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(bad, { type: 'bearer' })
      .expect(401);
  });
  it('refuse un utilisateur supprimé même avec un JWT valide', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(401);
  });
  it.each(['ADMIN', 'RESEARCHER'])(
    'permet au rôle %s de créer avec son identité réelle',
    async (role) => {
      prisma.user.findUnique.mockResolvedValue({ ...user, role });
      const response = await request(app.getHttpServer())
        .post('/samples')
        .auth(token, { type: 'bearer' })
        .send({ reference: 'LAB-1', name: 'Film' })
        .expect(201);
      expect(response.body.creatorId).toBe(id);
      expect(prisma.sample.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ creator: { connect: { id } } }),
        }),
      );
    },
  );
  it.each(['creatorId', 'createdById', 'role'])(
    'rejette le champ injecté %s',
    async (key) => {
      await request(app.getHttpServer())
        .post('/samples')
        .auth(token, { type: 'bearer' })
        .send({ reference: 'LAB', name: 'Film', [key]: 'intrus' })
        .expect(400);
      expect(prisma.sample.create).not.toHaveBeenCalled();
    },
  );
  it('retourne 409 sur une référence dupliquée', async () => {
    prisma.sample.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );
    await request(app.getHttpServer())
      .post('/samples')
      .auth(token, { type: 'bearer' })
      .send({ reference: 'LAB', name: 'Film' })
      .expect(409);
  });
  it('retourne 403 pour un chercheur sur une permission ADMIN', async () => {
    await request(app.getHttpServer())
      .get('/test-admin')
      .auth(token, { type: 'bearer' })
      .expect(403);
  });
  it('utilise le rôle courant en base plutôt qu’un rôle revendiqué dans le token', async () => {
    const claimed = await jwt.signAsync({ sub: id, role: 'ADMIN' });
    await request(app.getHttpServer())
      .get('/test-admin')
      .auth(claimed, { type: 'bearer' })
      .expect(403);
    prisma.user.findUnique.mockResolvedValue({ ...user, role: 'ADMIN' });
    await request(app.getHttpServer())
      .get('/test-admin')
      .auth(token, { type: 'bearer' })
      .expect(200);
  });
  it('préserve les lectures publiques', async () => {
    await request(app.getHttpServer()).get('/samples?q=film').expect(200, []);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
