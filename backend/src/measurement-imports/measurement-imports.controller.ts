import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { MeasurementImportsService } from './measurement-imports.service';
import {
  ConfirmImportDto,
  InspectCsvDto,
  PreviewImportDto,
} from './import.dto';

@Controller('samples/:sampleId/imports')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class MeasurementImportsController {
  constructor(private readonly imports: MeasurementImportsService) {}
  @Get() list(@Param('sampleId', new ParseUUIDPipe()) sampleId: string) {
    return this.imports.list(sampleId);
  }
  @Get(':id') detail(
    @Param('sampleId', new ParseUUIDPipe()) sampleId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.imports.detail(sampleId, id);
  }
  @Post('inspect') inspect(
    @Param('sampleId', new ParseUUIDPipe()) sampleId: string,
    @Body() dto: InspectCsvDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.imports.inspect(sampleId, dto, req.user);
  }
  @Post('preview') preview(
    @Param('sampleId', new ParseUUIDPipe()) sampleId: string,
    @Body() dto: PreviewImportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.imports.preview(sampleId, dto, req.user);
  }
  @Post() confirm(
    @Param('sampleId', new ParseUUIDPipe()) sampleId: string,
    @Body() dto: ConfirmImportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.imports.confirm(sampleId, dto, req.user);
  }
}
