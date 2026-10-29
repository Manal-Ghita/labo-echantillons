import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ParameterDataType } from '../../generated/prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateParameterDefinitionDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_]*$/)
  key!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(ParameterDataType)
  dataType!: ParameterDataType;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  unit?: string;

  @IsBoolean()
  isRequired!: boolean;
}

export class CreateStepTypeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  code!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  description?: string;

  @IsArray()
  @ArrayUnique(
    (parameter: CreateParameterDefinitionDto | null) => parameter?.key,
  )
  @ValidateNested({ each: true })
  @Type(() => CreateParameterDefinitionDto)
  parameters!: CreateParameterDefinitionDto[];
}
