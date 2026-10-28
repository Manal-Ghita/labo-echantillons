import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class CreateSampleDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  reference!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  description?: string;
}
