import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EXTRAS } from '../../plans/extras.js';

export const EXTRA_CODES = EXTRAS.map((e) => e.code) as string[];

export class CheckoutDto {
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  planId: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(EXTRAS.length)
  @IsIn(EXTRA_CODES, { each: true })
  extraIds: string[];
}

export class AddExtrasDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(EXTRAS.length)
  @IsIn(EXTRA_CODES, { each: true })
  extraIds: string[];
}
