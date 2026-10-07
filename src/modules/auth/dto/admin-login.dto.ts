import { IsString, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  phone: string;

  @IsString()
  @MinLength(1)
  password: string;
}
