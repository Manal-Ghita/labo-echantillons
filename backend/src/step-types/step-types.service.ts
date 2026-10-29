import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStepTypeDto } from './dto/create-step-type.dto';
import { UpdateStepTypeDto } from './dto/update-step-type.dto';

const withParameters = { parameters: { orderBy: { key: 'asc' as const } } };

@Injectable()
export class StepTypesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(includeInactive: boolean, role: Role) {
    if (includeInactive && role !== 'ADMIN') {
      throw new ForbiddenException(
        'La consultation des types inactifs est réservée aux administrateurs.',
      );
    }
    return this.prisma.stepType.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: withParameters,
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string, role: Role) {
    const type = await this.prisma.stepType.findFirst({
      where: { id, ...(role === 'ADMIN' ? {} : { isActive: true }) },
      include: withParameters,
    });
    if (!type) throw new NotFoundException('Type d’étape introuvable.');
    return type;
  }

  async create(dto: CreateStepTypeDto) {
    try {
      // A nested create is atomic: a conflicting parameter cannot leave an empty type.
      return await this.prisma.stepType.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description,
          parameters: {
            create: dto.parameters.map((parameter) => ({
              key: parameter.key,
              name: parameter.name,
              dataType: parameter.dataType,
              unit: parameter.unit,
              isRequired: parameter.isRequired,
            })),
          },
        },
        include: withParameters,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ce code de type ou cette clé de paramètre existe déjà.',
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateStepTypeDto) {
    const data: Prisma.StepTypeUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (!Object.keys(data).length)
      throw new BadRequestException(
        'Au moins un champ descriptif ou isActive est requis.',
      );
    try {
      // Code and definitions remain immutable, even before first use.
      // Only descriptive fields and availability may change; no history is deleted.
      return await this.prisma.stepType.update({
        where: { id },
        data,
        include: withParameters,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Type d’étape introuvable.');
      }
      throw error;
    }
  }
}
