import { mkdtemp, readdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileStorage } from './file-storage.service';
import { validateFile, maximumFileBytes } from './file-validation';
import { AttachmentsService } from './attachments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';

const csv = () => ({
  originalname: 'mesures.csv',
  mimetype: 'text/csv',
  buffer: Buffer.from('temps;valeur\n0;42.125\n'),
  size: 23,
});
const file = () => {
  const f = csv();
  f.size = f.buffer.length;
  return f;
};

describe('Attachments validation and private filesystem', () => {
  let directory: string;
  const old = process.env.ATTACHMENT_STORAGE_DIR,
    oldLimit = process.env.ATTACHMENT_MAX_BYTES;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'limsv2-files-'));
    process.env.ATTACHMENT_STORAGE_DIR = directory;
    delete process.env.ATTACHMENT_MAX_BYTES;
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    if (old === undefined) delete process.env.ATTACHMENT_STORAGE_DIR;
    else process.env.ATTACHMENT_STORAGE_DIR = old;
    if (oldLimit === undefined) delete process.env.ATTACHMENT_MAX_BYTES;
    else process.env.ATTACHMENT_MAX_BYTES = oldLimit;
  });
  it('accepts CSV UTF-8 and preserves exact bytes', async () => {
    expect(validateFile(file())).toEqual({
      originalName: 'mesures.csv',
      mimeType: 'text/csv',
      size: file().size,
    });
    const storage = new FileStorage(),
      key = randomUUID();
    await storage.write(key, file().buffer);
    expect(await storage.read(key)).toEqual(file().buffer);
    await expect(
      storage.write(key, Buffer.from('replacement')),
    ).rejects.toThrow();
    expect(await readFile(join(directory, key))).toEqual(file().buffer);
    await storage.remove(key);
    expect(await readdir(directory)).toEqual([]);
  });
  it.each([
    '../secret.csv',
    'dir/file.csv',
    'dir\\file.csv',
    'bad\r\n.csv',
    'a'.repeat(256) + '.csv',
  ])('rejects unsafe filename %s', (originalname) => {
    expect(() => validateFile({ ...file(), originalname })).toThrow();
  });
  it.each(['../../.env', '/etc/passwd', 'not-a-uuid'])(
    'rejects storage path %s',
    async (key) => {
      await expect(new FileStorage().read(key)).rejects.toThrow(
        'Invalid storage identifier',
      );
    },
  );
  it('rejects empty, missing, mismatched, oversized and forged files', () => {
    expect(() => validateFile(undefined)).toThrow();
    expect(() =>
      validateFile({ ...file(), buffer: Buffer.alloc(0), size: 0 }),
    ).toThrow();
    expect(() => validateFile({ ...file(), size: 100 })).toThrow();
    process.env.ATTACHMENT_MAX_BYTES = '2';
    expect(() => validateFile(file())).toThrow();
    delete process.env.ATTACHMENT_MAX_BYTES;
    expect(() =>
      validateFile({
        ...file(),
        originalname: 'image.png',
        mimetype: 'image/png',
      }),
    ).toThrow();
    expect(() =>
      validateFile({ ...file(), mimetype: 'application/pdf' }),
    ).toThrow();
    expect(() =>
      validateFile({ ...file(), buffer: Buffer.from([0xff, 0]), size: 2 }),
    ).toThrow();
    process.env.ATTACHMENT_MAX_BYTES = 'bad';
    expect(maximumFileBytes).toThrow();
  });
  it('accepts PNG, JPEG and PDF signatures, rejects extension mismatch', () => {
    const entries = [
      [
        'image.png',
        'image/png',
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      [
        'image.jpg',
        'image/jpeg',
        Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]),
      ],
      ['mesures.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n%%EOF')],
    ] as const;
    for (const [originalname, mimetype, buffer] of entries) {
      expect(
        validateFile({ originalname, mimetype, buffer, size: buffer.length })
          .mimeType,
      ).toBe(mimetype);
      expect(() =>
        validateFile({
          originalname: 'bad.exe',
          mimetype,
          buffer,
          size: buffer.length,
        }),
      ).toThrow();
    }
  });
});

