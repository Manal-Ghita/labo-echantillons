import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { SamplesModule } from './samples.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  fabricationMock,
  stepIds,
} from '../../test/support/fabrication-steps.fixture';

const duration = '1aa3deee-837d-4101-af94-abcb73c7bf11';
const batchId = '3deeffc4-a338-416b-af8d-a3c1cfe0e838';
const numeric = (fields: object) => ({
  parameterDefinitionId: stepIds.number,
  ...fields,
});
const query = (fields: Record<string, string>) =>
  '/samples?' + new URLSearchParams(fields).toString();
describe('Recherche avancée HTTP, JWT réel et Prisma simulé', () => {
  let app: INestApplication, token: string;
  const oldSecret = process.env.JWT_SECRET;
  const fixture = fabricationMock();
  const findMany = jest.fn().mockResolvedValue([]);
  const definitions = {
    findUnique: jest
      .fn()
      .mockResolvedValue({ id: stepIds.number, dataType: 'NUMBER' }),
    findMany: jest.fn(),
  };
  const types = {
    findMany: jest
      .fn()
      .mockResolvedValue([
        { id: stepIds.type, name: 'Recuit', code: 'RECUIT', isActive: false },
      ]),
  };
  const prisma = {
    ...fixture.prisma,
    sample: { ...fixture.prisma.sample, findMany },
    parameterDefinition: definitions,
    stepType: types,
  };
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64url');
    const module = await Test.createTestingModule({ imports: [SamplesModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    await app.init();
    token = await module
      .get(JwtService)
      .signAsync({ sub: stepIds.other, authVersion: 0 });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    definitions.findMany.mockResolvedValue([
      { id: stepIds.number, dataType: 'NUMBER' },
      { id: duration, dataType: 'NUMBER' },
      { id: stepIds.text, dataType: 'TEXT' },
    ]);
  });
  afterAll(async () => {
    await app?.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
  const get = (fields: Record<string, string>) =>
    request(app.getHttpServer())
      .get(query(fields))
      .auth(token, { type: 'bearer' });

  it('combine texte, statut, lot, type et nombres avec ET, sur une même étape', async () => {
    await get({
      q: 'PET',
      status: 'ACTIVE',
      batchId,
      stepTypeId: stepIds.type,
      matchMode: 'SAME_STEP',
      numericFilters: JSON.stringify([
        numeric({ eq: '150.12345678901234567890123456789' }),
        { parameterDefinitionId: duration, min: '10', max: '20' },
      ]),
    }).expect(200);
    const and = findMany.mock.calls[0][0].where.AND;
    expect(and[0].OR).toHaveLength(2);
    expect(and[1]).toEqual({ status: 'ACTIVE' });
    expect(and[2]).toEqual({ batchId });
    const steps = and[3].steps.some.AND;
    expect(steps[0]).toEqual({ stepTypeId: stepIds.type });
    expect(steps[1].parameterValues.some.numericValue.equals.toFixed()).toBe(
      '150.12345678901234567890123456789',
    );
    expect(steps[2].parameterValues.some.numericValue.gte.toFixed()).toBe('10');
    expect(steps[2].parameterValues.some.numericValue.lte.toFixed()).toBe('20');
    expect(definitions.findMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(and)).not.toContain('creatorId');
  });
  it('autorise des étapes différentes et répète un paramètre sans fusionner les conditions', async () => {
    await get({
      stepTypeId: stepIds.type,
      matchMode: 'ANY_STEP',
      numericFilters: JSON.stringify([
        numeric({ eq: '120' }),
        numeric({ eq: '150' }),
      ]),
    }).expect(200);
    const and = findMany.mock.calls[0][0].where.AND;
    expect(and).toHaveLength(3);
    expect(and[0].steps.some).toEqual({ stepTypeId: stepIds.type });
    expect(
      and[1].steps.some.parameterValues.some.numericValue.equals.toFixed(),
    ).toBe('120');
    expect(
      and[2].steps.some.parameterValues.some.numericValue.equals.toFixed(),
    ).toBe('150');
    expect(definitions.findMany.mock.calls[0][0].where.id.in).toEqual([
      stepIds.number,
    ]);
  });
  it('conserve deux contraintes distinctes du même paramètre en mode même étape', async () => {
    await get({
      matchMode: 'SAME_STEP',
      numericFilters: JSON.stringify([
        numeric({ min: '120' }),
        numeric({ max: '150' }),
      ]),
    }).expect(200);
    expect(findMany.mock.calls[0][0].where.AND[0].steps.some.AND).toHaveLength(
      2,
    );
  });
  it('combine le filtre historique avec les nouveaux critères en conservant zéro', async () => {
    await get({
      parameterDefinitionId: stepIds.number,
      min: '0',
      max: '0',
      matchMode: 'SAME_STEP',
      numericFilters: JSON.stringify([
        { parameterDefinitionId: duration, eq: '0' },
      ]),
    }).expect(200);
    const steps = findMany.mock.calls[0][0].where.AND[0].steps.some.AND;
    expect(steps[0].parameterValues.some.numericValue.gte.toFixed()).toBe('0');
    expect(steps[0].parameterValues.some.numericValue.lte.toFixed()).toBe('0');
    expect(steps[1].parameterValues.some.numericValue.equals.toFixed()).toBe(
      '0',
    );
  });
  it('préserve la forme de la recherche historique sans paramètre nouveau', async () => {
    await get({
      parameterDefinitionId: stepIds.number,
      min: '120',
      max: '150',
    }).expect(200);
    expect(
      findMany.mock.calls[0][0].where.steps.some.parameterValues.some.numericValue.gte.toFixed(),
    ).toBe('120');
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('AND');
  });
  it.each(['ACTIVE', 'ABANDONED', 'UNSPECIFIED'])(
    'filtre le statut %s sans exiger une étape',
    async (status) => {
      await get({ status }).expect(200);
      expect(findMany.mock.calls[0][0].where).toEqual({
        AND: [{ status: status === 'UNSPECIFIED' ? null : status }],
      });
      expect(definitions.findMany).not.toHaveBeenCalled();
    },
  );
  it.each([
    { status: 'INVALID' },
    { batchId: 'bad' },
    { stepTypeId: 'bad' },
    { matchMode: 'OR' },
    { operator: 'OR' },
    { numericFilters: '{broken' },
    { numericFilters: '{}' },
    { numericFilters: 'null' },
    { numericFilters: ' '.repeat(4001) },
    {
      numericFilters: JSON.stringify(
        Array.from({ length: 11 }, () => numeric({ eq: '150' })),
      ),
    },
    { numericFilters: JSON.stringify([numeric({ eq: 150 })]) },
    { numericFilters: JSON.stringify([numeric({ eq: null })]) },
    { numericFilters: JSON.stringify([numeric({ eq: '1e2' })]) },
    { numericFilters: JSON.stringify([numeric({ eq: '1,5' })]) },
    { numericFilters: JSON.stringify([numeric({ eq: '150', min: '100' })]) },
    { numericFilters: JSON.stringify([numeric({ min: '151', max: '150' })]) },
    { numericFilters: JSON.stringify([numeric({})]) },
    {
      numericFilters: JSON.stringify([
        { parameterDefinitionId: 'bad', eq: '150' },
      ]),
    },
    {
      numericFilters: JSON.stringify([
        { parameterDefinitionId: stepIds.text, eq: '150' },
      ]),
    },
    { numericFilters: JSON.stringify([numeric({ eq: '150', role: 'ADMIN' })]) },
    { numericFilters: JSON.stringify([numeric({ eq: '1'.repeat(36) })]) },
    {
      numericFilters: JSON.stringify([numeric({ eq: '0.' + '1'.repeat(31) })]),
    },
    { status: 'ACTIVE', min: '150' },
    {
      parameterDefinitionId: stepIds.number,
      numericFilters: JSON.stringify(
        Array.from({ length: 10 }, () => numeric({ eq: '150' })),
      ),
    },
  ])('rejette une recherche invalide (%#)', async (fields) => {
    await get(fields as Record<string, string>).expect(400);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('refuse les paramètres répétés et les recherches non authentifiées', async () => {
    await request(app.getHttpServer())
      .get(query({ numericFilters: '[]' }) + '&numericFilters=[]')
      .auth(token, { type: 'bearer' })
      .expect(400);
    await request(app.getHttpServer())
      .get(query({ status: 'ACTIVE' }))
      .expect(401);
  });
  it('expose uniquement les métadonnées de recherche actives ou historiques, sans modifier les permissions du catalogue', async () => {
    await request(app.getHttpServer())
      .get('/samples/search-operation-types')
      .expect(401);
    await request(app.getHttpServer())
      .get('/samples/search-operation-types')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(types.findMany).toHaveBeenCalledWith({
      where: { OR: [{ isActive: true }, { steps: { some: {} } }] },
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });
});
