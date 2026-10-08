import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsTimeZone,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Distribution } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateEventDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty()
  @IsDateString()
  startAt: string;

  @ApiProperty()
  @IsDateString()
  endAt: string;

  @ApiPropertyOptional({ default: 'Africa/Luanda' })
  @IsTimeZone()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ enum: Distribution, default: Distribution.RANDOM })
  @IsEnum(Distribution)
  @IsOptional()
  distribution?: Distribution;

  @ApiPropertyOptional({ default: 3 })
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  @IsOptional()
  challengesPerGuest?: number;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  moderationEnabled?: boolean;
}
