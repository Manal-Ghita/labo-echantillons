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
export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
  authVersion: number;
};

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
    let authVersion: number;
    try {
      const payload = await this.jwt.verifyAsync<{
        sub?: unknown;
        exp?: unknown;
        authVersion?: unknown;
      }>(match[1]);
      if (
        typeof payload.sub !== 'string' ||
        !isUUID(payload.sub) ||
        typeof payload.exp !== 'number' ||
        typeof payload.authVersion !== 'number' ||
        !Number.isSafeInteger(payload.authVersion) ||
        payload.authVersion < 0
      )
        throw new Error('Invalid claims');
      subject = payload.sub;
      authVersion = payload.authVersion;
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré.');
    }
    request.user = await this.auth.findIdentity(subject, authVersion);
    request.authVersion = authVersion;
    return true;
  }
}
