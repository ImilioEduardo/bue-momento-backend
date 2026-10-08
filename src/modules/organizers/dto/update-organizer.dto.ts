import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Só o nome pode ser alterado directamente.
 * Email/telefone: POST /me/contact/request + POST /me/contact/verify (OTP no novo contacto).
 * Campos extra (email, phone…) são descartados pelo ValidationPipe (whitelist).
 */
export class UpdateOrganizerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
}
