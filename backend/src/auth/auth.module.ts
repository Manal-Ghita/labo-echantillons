import 'dotenv/config';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || Buffer.byteLength(secret, 'utf8') < 32)
          throw new Error('JWT_SECRET doit contenir au moins 32 octets.');
        return {
          secret,
          signOptions: {
            algorithm: 'HS256' as const,
            expiresIn: 3600,
            issuer: 'labo-echantillons',
            audience: 'labo-api',
          },
          verifyOptions: {
            algorithms: ['HS256' as const],
            issuer: 'labo-echantillons',
            audience: 'labo-api',
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard, AuthService, JwtModule],
})
export class AuthModule {}
