import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDefined,
  IsEnum,
  IsISO8601,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { StepResult } from '../../generated/prisma/client';

export class StepParameterValueDto {
  @IsUUID()
  definitionId!: string;

  // The definition determines the type; do not coerce numbers or booleans.
  @IsDefined()
  value!: unknown;
}

export class CreateFabricationStepDto {
  @IsUUID()
  stepTypeId!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/)
  performedAt!: string;

  @IsEnum(StepResult)
  result!: StepResult;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  operatorId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  observations?: string;

  @IsArray()
  @ArrayUnique(
    (parameter: StepParameterValueDto | null) => parameter?.definitionId,
  )
  @ValidateNested({ each: true })
  @Type(() => StepParameterValueDto)
  parameterValues!: StepParameterValueDto[];
}
