import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { SamplesModule } from './samples/samples.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [PrismaModule, SamplesModule, HealthModule],
})
export class AppModule {}
