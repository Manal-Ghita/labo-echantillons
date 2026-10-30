import {
  BadRequestException,
  ConflictException,
  Injectable,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { publicUserSelect, toPublicUser } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateResearcherDto } from './dto/create-researcher.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}
  async updateStatus(
    id: string,
    isActive: boolean,
    actorId: string,
    actorVersion: number,
  ) {
    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          // Recheck the caller inside the same snapshot as the invariant.
          const actor = await tx.user.findUnique({
            where: { id: actorId },
            select: { role: true, isActive: true, authVersion: true },
          });
          if (!actor || !actor.isActive || actor.authVersion !== actorVersion)
            throw new UnauthorizedException('Session invalide.');
          if (actor.role !== 'ADMIN')
            throw new ForbiddenException(
              'Action réservée à un administrateur.',
            );
          const target = await tx.user.findUnique({
            where: { id },
            select: publicUserSelect,
          });
          if (!target) throw new NotFoundException('Compte introuvable.');
          if (!isActive && id.toLowerCase() === actorId.toLowerCase())
            throw new ForbiddenException(
              'Vous ne pouvez pas désactiver votre propre compte.',
            );
          if (target.isActive === isActive) return target;
          if (
            !isActive &&
            target.role === 'ADMIN' &&
            (await tx.user.count({
              where: { role: 'ADMIN', isActive: true },
            })) <= 1
          )
            throw new ConflictException(
              'Le dernier administrateur actif ne peut pas être désactivé.',
            );
          return tx.user.update({
            where: { id },
            data: { isActive, authVersion: { increment: 1 } },
            select: publicUserSelect,
          });
        },
        { isolationLevel: 'Serializable' },
      );
      return toPublicUser(updated);
    } catch (error) {
      // adapter-pg can surface a serialization/deadlock error at COMMIT directly
      // as DriverAdapterError, rather than wrapping it in Prisma P2034.
      const cause =
        error instanceof Error && error.name === 'DriverAdapterError'
          ? error.cause
          : undefined;
      const driverConflict =
        typeof cause === 'object' &&
        cause !== null &&
        'kind' in cause &&
        cause.kind === 'TransactionWriteConflict' &&
        'originalCode' in cause &&
        ['40001', '40P01'].includes(String(cause.originalCode));
      if (
        driverConflict ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2025'].includes(error.code))
      )
        throw new ConflictException(
          'Modification concurrente : actualisez les comptes avant de réessayer.',
        );
      throw error;
    }
  }
  async findOperators() {
    const users = await this.prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return users.map(({ id, name }) => ({ id, name }));
  }
  async findAll() {
    const users = await this.prisma.user.findMany({
      select: publicUserSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return users.map(toPublicUser);
  }
  async createResearcher(dto: CreateResearcherDto) {
    if (Buffer.byteLength(dto.password, 'utf8') > 72)
      throw new BadRequestException('Le mot de passe dépasse 72 octets UTF-8.');
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      return toPublicUser(
        await this.prisma.user.create({
          data: {
            name: dto.name,
            email: dto.email,
            passwordHash,
            role: 'RESEARCHER',
          },
          select: publicUserSelect,
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Cet email est déjà utilisé.');
      throw error;
    }
  }
}
