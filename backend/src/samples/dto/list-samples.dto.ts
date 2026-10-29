import { IsString, IsUUID, ValidateIf } from 'class-validator';

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
}
