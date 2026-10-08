import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ModerationStatus } from '@prisma/client';

export class ModerateSubmissionDto {
  @ApiProperty({ enum: ModerationStatus })
  @IsEnum(ModerationStatus)
  status: ModerationStatus;
}
