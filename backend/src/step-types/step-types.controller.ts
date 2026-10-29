import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CreateStepTypeDto } from './dto/create-step-type.dto';
import { ListStepTypesDto } from './dto/list-step-types.dto';
import { UpdateStepTypeDto } from './dto/update-step-type.dto';
import { StepTypesService } from './step-types.service';

@Controller('step-types')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class StepTypesController {
  constructor(private readonly types: StepTypesService) {}

  @Get()
  findAll(
    @Query() query: ListStepTypesDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.types.findAll(
      query.includeInactive ?? false,
      request.user.role,
    );
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.types.findOne(id, request.user.role);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateStepTypeDto) {
    return this.types.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateStepTypeDto,
  ) {
    return this.types.update(id, dto);
  }
}
