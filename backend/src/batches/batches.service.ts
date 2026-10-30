import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FabricationStepsService } from '../fabrication-steps/fabrication-steps.service';
import type {
  AttachSamplesDto,
  CreateBatchDto,
  CreateBatchStepsDto,
} from './batch.dto';

type Actor = Pick<AuthenticatedUser, 'id' | 'role'>;
const creator = { select: { id: true, name: true } } as const;

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly steps: FabricationStepsService,
  ) {}

  private owns(owner: string, actor: Actor) {
    if (actor.role !== 'ADMIN' && owner !== actor.id)
      throw new ForbiddenException(
        'Action réservée au propriétaire ou à ADMIN.',
      );
  }

  private async conflict<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const cause =
        error instanceof Error && error.name === 'DriverAdapterError'
          ? error.cause
          : undefined;
      const driverConflict =
        typeof cause === 'object' &&
        cause !== null &&
        'kind' in cause &&
        cause.kind === 'TransactionWriteConflict';
      if (
        driverConflict ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2003', 'P2025', 'P2034'].includes(error.code))
      )
        throw new ConflictException(
          'Référence déjà utilisée ou modification concurrente. Actualisez avant de réessayer.',
        );
      throw error;
    }
  }

  create(dto: CreateBatchDto, actor: Actor) {
    return this.conflict(() =>
      this.prisma.batch.create({
        data: { reference: dto.reference, createdById: actor.id },
        include: { createdBy: creator, _count: { select: { samples: true } } },
      }),
    );
  }

  findAll() {
    return this.prisma.batch.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { createdBy: creator, _count: { select: { samples: true } } },
    });
  }

  async findOne(id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: {
        createdBy: creator,
        samples: { orderBy: [{ reference: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!batch) throw new NotFoundException('Lot introuvable.');
    return batch;
  }

  attach(id: string, dto: AttachSamplesDto, actor: Actor) {
    return this.conflict(() =>
      this.prisma.$transaction(
        async (tx) => {
          const batch = await tx.batch.findUnique({ where: { id } });
          if (!batch) throw new NotFoundException('Lot introuvable.');
          this.owns(batch.createdById, actor);
          const ids = dto.sampleIds.map((value) => value.toLowerCase()).sort();
          const samples = await tx.sample.findMany({
            where: { id: { in: ids } },
          });
          if (samples.length !== ids.length)
            throw new NotFoundException('Un échantillon est introuvable.');
          for (const sample of samples) {
            this.owns(sample.creatorId, actor);
            if (sample.batchId && sample.batchId !== id.toLowerCase())
              throw new ConflictException(
                'Un échantillon appartient déjà à un autre lot.',
              );
          }
          const unattached = samples
            .filter((sample) => sample.batchId === null)
            .map((sample) => sample.id)
            .sort();
          if (unattached.length)
            await tx.sample.updateMany({
              where: { id: { in: unattached } },
              data: { batchId: id },
            });
          return { attached: unattached.length };
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  createSteps(id: string, dto: CreateBatchStepsDto, actor: Actor) {
    return this.conflict(() =>
      this.prisma.$transaction(
        async (tx) => {
          if (!(await tx.batch.findUnique({ where: { id } })))
            throw new NotFoundException('Lot introuvable.');
          const results = [];
          // Deterministic order reduces deadlocks; each realization remains independent.
          for (const entry of [...dto.samples].sort((a, b) =>
            a.sampleId.localeCompare(b.sampleId),
          )) {
            const sample = await tx.sample.findUnique({
              where: { id: entry.sampleId },
            });
            if (!sample)
              throw new NotFoundException('Échantillon introuvable.');
            if (sample.batchId !== id.toLowerCase())
              throw new ConflictException(
                'Un échantillon ne fait pas partie de ce lot.',
              );
            results.push(
              await this.steps.createInTransaction(
                tx,
                sample.id,
                {
                  stepTypeId: dto.operation.stepTypeId,
                  performedAt: dto.operation.performedAt,
                  result: entry.result,
                  parameterValues: dto.operation.parameterValues,
                  operatorId: dto.operation.operatorId,
                  observations: dto.operation.observations,
                },
                actor,
              ),
            );
          }
          return results;
        },
        { isolationLevel: 'Serializable', timeout: 15000 },
      ),
    );
  }
}
