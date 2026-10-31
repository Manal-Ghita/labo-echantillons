import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { MeasurementImportsController } from './measurement-imports.controller';
import { MeasurementImportsService } from './measurement-imports.service';
@Module({
  imports: [AuthModule, PrismaModule, AttachmentsModule],
  controllers: [MeasurementImportsController],
  providers: [MeasurementImportsService],
})
export class MeasurementImportsModule {}
