import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'node:crypto';
import request from 'supertest';
import { AttachmentsModule } from './attachments.module';
import { FileStorage } from './file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  fabricationMock,
  stepIds,
} from '../../test/support/fabrication-steps.fixture';

describe('Attachments HTTP with real JWT and simulated Prisma/storage', () => {
  let app: INestApplication, token: string;
  const oldSecret = process.env.JWT_SECRET;
  const fixture = fabricationMock();
  const buffer = Buffer.from('temps,valeur\n0,150.125\n');
  const storage = {
    write: jest.fn(),
    remove: jest.fn(),
    read: jest.fn().mockResolvedValue(buffer),
  };
  const attachment = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  };
  const prisma = {
    ...fixture.prisma,
    attachment,
    $transaction: (work: (tx: unknown) => unknown) =>
      work({ ...fixture.tx, attachment }),
  };
  const route = `/samples/${stepIds.sample}/files`;
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('base64url');
    const module = await Test.createTestingModule({
      imports: [AttachmentsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(FileStorage)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    await app.init();
    token = await module
      .get(JwtService)
      .signAsync({ sub: stepIds.owner, authVersion: 0 });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    fixture.prisma.sample.findUnique.mockResolvedValue({
      creatorId: stepIds.owner,
    });
    attachment.create.mockResolvedValue({
      id: stepIds.sample,
      originalName: 'mesures.csv',
      size: buffer.length,
    });
    attachment.findMany.mockResolvedValue([]);
  });
  afterAll(async () => {
    await app?.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
  it('rejects all unauthenticated routes including direct download', async () => {
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer())
      .post(route)
      .attach('file', buffer, 'mesures.csv')
      .expect(401);
    await request(app.getHttpServer())
      .get(`/files/${stepIds.sample}/download`)
      .expect(401);
    expect(storage.write).not.toHaveBeenCalled();
  });
  it('uploads multipart and exposes only the explicit public projection', async () => {
    await request(app.getHttpServer())
      .post(route)
      .auth(token, { type: 'bearer' })
      .attach('file', buffer, {
        filename: 'mesures.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    expect(attachment.create).toHaveBeenCalled();
    const { data, select } = attachment.create.mock.calls[0][0];
    expect(data.createdById).toBe(stepIds.owner);
    expect(select).not.toHaveProperty('storageKey');
    expect(select).not.toHaveProperty('sha256');
    expect(select.createdBy.select).toEqual({ id: true, name: true });
  });
  it('rejects missing file, forged media, extra fields and multiple files', async () => {
    await request(app.getHttpServer())
      .post(route)
      .auth(token, { type: 'bearer' })
      .expect(400);
    await request(app.getHttpServer())
      .post(route)
      .auth(token, { type: 'bearer' })
      .attach('file', buffer, 'fake.png')
      .expect(415);
    await request(app.getHttpServer())
      .post(route)
      .auth(token, { type: 'bearer' })
      .field('createdById', stepIds.other)
      .attach('file', buffer, 'mesures.csv')
      .expect(400);
    await request(app.getHttpServer())
      .post(route)
      .auth(token, { type: 'bearer' })
      .attach('file', buffer, 'a.csv')
      .attach('file', buffer, 'b.csv')
      .expect(400);
  });
  it('rejects files exceeding the multipart limit with 413', async () => {
    await request(app.getHttpServer())
      .post(route)
      .auth(token, { type: 'bearer' })
      .attach('file', Buffer.alloc(10485761, 65), 'big.csv')
      .expect(413);
    expect(storage.write).not.toHaveBeenCalled();
  });
  it('preserves UTF-8 original filenames from browser multipart uploads', async () => {
    await request(app.getHttpServer())
      .post(route)
      .auth(token, { type: 'bearer' })
      .attach('file', buffer, {
        filename: 'mesures-échantillon.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    expect(attachment.create.mock.calls[0][0].data.originalName).toBe(
      'mesures-échantillon.csv',
    );
  });
  it('downloads authenticated bytes as attachment, nosniff and no-store', async () => {
    attachment.findUnique.mockResolvedValue({
      originalName: 'mesures.csv',
      mimeType: 'text/csv',
      storageKey: stepIds.sample,
      size: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    });
    const response = await request(app.getHttpServer())
      .get(`/files/${stepIds.sample}/download`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(response.text).toBe(buffer.toString());
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('validates UUID route parameters', async () => {
    await request(app.getHttpServer())
      .get('/files/not-an-id/download')
      .auth(token, { type: 'bearer' })
      .expect(400);
  });
});
