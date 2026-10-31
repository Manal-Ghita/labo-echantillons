import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { SamplesModule } from './samples/samples.module';
import { HealthModule } from './health/health.module';
import { StepTypesModule } from './step-types/step-types.module';
import { FabricationStepsModule } from './fabrication-steps/fabrication-steps.module';
import { UsersModule } from './users/users.module';
import { BatchesModule } from './batches/batches.module';
import { AttachmentsModule } from './attachments/attachments.module';

@Module({
  imports: [
    PrismaModule,
    SamplesModule,
    HealthModule,
    StepTypesModule,
    FabricationStepsModule,
    UsersModule,
    BatchesModule,
    AttachmentsModule,
  ],
})
export class AppModule {}
