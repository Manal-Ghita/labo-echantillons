import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import {
  createStepInput,
  exactDecimal,
  fabricationMock,
  stepIds,
} from '../../test/support/fabrication-steps.fixture';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { FabricationStepsModule } from './fabrication-steps.module';

describe('Étapes HTTP, vrais guards JWT/rôles et Prisma simulé', () => {
  let app: INestApplication;
  let tokens: Record<'owner' | 'admin' | 'other', string>;
  const previousSecret = process.env.JWT_SECRET;
  const route = '/samples/' + stepIds.sample + '/steps';
  let mocks = fabricationMock();
  // Stable delegate references are injected once, then configured for each case.
  const prisma = mocks.prisma;
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64');
    const module = await Test.createTestingModule({
      imports: [FabricationStepsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    await app.init();
    const jwt = module.get(JwtService);
    tokens = {
      owner: await jwt.signAsync({ sub: stepIds.owner }),
      admin: await jwt.signAsync({ sub: stepIds.admin }),
      other: await jwt.signAsync({ sub: stepIds.other }),
    };
  });
  beforeEach(() => {
    mocks = fabricationMock();
    // Replace delegates on the injected object; this remains a simulated DB.
    Object.assign(prisma, mocks.prisma);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it.each(['owner', 'admin'] as const)(
    'autorise %s et utilise uniquement son identité JWT',
    async (role) => {
      const response = await request(app.getHttpServer())
        .post(route)
        .auth(tokens[role], { type: 'bearer' })
        .send({
          ...createStepInput(),
          operatorId: stepIds.operator,
          observations: 'Essai',
        })
        .expect(201);
      expect(response.body.recordedById).toBe(stepIds[role]);
      expect(response.body.operatorId).toBe(stepIds.operator);
      expect(
        response.body.parameterValues.find(
          (value: { definitionId: string }) =>
            value.definitionId === stepIds.number,
        ).numericValue,
      ).toBe(exactDecimal);
      expect(response.body.performedAt).toBe('2026-10-29T09:30:00.000Z');
      expect(response.body.recordedBy).toEqual({
        id: stepIds[role],
        name: 'Auteur',
      });
      expect(response.body.recordedBy).not.toHaveProperty('passwordHash');
    },
  );
  it('refuse un autre chercheur', async () => {
    await request(app.getHttpServer())
      .post(route)
      .auth(tokens.other, { type: 'bearer' })
      .send(createStepInput())
      .expect(403);
    expect(mocks.tx.fabricationStep.create).not.toHaveBeenCalled();
  });
  it.each(['get', 'post'] as const)('refuse %s sans JWT', async (method) => {
    await request(app.getHttpServer())
      [method](route)
      .send(createStepInput())
      .expect(401);
    expect(prisma.sample.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('refuse un JWT invalide', async () => {
    await request(app.getHttpServer())
      .get(route)
      .auth('invalid', { type: 'bearer' })
      .expect(401);
  });
  it.each(['get', 'post'] as const)(
    'valide l’identifiant d’échantillon pour %s',
    async (method) => {
      await request(app.getHttpServer())
        [method]('/samples/invalid/steps')
        .auth(tokens.owner, { type: 'bearer' })
        .send(createStepInput())
        .expect(400);
    },
  );
  it.each(['owner', 'admin'] as const)(
    'refuse les étapes sur un échantillon abandonné pour %s',
    async (role) => {
      mocks.tx.sample.findUnique.mockResolvedValue({
        id: stepIds.sample,
        creatorId: stepIds.owner,
        status: 'ABANDONED',
      });
      await request(app.getHttpServer())
        .post(route)
        .auth(tokens[role], { type: 'bearer' })
        .send(createStepInput())
        .expect(409);
      expect(mocks.tx.fabricationStep.create).not.toHaveBeenCalled();
    },
  );
  it('refuse un type désactivé', async () => {
    mocks.tx.stepType.findUnique.mockResolvedValue({
      id: stepIds.type,
      isActive: false,
      parameters: mocks.definitions,
    });
    await request(app.getHttpServer())
      .post(route)
      .auth(tokens.owner, { type: 'bearer' })
      .send(createStepInput())
      .expect(409);
  });
  it('refuse un opérateur inexistant', async () => {
    await request(app.getHttpServer())
      .post(route)
      .auth(tokens.owner, { type: 'bearer' })
      .send({ ...createStepInput(), operatorId: stepIds.sample })
      .expect(400);
    expect(mocks.tx.fabricationStep.create).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { ...createStepInput(), stepTypeId: 'bad' },
    { ...createStepInput(), performedAt: '2026-02-30T10:00:00Z' },
    { ...createStepInput(), performedAt: '2026-10-29' },
    { ...createStepInput(), performedAt: '2026-10-29T10:00:00' },
    { ...createStepInput(), performedAt: '2026-10-29T10:00:00.123456Z' },
    { ...createStepInput(), result: 'UNKNOWN' },
    { ...createStepInput(), operatorId: 'bad' },
    { ...createStepInput(), operatorId: null },
    { ...createStepInput(), observations: 42 },
    { ...createStepInput(), recordedById: stepIds.admin },
    { ...createStepInput(), recordedAt: '2026-01-01T00:00:00Z' },
    { ...createStepInput(), sampleId: stepIds.other },
    { ...createStepInput(), operationName: 'Nom injecté' },
    { ...createStepInput(), parameters: 'Ancien format envoyé illicitement' },
    { ...createStepInput(), parameterValues: null },
    { ...createStepInput(), parameterValues: {} },
    { ...createStepInput(), parameterValues: [null] },
    {
      ...createStepInput(),
      parameterValues: [{ definitionId: 'bad', value: '1' }],
    },
    {
      ...createStepInput(),
      parameterValues: [{ definitionId: stepIds.number }],
    },
    {
      ...createStepInput(),
      parameterValues: [{ definitionId: stepIds.number, value: null }],
    },
    {
      ...createStepInput(),
      parameterValues: [
        { definitionId: stepIds.number, value: '1', numericValue: '2' },
      ],
    },
  ])('rejette un DTO invalide ou un champ interdit (%#)', async (input) => {
    await request(app.getHttpServer())
      .post(route)
      .auth(tokens.owner, { type: 'bearer' })
      .send(input)
      .expect(400);
    expect(mocks.tx.fabricationStep.create).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      [{ definitionId: stepIds.other, value: '1' }],
      [
        { definitionId: stepIds.number, value: '1' },
        { definitionId: stepIds.number, value: '2' },
      ],
      [
        { definitionId: stepIds.number, value: '1' },
        { definitionId: stepIds.number.toUpperCase(), value: '2' },
      ],
      [
        { definitionId: stepIds.number, value: 120 },
        { definitionId: stepIds.boolean, value: false },
      ],
      [
        { definitionId: stepIds.number, value: 'NaN' },
        { definitionId: stepIds.boolean, value: false },
      ],
      [
        { definitionId: stepIds.number, value: 'Infinity' },
        { definitionId: stepIds.boolean, value: false },
      ],
      [
        { definitionId: stepIds.number, value: '0.' + '0'.repeat(30) + '1' },
        { definitionId: stepIds.boolean, value: false },
      ],
      [
        { definitionId: stepIds.number, value: '1' },
        { definitionId: stepIds.boolean, value: 'true' },
      ],
      [
        { definitionId: stepIds.number, value: '1' },
        { definitionId: stepIds.boolean, value: 0 },
      ],
      [
        { definitionId: stepIds.number, value: '1' },
        { definitionId: stepIds.boolean, value: false },
        { definitionId: stepIds.text, value: 42 },
      ],
    ].map((parameterValues) => ({ parameterValues })),
  )(
    'rejette des valeurs sémantiquement invalides (%#)',
    async ({ parameterValues }) => {
      await request(app.getHttpServer())
        .post(route)
        .auth(tokens.owner, { type: 'bearer' })
        .send({ ...createStepInput(), parameterValues })
        .expect(400);
      expect(mocks.tx.fabricationStep.create).not.toHaveBeenCalled();
    },
  );
  it('accepte zéro, false et un texte vide, sans coercition', async () => {
    const response = await request(app.getHttpServer())
      .post(route)
      .auth(tokens.owner, { type: 'bearer' })
      .send({
        ...createStepInput(),
        parameterValues: [
          { definitionId: stepIds.number.toUpperCase(), value: '0' },
          { definitionId: stepIds.boolean, value: false },
          { definitionId: stepIds.text, value: '' },
        ],
      })
      .expect(201);
    expect(
      response.body.parameterValues.find(
        (value: { definitionId: string }) =>
          value.definitionId === stepIds.number,
      ).numericValue,
    ).toBe('0');
    expect(
      response.body.parameterValues.find(
        (value: { definitionId: string }) =>
          value.definitionId === stepIds.boolean,
      ).booleanValue,
    ).toBe(false);
  });
  it('conserve séparément les opérations répétées, réussies et échouées', async () => {
    const success = await request(app.getHttpServer())
      .post(route)
      .auth(tokens.owner, { type: 'bearer' })
      .send(createStepInput())
      .expect(201);
    const failure = await request(app.getHttpServer())
      .post(route)
      .auth(tokens.owner, { type: 'bearer' })
      .send({ ...createStepInput(), result: 'FAILURE' })
      .expect(201);
    expect(success.body.result).toBe('SUCCESS');
    expect(failure.body.result).toBe('FAILURE');
    expect(success.body.id).not.toBe(failure.body.id);
  });
  it.each(['owner', 'admin', 'other'] as const)(
    'permet la lecture historique à %s',
    async (role) => {
      prisma.fabricationStep.findMany.mockResolvedValue([mocks.legacy]);
      const response = await request(app.getHttpServer())
        .get(route)
        .auth(tokens[role], { type: 'bearer' })
        .expect(200);
      expect(response.body[0]).toMatchObject({
        parameters: 'temperature=120 C',
        stepTypeId: null,
        parameterValues: [],
      });
      expect(prisma.fabricationStep.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { performedAt: 'asc' },
            { recordedAt: 'asc' },
            { id: 'asc' },
          ],
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
  it('retourne les décimaux historiques structurés sous forme de chaînes exactes', async () => {
    const created = await mocks.tx.fabricationStep.create({
      data: {
        sampleId: stepIds.sample,
        stepTypeId: stepIds.type,
        operationName: 'Dépôt',
        performedAt: new Date(),
        result: 'FAILURE',
        recordedById: stepIds.owner,
        parameterValues: {
          create: [
            {
              definitionId: stepIds.number,
              numericValue: new Prisma.Decimal(exactDecimal),
            },
          ],
        },
      },
    });
    prisma.fabricationStep.findMany.mockResolvedValue([mocks.legacy, created]);
    const response = await request(app.getHttpServer())
      .get(route)
      .auth(tokens.other, { type: 'bearer' })
      .expect(200);
    expect(response.body[1].parameterValues[0].numericValue).toBe(exactDecimal);
    expect(response.body[0].parameters).toBe('temperature=120 C');
  });
  it.each(['get', 'post'] as const)(
    'retourne 404 pour un échantillon absent, méthode %s',
    async (method) => {
      mocks.tx.sample.findUnique.mockResolvedValue(null);
      await request(app.getHttpServer())
        [method](route)
        .auth(tokens.owner, { type: 'bearer' })
        .send(createStepInput())
        .expect(404);
    },
  );
});
