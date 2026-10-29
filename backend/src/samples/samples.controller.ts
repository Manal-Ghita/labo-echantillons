import {
  Body,
  Post,
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
    return this.samples.findAll(query.q);
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
}
