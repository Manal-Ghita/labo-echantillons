import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { MeasurementImportsModule } from './measurement-imports.module';
import { FileStorage } from '../attachments/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  fabricationMock,
  stepIds,
} from '../../test/support/fabrication-steps.fixture';

describe('Measurement imports HTTP, real JWT and simulated dependencies', () => {
  let app: INestApplication, jwt: JwtService, tokens: Record<string, string>;
  const fixture = fabricationMock(),
    attachmentId = randomUUID(),
    sourceStep = randomUUID();
  const oldSecret = process.env.JWT_SECRET;
  let bytes: Buffer, source: Record<string, unknown>;
  const type = {
    id: stepIds.type,
    isActive: true,
    parameters: [
      {
        id: stepIds.number,
        key: 'temperature',
        name: 'Température',
        unit: '°C',
        dataType: 'NUMBER',
        isRequired: true,
      },
      {
        id: stepIds.text,
        key: 'material',
        name: 'Matériau',
        unit: null,
        dataType: 'TEXT',
        isRequired: false,
      },
      {
        id: stepIds.boolean,
        key: 'ok',
        name: 'Contrôle',
        unit: null,
        dataType: 'BOOLEAN',
        isRequired: true,
      },
    ],
  };
  const measurementImport = {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  };
  const attachment = { findUnique: jest.fn() },
    stepType = { findUnique: jest.fn() },
    fabricationStep = { findFirst: jest.fn() };
  const tx = {
    ...fixture.tx,
    attachment,
    stepType,
    fabricationStep,
    measurementImport,
  };
  const prisma = {
    ...fixture.prisma,
    ...tx,
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const base = () => ({
    attachmentId,
    stepTypeId: stepIds.type,
    delimiter: ';',
    decimalSeparator: '.',
    mappings: [
      { column: 0, definitionId: stepIds.number, unit: '°C' },
      { column: 1, definitionId: stepIds.text, unit: null },
      { column: 2, definitionId: stepIds.boolean, unit: null },
    ],
  });
  const route = `/samples/${stepIds.sample}/imports`;
  const post = (path: string, body: unknown, role = 'owner') =>
    request(app.getHttpServer())
      .post(route + path)
      .auth(tokens[role], { type: 'bearer' })
      .send(body);
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64url');
    const module = await Test.createTestingModule({
      imports: [MeasurementImportsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(FileStorage)
      .useValue({ read: async () => bytes })
      .compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
    tokens = {};
    for (const role of ['owner', 'other', 'admin'] as const)
      tokens[role] = await jwt.signAsync({
        sub: stepIds[role],
        authVersion: 0,
      });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    bytes = Buffer.from(
      'Température (°C);Matériau;Contrôle\n150.123456789012345678901234567890;PET;false\n120;Aluminium;1',
    );
    source = {
      id: attachmentId,
      sampleId: stepIds.sample,
      stepId: null,
      mimeType: 'text/csv',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      storageKey: randomUUID(),
    };
    attachment.findUnique.mockImplementation(async () => ({
      ...source,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }));
    fixture.prisma.sample.findUnique.mockResolvedValue({
      creatorId: stepIds.owner,
    });
    stepType.findUnique.mockResolvedValue(type);
    fabricationStep.findFirst.mockResolvedValue({ stepTypeId: stepIds.type });
    measurementImport.findUnique.mockResolvedValue(null);
    measurementImport.findMany.mockResolvedValue([]);
    measurementImport.create.mockImplementation(async ({ data }) => ({
      id: randomUUID(),
      rowCount: data.rowCount,
    }));
  });
  afterAll(async () => {
    await app?.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
  it('inspects and previews without writes, confirms exact typed values only with explicit consent', async () => {
    const inspect = await post('/inspect', {
      attachmentId,
      delimiter: ';',
    }).expect(201);
    expect(inspect.body.rowCount).toBe(2);
    const preview = await post('/preview', base()).expect(201);
    expect(preview.body.canConfirm).toBe(true);
    expect(preview.body.rows[0].cells[0]).toBe(
      '150.123456789012345678901234567890',
    );
    expect(measurementImport.create).not.toHaveBeenCalled();
    await post('', {
      ...base(),
      previewToken: preview.body.previewToken,
      confirmed: false,
    }).expect(400);
    await post('', {
      ...base(),
      previewToken: preview.body.previewToken,
      confirmed: true,
    }).expect(201);
    const { data, select } = measurementImport.create.mock.calls[0][0];
    expect(data.createdById).toBe(stepIds.owner);
    expect(data.values.createMany.data[0].numericValue).toBe(
      '150.12345678901234567890123456789',
    );
    expect(data.values.createMany.data[2].booleanValue).toBe(false);
    expect(select.createdBy.select).toEqual({ id: true, name: true });
  });
  it('rejects unauthenticated access, another researcher imports and forged author fields', async () => {
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer())
      .post(route + '/preview')
      .send(base())
      .expect(401);
    await post('/preview', base(), 'other').expect(403);
    await post('/preview', { ...base(), createdById: stepIds.admin }).expect(
      400,
    );
    await request(app.getHttpServer())
      .get(route)
      .auth(tokens.other, { type: 'bearer' })
      .expect(200);
    await post('/preview', base(), 'admin').expect(201);
  });
  it('rejects unknown/duplicate mappings, incompatible units and foreign associations', async () => {
    const dto = base();
    await post('/preview', {
      ...dto,
      mappings: [dto.mappings[0], dto.mappings[0]],
    }).expect(400);
    await post('/preview', {
      ...dto,
      mappings: [{ ...dto.mappings[0], unit: 'K' }],
    }).expect(400);
    await post('/preview', {
      ...dto,
      mappings: [{ ...dto.mappings[0], definitionId: randomUUID() }],
    }).expect(400);
    await post('/preview', {
      ...dto,
      mappings: [{ ...dto.mappings[0], column: 49 }],
    }).expect(400);
    source.sampleId = stepIds.other;
    await post('/preview', dto).expect(404);
    source.sampleId = stepIds.sample;
    source.stepId = sourceStep;
    await post('/preview', dto).expect(400);
    source.stepId = null;
    fabricationStep.findFirst.mockResolvedValue({ stepTypeId: randomUUID() });
    await post('/preview', { ...dto, stepId: sourceStep }).expect(400);
  });
  it('reports invalid lines, booleans and precision overflow without accepting an import', async () => {
    bytes = Buffer.from(
      'Température;Matériau;Contrôle\n1e3;PET;yes\n' +
        '1'.repeat(36) +
        ';PET;false\n120;PET',
    );
    const preview = await post('/preview', base()).expect(201);
    expect(preview.body.canConfirm).toBe(false);
    expect(preview.body.previewToken).toBeNull();
    expect(preview.body.validRowCount).toBe(0);
    expect(preview.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 2 }),
        expect.objectContaining({ line: 3 }),
        expect.objectContaining({ line: 4 }),
      ]),
    );
    expect(measurementImport.create).not.toHaveBeenCalled();
  });
  it('normalizes comma decimals as strings, never floating-point numbers', async () => {
    bytes = Buffer.from(
      'Température (°C);Matériau;Contrôle\n150,12345678901234567890123456789;PET;true',
    );
    const dto = { ...base(), decimalSeparator: ',' };
    const preview = await post('/preview', dto).expect(201);
    await post('', {
      ...dto,
      previewToken: preview.body.previewToken,
      confirmed: true,
    }).expect(201);
    expect(
      measurementImport.create.mock.calls[0][0].data.values.createMany.data[0]
        .numericValue,
    ).toBe('150.12345678901234567890123456789');
  });
  it('prevents duplicates and rejects changed, expired, foreign or tampered preview tokens', async () => {
    const dto = base(),
      p = (await post('/preview', dto).expect(201)).body;
    await request(app.getHttpServer())
      .get(route)
      .auth(p.previewToken, { type: 'bearer' })
      .expect(401);
    await post('', {
      ...dto,
      previewToken: 'tampered',
      confirmed: true,
    }).expect(409);
    await post('', {
      ...dto,
      decimalSeparator: ',',
      previewToken: p.previewToken,
      confirmed: true,
    }).expect(409);
    await post(
      '',
      { ...dto, previewToken: p.previewToken, confirmed: true },
      'admin',
    ).expect(409);
    const expired = await jwt.signAsync(
      { purpose: 'measurement-import-preview' },
      { expiresIn: -1 },
    );
    await post('', { ...dto, previewToken: expired, confirmed: true }).expect(
      409,
    );
    bytes = Buffer.from('Température (°C);Matériau;Contrôle\n151;PET;true');
    await post('', {
      ...dto,
      previewToken: p.previewToken,
      confirmed: true,
    }).expect(409);
    measurementImport.findUnique.mockResolvedValue({ id: randomUUID() });
    expect((await post('/preview', dto)).body.duplicate).toBe(true);
    await post('', {
      ...dto,
      previewToken: p.previewToken,
      confirmed: true,
    }).expect(409);
    expect(measurementImport.create).not.toHaveBeenCalled();
  });
  it('keeps DB failure visible and never returns a successful partial import', async () => {
    const dto = base(),
      p = (await post('/preview', dto)).body;
    measurementImport.create.mockRejectedValue(
      new Error('Synthetic nested insert failure'),
    );
    await post('', {
      ...dto,
      previewToken: p.previewToken,
      confirmed: true,
    }).expect(500);
  });
});
