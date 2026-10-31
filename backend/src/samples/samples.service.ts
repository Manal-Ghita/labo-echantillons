import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSampleDto } from './dto/create-sample.dto';
import { ListSamplesDto } from './dto/list-samples.dto';
import { decimalValue } from '../fabrication-steps/decimal-value';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import type { SampleStatus } from '../generated/prisma/client';
import { SplitSampleDto } from './dto/split-sample.dto';
import { advancedSampleWhere } from './advanced-search';

@Injectable()
export class SamplesService {
  private readonly validation = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  constructor(private readonly prisma: PrismaService) {}

  // creatorId must come from a trusted server-side identity, never the DTO.
  async create(input: CreateSampleDto, creatorId: string) {
    if (!creatorId) {
      throw new UnauthorizedException('Un créateur identifié est requis.');
    }
    const dto: CreateSampleDto = await this.validation.transform(input, {
      type: 'body',
      metatype: CreateSampleDto,
    });
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { id: true },
    });
    if (!creator) {
      throw new UnauthorizedException('Le créateur est inconnu.');
    }
    try {
      return await this.prisma.sample.create({
        data: {
          reference: dto.reference,
          name: dto.name,
          description: dto.description,
          creator: { connect: { id: creatorId } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Cette référence existe déjà.');
        }
        if (error.code === 'P2003' || error.code === 'P2025') {
          throw new UnauthorizedException('Le créateur est inconnu.');
        }
      }
      throw error;
    }
  }

  async findAll(query?: string, filter: ListSamplesDto = {}) {
    const q = query?.trim();
    if (
      filter.status !== undefined ||
      filter.batchId !== undefined ||
      filter.stepTypeId !== undefined ||
      filter.matchMode !== undefined ||
      filter.numericFilters !== undefined
    ) {
      return this.prisma.sample.findMany({
        where: await advancedSampleWhere(this.prisma, q, filter),
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
    }
    const where: Prisma.SampleWhereInput = q
      ? {
          OR: [
            { reference: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    if (
      !filter.parameterDefinitionId &&
      (filter.min !== undefined || filter.max !== undefined)
    )
      throw new BadRequestException(
        'Choisissez un paramètre numérique avant les bornes.',
      );
    if (filter.parameterDefinitionId) {
      const min =
        filter.min === undefined ? undefined : decimalValue(filter.min);
      const max =
        filter.max === undefined ? undefined : decimalValue(filter.max);
      if (min && max && min.gt(max))
        throw new BadRequestException(
          'La borne minimale dépasse la borne maximale.',
        );
      const definition = await this.prisma.parameterDefinition.findUnique({
        where: { id: filter.parameterDefinitionId },
      });
      if (!definition || definition.dataType !== 'NUMBER')
        throw new BadRequestException('Définition numérique inconnue.');
      where.steps = {
        some: {
          parameterValues: {
            some: {
              definitionId: definition.id,
              numericValue: {
                not: null,
                ...(min ? { gte: min } : {}),
                ...(max ? { lte: max } : {}),
              },
            },
          },
        },
      };
    }
    return this.prisma.sample.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  async updateStatus(
    id: string,
    status: SampleStatus,
    actor: Pick<AuthenticatedUser, 'id' | 'role'>,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const sample = await tx.sample.findUnique({ where: { id } });
          if (!sample) throw new NotFoundException('Échantillon introuvable.');
          if (actor.role !== 'ADMIN' && sample.creatorId !== actor.id)
            throw new ForbiddenException(
              'Action réservée au propriétaire ou à ADMIN.',
            );
          return tx.sample.update({ where: { id }, data: { status } });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2025'].includes(error.code)
      )
        throw new ConflictException(
          'L’échantillon a changé ; veuillez réessayer.',
        );
      throw error;
    }
  }

  async findOne(id: string) {
    const sample = await this.prisma.sample.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, reference: true, name: true } },
        children: {
          select: { id: true, reference: true, name: true, status: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        originStep: {
          select: { id: true, operationName: true, performedAt: true },
        },
      },
    });
    if (!sample) {
      throw new NotFoundException('Échantillon introuvable.');
    }
    return sample;
  }

  async split(
    id: string,
    dto: SplitSampleDto,
    actor: Pick<AuthenticatedUser, 'id' | 'role'>,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const parent = await tx.sample.findUnique({ where: { id } });
          if (!parent)
            throw new NotFoundException('Échantillon parent introuvable.');
          if (actor.role !== 'ADMIN' && actor.id !== parent.creatorId)
            throw new ForbiddenException(
              'Découpe réservée au propriétaire ou à ADMIN.',
            );
          // Existing links are not editable here. New UUIDs make newly introduced
          // cycles impossible; also refuse propagation from an inconsistent ancestry.
          const seen = new Set<string>();
          let ancestor: { id: string; parentId: string | null } | null = parent;
          while (ancestor) {
            if (seen.has(ancestor.id))
              throw new ConflictException(
                'La filiation existante contient un cycle.',
              );
            seen.add(ancestor.id);
            if (!ancestor.parentId) break;
            ancestor = await tx.sample.findUnique({
              where: { id: ancestor.parentId },
              select: { id: true, parentId: true },
            });
            if (!ancestor)
              throw new ConflictException(
                'La filiation existante est incohérente.',
              );
          }
          if (dto.originStepId) {
            const origin = await tx.fabricationStep.findUnique({
              where: { id: dto.originStepId },
              select: { sampleId: true },
            });
            if (!origin)
              throw new NotFoundException('Étape d’origine introuvable.');
            if (origin.sampleId !== parent.id)
              throw new BadRequestException(
                'L’étape d’origine doit appartenir au parent.',
              );
          }
          const children = [];
          for (const child of dto.children)
            children.push(
              await tx.sample.create({
                data: {
                  reference: child.reference,
                  name: child.name,
                  description: child.description,
                  creatorId: actor.id,
                  parentId: parent.id,
                  originStepId: dto.originStepId,
                  status: 'ACTIVE',
                },
              }),
            );
          return children;
        },
        { isolationLevel: 'Serializable', timeout: 15000 },
      );
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
          'Référence déjà utilisée ou modification concurrente : aucun enfant créé.',
        );
      throw error;
    }
  }

  numericParameters() {
    return this.prisma.parameterDefinition.findMany({
      where: {
        dataType: 'NUMBER',
        OR: [{ stepType: { isActive: true } }, { values: { some: {} } }],
      },
      include: {
        stepType: {
          select: { id: true, code: true, name: true, isActive: true },
        },
      },
      orderBy: [{ stepType: { code: 'asc' } }, { key: 'asc' }],
    });
  }

  searchOperationTypes() {
    return this.prisma.stepType.findMany({
      where: { OR: [{ isActive: true }, { steps: { some: {} } }] },
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
}
