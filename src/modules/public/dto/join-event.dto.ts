import { Equals, IsBoolean, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { PHONE_PATTERN } from '../../../common/validation/patterns.js';

export class JoinEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone tem de ser um telefone válido' })
  phone: string;

  @IsBoolean()
  @Equals(true, { message: 'É necessário aceitar o consentimento.' })
  consentAccepted: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceId: string;
}
