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
import { CreateFabricationStepDto } from './dto/create-fabrication-step.dto';
import { FabricationStepsService } from './fabrication-steps.service';
import { CorrectFabricationStepDto } from './dto/correct-fabrication-step.dto';

@Controller('samples/:sampleId/steps')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class FabricationStepsController {
  constructor(private readonly steps: FabricationStepsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'RESEARCHER')
  create(
    @Param('sampleId', new ParseUUIDPipe()) sampleId: string,
    @Body() dto: CreateFabricationStepDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.steps.create(sampleId, dto, request.user);
  }

  @Get()
  findAll(@Param('sampleId', new ParseUUIDPipe()) sampleId: string) {
    return this.steps.findAll(sampleId);
  }

  @Post(':stepId/corrections')
  correct(
    @Param('sampleId', new ParseUUIDPipe()) sampleId: string,
    @Param('stepId', new ParseUUIDPipe()) stepId: string,
    @Body() dto: CorrectFabricationStepDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.steps.correct(sampleId, stepId, dto, request.user);
  }

  @Get(':stepId/corrections')
  corrections(
    @Param('sampleId', new ParseUUIDPipe()) sampleId: string,
    @Param('stepId', new ParseUUIDPipe()) stepId: string,
  ) {
    return this.steps.findCorrections(sampleId, stepId);
  }
}
