import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { PasswordService } from './password.service';
import type { Prisma } from '../generated/prisma/client';

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  isActive: true,
} as const;

export function toPublicUser(
  user: Prisma.UserGetPayload<{ select: typeof publicUserSelect }>,
) {
  const { id, name, email, role, createdAt, isActive } = user;
  return { id, name, email, role, createdAt, isActive };
}

@Injectable()
export class AuthService {
  // Calculated once; unknown emails still perform a password comparison.
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
  ) {
    this.dummyHash = passwords.hash(randomBytes(32).toString('base64'));
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { ...publicUserSelect, passwordHash: true, authVersion: true },
    });
    const valid = await this.passwords.verify(
      dto.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !valid || !user.isActive)
      throw new UnauthorizedException('Email ou mot de passe incorrect.');
    return {
      access_token: await this.jwt.signAsync({
        sub: user.id,
        authVersion: user.authVersion,
      }),
      token_type: 'Bearer',
      expires_in: 3600,
    };
  }

  async findIdentity(id: string, authVersion: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...publicUserSelect, authVersion: true },
    });
    if (!user || !user.isActive || user.authVersion !== authVersion)
      throw new UnauthorizedException('Session invalide.');
    return toPublicUser(user);
  }
}
