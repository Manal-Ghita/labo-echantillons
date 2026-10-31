import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { FileStorage } from './file-storage.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, FileStorage],
  exports: [FileStorage],
})
export class AttachmentsModule {}
