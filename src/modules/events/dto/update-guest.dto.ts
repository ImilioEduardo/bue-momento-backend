import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGuestDto {
  @ApiPropertyOptional({ description: 'Bloquear (true) ou desbloquear (false) o convidado' })
  @IsOptional()
  @IsBoolean()
  blocked?: boolean;

  @ApiPropertyOptional({ description: 'Libertar o acesso para o convidado poder entrar noutro dispositivo' })
  @IsOptional()
  @IsBoolean()
  releaseDevice?: boolean;
}
