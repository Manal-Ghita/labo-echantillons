import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SamplesController],
  providers: [SamplesService],
  exports: [SamplesService],
})
export class SamplesModule {}
