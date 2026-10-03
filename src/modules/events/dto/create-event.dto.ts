import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Distribution } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateEventDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsDateString()
  startAt: string;

  @ApiProperty()
  @IsDateString()
  endAt: string;

  @ApiPropertyOptional({ default: 'Africa/Luanda' })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ enum: Distribution, default: Distribution.RANDOM })
  @IsEnum(Distribution)
  @IsOptional()
  distribution?: Distribution;

  @ApiPropertyOptional({ default: 3 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  challengesPerGuest?: number;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  moderationEnabled?: boolean;
}