describe('Attachments service consistency and permissions', () => {
  const owner = { id: randomUUID(), role: 'RESEARCHER' } as AuthenticatedUser;
  const admin = { id: randomUUID(), role: 'ADMIN' } as AuthenticatedUser;
  const sampleId = randomUUID(),
    stepId = randomUUID();
  let service: AttachmentsService;
  const storage = { write: jest.fn(), remove: jest.fn(), read: jest.fn() };
  const tx = {
    sample: { findUnique: jest.fn() },
    fabricationStep: { findFirst: jest.fn() },
    attachment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  beforeEach(() => {
    jest.resetAllMocks();
    tx.sample.findUnique.mockResolvedValue({ creatorId: owner.id });
    tx.fabricationStep.findFirst.mockResolvedValue({ id: stepId });
    tx.attachment.create.mockImplementation(async ({ data }) => ({
      ...data,
      storageKey: undefined,
    }));
    service = new AttachmentsService(
      {
        ...tx,
        $transaction: (work: (value: typeof tx) => unknown) => work(tx),
      } as unknown as PrismaService,
      storage as unknown as FileStorage,
    );
  });
  it.each([owner, admin])(
    'uses JWT author and permits owner/admin %j',
    async (actor) => {
      const result = await service.upload(sampleId, stepId, file(), actor);
      expect(result.createdById).toBe(actor.id);
      expect(tx.attachment.create.mock.calls[0][0].data).toMatchObject({
        sampleId,
        stepId,
        size: file().size,
      });
      expect(storage.write).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects another researcher, missing sample and mismatched step before storage', async () => {
    await expect(
      service.upload(sampleId, undefined, file(), {
        ...owner,
        id: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    tx.sample.findUnique.mockResolvedValue(null);
    await expect(
      service.upload(sampleId, undefined, file(), owner),
    ).rejects.toMatchObject({ status: 404 });
    tx.sample.findUnique.mockResolvedValue({ creatorId: owner.id });
    tx.fabricationStep.findFirst.mockResolvedValue(null);
    await expect(
      service.upload(sampleId, stepId, file(), owner),
    ).rejects.toMatchObject({ status: 404 });
    expect(storage.write).not.toHaveBeenCalled();
  });
  it('removes its own new file when metadata insertion fails', async () => {
    tx.attachment.create.mockRejectedValue(new Error('DB failure'));
    await expect(
      service.upload(sampleId, undefined, file(), owner),
    ).rejects.toThrow('DB failure');
    expect(storage.remove).toHaveBeenCalledWith(storage.write.mock.calls[0][0]);
  });
  it('does not create metadata or remove pre-existing paths when storage fails', async () => {
    storage.write.mockRejectedValue(new Error('disk full'));
    await expect(
      service.upload(sampleId, undefined, file(), owner),
    ).rejects.toThrow('disk full');
    expect(tx.attachment.create).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it('preserves bytes when a failed COMMIT may have succeeded', async () => {
    const prisma = {
      ...tx,
      $transaction: async (work: (value: typeof tx) => unknown) => {
        await work(tx);
        throw new Error('ambiguous commit');
      },
    };
    tx.attachment.findUnique.mockResolvedValue({ id: randomUUID() });
    service = new AttachmentsService(
      prisma as unknown as PrismaService,
      storage as unknown as FileStorage,
    );
    await expect(
      service.upload(sampleId, undefined, file(), owner),
    ).rejects.toThrow('ambiguous commit');
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it('returns 404 for absent metadata and 503 for missing/corrupt bytes', async () => {
    tx.attachment.findUnique.mockResolvedValue(null);
    await expect(service.download(randomUUID())).rejects.toMatchObject({
      status: 404,
    });
    tx.attachment.findUnique.mockResolvedValue({
      storageKey: randomUUID(),
      size: 2,
      sha256: 'a'.repeat(64),
    });
    storage.read.mockResolvedValue(Buffer.from('bad'));
    await expect(service.download(randomUUID())).rejects.toMatchObject({
      status: 503,
    });
  });
});
