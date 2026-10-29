import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';

export class ListStepTypesDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeInactive?: boolean;
}
