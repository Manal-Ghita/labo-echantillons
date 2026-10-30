import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsObject,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { StepResult } from '../generated/prisma/client';
import { CreateFabricationStepDto } from '../fabrication-steps/dto/create-fabrication-step.dto';

export class CreateBatchDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  reference!: string;
}

export class AttachSamplesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique((id: unknown) =>
    typeof id === 'string' ? id.toLowerCase() : id,
  )
  @IsUUID(undefined, { each: true })
  sampleIds!: string[];
}

export class BatchSampleResultDto {
  @IsUUID()
  sampleId!: string;

  @IsEnum(StepResult)
  result!: StepResult;
}

export class CreateBatchStepsDto {
  @ValidateNested()
  @Type(() => CreateFabricationStepDto)
  @IsDefined()
  @IsObject()
  operation!: CreateFabricationStepDto;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique((entry: BatchSampleResultDto | null) =>
    typeof entry?.sampleId === 'string'
      ? entry.sampleId.toLowerCase()
      : undefined,
  )
  @ValidateNested({ each: true })
  @Type(() => BatchSampleResultDto)
  samples!: BatchSampleResultDto[];
}
