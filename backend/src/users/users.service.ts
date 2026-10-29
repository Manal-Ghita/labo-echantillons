import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { publicUserSelect } from '../auth/auth.service';
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
  findAll() {
    return this.prisma.user.findMany({
      select: publicUserSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
  async createResearcher(dto: CreateResearcherDto) {
    if (Buffer.byteLength(dto.password, 'utf8') > 72)
      throw new BadRequestException('Le mot de passe dépasse 72 octets UTF-8.');
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      return await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: 'RESEARCHER',
        },
        select: publicUserSelect,
      });
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
