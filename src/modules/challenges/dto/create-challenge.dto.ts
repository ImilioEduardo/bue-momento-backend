import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateChallengeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(280)
  text: string;

  @ApiPropertyOptional({ enum: MediaType, default: MediaType.VIDEO })
  @IsEnum(MediaType)
  @IsOptional()
  mediaType?: MediaType;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(1000)
  @Type(() => Number)
  order: number;
}

/** Item do POST /challenges/bulk: `id` presente = desafio existente a actualizar. */
export class BulkChallengeItemDto extends CreateChallengeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;
}
