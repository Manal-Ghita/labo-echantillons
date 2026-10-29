import {
  ConflictException,
  BadRequestException,
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

  async findOne(id: string) {
    const sample = await this.prisma.sample.findUnique({ where: { id } });
    if (!sample) {
      throw new NotFoundException('Échantillon introuvable.');
    }
    return sample;
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
}
