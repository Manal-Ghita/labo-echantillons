import { IsString, ValidateIf } from 'class-validator';

export class ListSamplesDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  q?: string;
}
