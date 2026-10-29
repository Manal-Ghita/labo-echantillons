import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { SamplesModule } from './samples/samples.module';
import { HealthModule } from './health/health.module';
import { StepTypesModule } from './step-types/step-types.module';
import { FabricationStepsModule } from './fabrication-steps/fabrication-steps.module';

@Module({
  imports: [
    PrismaModule,
    SamplesModule,
    HealthModule,
    StepTypesModule,
    FabricationStepsModule,
  ],
})
export class AppModule {}
