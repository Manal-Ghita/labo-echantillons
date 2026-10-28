import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';

@Injectable()
export class AdminBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async create(name: string, email: string, password: string) {
    if (
      !name.trim() ||
      !isEmail(email) ||
      email.length > 254 ||
      password.length < 12 ||
      Buffer.byteLength(password, 'utf8') > 72
    ) {
      throw new BadRequestException(
        'Nom/email invalides ou mot de passe hors limites (12 caractères minimum, 72 octets maximum).',
      );
    }
    const passwordHash = await this.passwords.hash(password);
    try {
      await this.prisma.$transaction(
        async (tx) => {
          if (await tx.user.count({ where: { role: 'ADMIN' } })) {
            throw new ConflictException('Un administrateur existe déjà.');
          }
          await tx.user.create({
            data: { name: name.trim(), email, passwordHash, role: 'ADMIN' },
            select: { id: true },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException(
          'Email déjà utilisé ou création concurrente ; aucun compte remplacé.',
        );
      }
      throw error;
    }
  }
}
