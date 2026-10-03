import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateChallengeDto {
  @ApiProperty()
  @IsString()
  text: string;

  @ApiPropertyOptional({ enum: MediaType, default: MediaType.VIDEO })
  @IsEnum(MediaType)
  @IsOptional()
  mediaType?: MediaType;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  order: number;
}
