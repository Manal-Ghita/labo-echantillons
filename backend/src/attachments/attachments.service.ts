import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { FileStorage } from './file-storage.service';
import { validateFile, type IncomingFile } from './file-validation';

const publicFields = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  createdAt: true,
  sampleId: true,
  stepId: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.AttachmentSelect;

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
  ) {}

  private async association(
    tx: Prisma.TransactionClient,
    sampleId: string,
    stepId?: string,
    actor?: AuthenticatedUser,
  ) {
    const sample = await tx.sample.findUnique({
      where: { id: sampleId },
      select: { creatorId: true },
    });
    if (!sample) throw new NotFoundException('Échantillon introuvable.');
    if (actor && actor.role !== 'ADMIN' && sample.creatorId !== actor.id)
      throw new ForbiddenException(
        'Seul le propriétaire ou ADMIN peut ajouter un fichier.',
      );
    if (
      stepId &&
      !(await tx.fabricationStep.findFirst({
        where: { id: stepId, sampleId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Étape introuvable pour cet échantillon.');
  }

  async list(sampleId: string, stepId?: string) {
    await this.association(this.prisma, sampleId, stepId);
    return this.prisma.attachment.findMany({
      where: { sampleId, stepId: stepId ?? null },
      select: publicFields,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async upload(
    sampleId: string,
    stepId: string | undefined,
    file: IncomingFile | undefined,
    actor: AuthenticatedUser,
  ) {
    const metadata = validateFile(file);
    const storageKey = randomUUID();
    let written = false;
    let metadataWritten = false;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.association(tx, sampleId, stepId, actor);
          await this.storage.write(storageKey, file!.buffer);
          written = true;
          const created = await tx.attachment.create({
            data: {
              ...metadata,
              storageKey,
              sha256: createHash('sha256').update(file!.buffer).digest('hex'),
              createdById: actor.id,
              sampleId,
              stepId: stepId ?? null,
            },
            select: publicFields,
          });
          metadataWritten = true;
          return created;
        },
        { isolationLevel: 'Serializable', timeout: 20000 },
      );
    } catch (error) {
      if (written) {
        // A lost connection during COMMIT has an ambiguous outcome. Never
        // remove a possibly committed file without checking the metadata.
        let removable = !metadataWritten;
        try {
          if (metadataWritten)
            removable = !(await this.prisma.attachment.findUnique({
              where: { storageKey },
              select: { id: true },
            }));
          if (removable) await this.storage.remove(storageKey);
          else
            this.logger.error(`Upload commit requires review: ${storageKey}`);
        } catch {
          this.logger.error(`Orphan file requires review: ${storageKey}`);
        }
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ConflictException('Conflit concurrent. Veuillez réessayer.');
      throw error;
    }
  }

  async download(id: string) {
    const metadata = await this.prisma.attachment.findUnique({ where: { id } });
    if (!metadata) throw new NotFoundException('Fichier introuvable.');
    try {
      const data = await this.storage.read(metadata.storageKey);
      if (
        data.length !== metadata.size ||
        createHash('sha256').update(data).digest('hex') !== metadata.sha256
      )
        throw new Error('Integrity failure');
      return { data, metadata };
    } catch {
      throw new ServiceUnavailableException(
        'Le fichier est indisponible. Contactez la responsable du laboratoire.',
      );
    }
  }
}
