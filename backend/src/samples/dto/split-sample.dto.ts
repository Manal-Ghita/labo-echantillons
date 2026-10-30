import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateSampleDto } from './create-sample.dto';

export class SplitSampleDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  originStepId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique((child: CreateSampleDto | null) =>
    typeof child?.reference === 'string' ? child.reference.trim() : undefined,
  )
  @ValidateNested({ each: true })
  @Type(() => CreateSampleDto)
  children!: CreateSampleDto[];
}
