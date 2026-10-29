import {
  Body,
  Post,
  Patch,
  Req,
  UseGuards,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CreateSampleDto } from './dto/create-sample.dto';
import { ListSamplesDto } from './dto/list-samples.dto';
import { SamplesService } from './samples.service';
import { UpdateSampleStatusDto } from './dto/update-sample-status.dto';

@Controller('samples')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class SamplesController {
  constructor(private readonly samples: SamplesService) {}

  @Get()
  findAll(@Query() query: ListSamplesDto) {
    return this.samples.findAll(query.q, query);
  }

  @Get('numeric-parameters')
  numericParameters() {
    return this.samples.numericParameters();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.samples.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'RESEARCHER')
  create(@Body() dto: CreateSampleDto, @Req() request: AuthenticatedRequest) {
    return this.samples.create(dto, request.user.id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSampleStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.samples.updateStatus(id, dto.status, request.user);
  }
}
