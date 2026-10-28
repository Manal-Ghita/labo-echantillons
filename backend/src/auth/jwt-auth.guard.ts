import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { AuthService } from './auth.service';

export type AuthenticatedUser = Awaited<
  ReturnType<AuthService['findIdentity']>
>;
export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match) throw new UnauthorizedException('Token requis.');
    let subject: string;
    try {
      const payload = await this.jwt.verifyAsync<{
        sub?: unknown;
        exp?: unknown;
      }>(match[1]);
      if (
        typeof payload.sub !== 'string' ||
        !isUUID(payload.sub) ||
        typeof payload.exp !== 'number'
      )
        throw new Error('Invalid claims');
      subject = payload.sub;
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré.');
    }
    request.user = await this.auth.findIdentity(subject);
    return true;
  }
}
