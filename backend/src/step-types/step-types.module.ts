import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StepTypesController } from './step-types.controller';
import { StepTypesService } from './step-types.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [StepTypesController],
  providers: [StepTypesService],
})
export class StepTypesModule {}
