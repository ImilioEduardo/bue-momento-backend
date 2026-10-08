import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @MaxLength(30)
  phone: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}
