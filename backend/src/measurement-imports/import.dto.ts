import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ColumnMappingDto {
  @IsInt() @Min(0) @Max(49) column!: number;
  @IsUUID() definitionId!: string;
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(100)
  unit!: string | null;
}
export class PreviewImportDto {
  @IsUUID() attachmentId!: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  stepId?: string;
  @IsUUID() stepTypeId!: string;
  @IsIn([';', ',', '\t']) delimiter!: string;
  @IsIn(['.', ',']) decimalSeparator!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ColumnMappingDto)
  mappings!: ColumnMappingDto[];
}
export class ConfirmImportDto extends PreviewImportDto {
  @Equals(true) confirmed!: boolean;
  @IsString() @MaxLength(2048) previewToken!: string;
}
export class InspectCsvDto {
  @IsUUID() attachmentId!: string;
  @IsIn([';', ',', '\t']) delimiter!: string;
}
