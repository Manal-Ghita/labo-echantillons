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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import {
  AttachSamplesDto,
  CreateBatchDto,
  CreateBatchStepsDto,
} from './batch.dto';
import { BatchesService } from './batches.service';

@Controller('batches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'RESEARCHER')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}
  @Get() findAll() {
    return this.batches.findAll();
  }
  @Get(':id') findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.batches.findOne(id);
  }
  @Post() create(
    @Body() dto: CreateBatchDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batches.create(dto, request.user);
  }
  @Post(':id/samples') attach(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AttachSamplesDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batches.attach(id, dto, request.user);
  }
  @Post(':id/steps') createSteps(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateBatchStepsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batches.createSteps(id, dto, request.user);
  }
}
