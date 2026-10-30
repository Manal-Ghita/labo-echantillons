import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FabricationStepsController } from './fabrication-steps.controller';
import { FabricationStepsService } from './fabrication-steps.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FabricationStepsController],
  providers: [FabricationStepsService],
  exports: [FabricationStepsService],
})
export class FabricationStepsModule {}
