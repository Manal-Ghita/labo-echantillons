import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FabricationStepsModule } from '../fabrication-steps/fabrication-steps.module';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';

@Module({
  imports: [AuthModule, PrismaModule, FabricationStepsModule],
  controllers: [BatchesController],
  providers: [BatchesService],
})
export class BatchesModule {}
