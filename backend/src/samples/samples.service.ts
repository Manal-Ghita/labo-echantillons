import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSampleDto } from './dto/create-sample.dto';

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

  findAll(query?: string) {
    const q = query?.trim();
    return this.prisma.sample.findMany({
      where: q
        ? {
            OR: [
              { reference: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
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
}
