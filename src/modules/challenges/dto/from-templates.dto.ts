import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FromTemplatesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  templateIds: string[];
}
