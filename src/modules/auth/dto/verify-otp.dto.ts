import { IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CONTACT_PATTERN } from '../../../common/validation/patterns.js';

export class VerifyOtpDto {
  @ApiProperty({ example: '+244912345678 ou email@exemplo.com' })
  @IsString()
  @MaxLength(254)
  @Matches(CONTACT_PATTERN, { message: 'contact tem de ser um email ou telefone válido' })
  contact: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code tem de ter 6 dígitos' })
  code: string;
}
