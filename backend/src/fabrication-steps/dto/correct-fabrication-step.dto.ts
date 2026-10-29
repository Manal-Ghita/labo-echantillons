import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { StepResult } from '../../generated/prisma/client';
import { StepParameterValueDto } from './create-fabrication-step.dto';

export class CorrectFabricationStepDto {
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/)
  performedAt?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(StepResult)
  result?: StepResult;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsUUID()
  operatorId?: string | null;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  observations?: string | null;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  parameters?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayUnique(
    (parameter: StepParameterValueDto | null) => parameter?.definitionId,
  )
  @ValidateNested({ each: true })
  @Type(() => StepParameterValueDto)
  parameterValues?: StepParameterValueDto[];
}
