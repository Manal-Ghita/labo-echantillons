import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { AttachmentsService } from './attachments.service';
import {
  maximumFileBytes,
  multipartFilename,
  type IncomingFile,
} from './file-validation';

@Controller()
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly files: AttachmentsService) {}

  @Get(['samples/:sampleId/files', 'samples/:sampleId/steps/:stepId/files'])
  list(
    @Param('sampleId', new ParseUUIDPipe()) sampleId: string,
    @Param('stepId', new ParseUUIDPipe({ optional: true })) stepId?: string,
  ) {
    return this.files.list(sampleId, stepId);
  }

  @Post(['samples/:sampleId/files', 'samples/:sampleId/steps/:stepId/files'])
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: maximumFileBytes(), files: 1, fields: 0, parts: 1 },
    }),
  )
  upload(
    @Param('sampleId', new ParseUUIDPipe()) sampleId: string,
    @Param('stepId', new ParseUUIDPipe({ optional: true }))
    stepId: string | undefined,
    @UploadedFile() file: IncomingFile | undefined,
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    if (body && Object.keys(body).length)
      throw new BadRequestException(
        'Aucune métadonnée fournie par le client n’est acceptée.',
      );
    return this.files.upload(
      sampleId,
      stepId,
      file
        ? { ...file, originalname: multipartFilename(file.originalname) }
        : undefined,
      request.user,
    );
  }

  @Get('files/:id/download')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  async download(@Param('id', new ParseUUIDPipe()) id: string) {
    const { data, metadata } = await this.files.download(id);
    return new StreamableFile(data, {
      type: metadata.mimeType,
      length: data.length,
      disposition: `attachment; filename="download${metadata.mimeType === 'text/csv' ? '.csv' : ''}"; filename*=UTF-8''${encodeURIComponent(metadata.originalName).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`,
    });
  }
}
