import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class JoinEventDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsBoolean()
  consentAccepted: boolean;

  @IsString()
  @IsNotEmpty()
  deviceId: string;
}
