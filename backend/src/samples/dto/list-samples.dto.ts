import {
  IsString,
  IsUUID,
  ValidateIf,
  IsIn,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Transform, plainToInstance } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';

export class NumericSearchFilterDto {
  @IsUUID()
  parameterDefinitionId!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  eq?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  min?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  max?: string;
}

function parseNumericFilters(value: unknown) {
  if (typeof value !== 'string' || value.length > 4000)
    throw new BadRequestException(
      'numericFilters doit être un tableau JSON de 4000 caractères maximum.',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BadRequestException('numericFilters contient un JSON invalide.');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 10 ||
    parsed.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        Object.values(item).some((v) => typeof v !== 'string'),
    )
  )
    throw new BadRequestException(
      'Au maximum 10 filtres numériques avec des valeurs textuelles sont autorisés.',
    );
  return parsed.map((item) => plainToInstance(NumericSearchFilterDto, item));
}

export class ListSamplesDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  q?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  parameterDefinitionId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  min?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  max?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['ACTIVE', 'ABANDONED', 'UNSPECIFIED'])
  status?: 'ACTIVE' | 'ABANDONED' | 'UNSPECIFIED';

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  batchId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  stepTypeId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['ANY_STEP', 'SAME_STEP'])
  matchMode?: 'ANY_STEP' | 'SAME_STEP';

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => parseNumericFilters(value))
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  numericFilters?: NumericSearchFilterDto[];
}
