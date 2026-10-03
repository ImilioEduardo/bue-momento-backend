import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestOtpDto {
  @ApiProperty({ example: '+244912345678 ou email@exemplo.com' })
  @IsString()
  @IsNotEmpty()
  contact: string;
}
