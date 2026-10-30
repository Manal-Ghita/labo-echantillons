import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CreateResearcherDto } from './dto/create-researcher.dto';
import { UsersService } from './users.service';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get('operators')
  @Roles('ADMIN', 'RESEARCHER')
  findOperators() {
    return this.users.findOperators();
  }
  @Get()
  findAll() {
    return this.users.findAll();
  }
  @Post()
  create(@Body() dto: CreateResearcherDto) {
    return this.users.createResearcher(dto);
  }
  @Patch(':id/status')
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.updateStatus(
      id,
      dto.isActive,
      request.user.id,
      request.authVersion,
    );
  }
}
