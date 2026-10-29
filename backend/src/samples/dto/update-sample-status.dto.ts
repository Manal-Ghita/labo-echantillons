import { IsEnum } from 'class-validator';
import { SampleStatus } from '../../generated/prisma/client';

export class UpdateSampleStatusDto {
  @IsEnum(SampleStatus)
  status!: SampleStatus;
}
