import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateEventDto } from './create-event.dto.js';

export class UpdateEventDto extends PartialType(CreateEventDto) {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  planId?: string;
}
