import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { RequestOtpDto } from './dto/request-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { AdminLoginDto } from './dto/admin-login.dto.js';
import { JwtGuard } from './guards/jwt.guard.js';
import { CurrentOrganizer } from '../../common/decorators/current-organizer.decorator.js';
import type { OrganizerPayload } from '../../common/decorators/current-organizer.decorator.js';
import { UpdateOrganizerDto } from '../organizers/dto/update-organizer.dto.js';
import { ConfirmContactChangeDto, RequestContactChangeDto } from './dto/contact-change.dto.js';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('auth/otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

  // Chamado a partir do servidor Next.js (todos os pedidos chegam com o IP da Vercel), por isso
  // não se limita por IP aqui: o limite é por contacto, aplicado no AuthService
  // (tentativas atómicas por código + máximo de códigos por janela e por dia).
  @SkipThrottle()
  @Post('auth/otp/verify')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyOtp(dto);
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TTL_MS,
      path: '/',
    });
    return { accessToken: result.accessToken, organizer: result.organizer };
  }

  // Também chamado a partir do servidor Next.js; o bloqueio após falhas está no AuthService.
  @SkipThrottle()
  @Post('auth/admin-login')
  async adminLogin(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.adminLogin(dto);
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TTL_MS,
      path: '/',
    });
    return { accessToken: result.accessToken };
  }

  // Chamado pelo proxy do Next.js em cada pedido /admin; o token tem 256 bits (sem brute force útil).
  @SkipThrottle()
  @Post('auth/verify-session')
  async verifySession(@Req() req: Request) {
    const token = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException({
        code: 'SESSION_MISSING',
        message: 'Sessão não encontrada.',
      });
    }
    return this.authService.verifySession(token);
  }

  @SkipThrottle()
  @Post('auth/refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_MISSING',
        message: 'Sessão expirada. Faz login novamente.',
      });
    }
    const result = await this.authService.refresh(token);
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TTL_MS,
      path: '/',
    });
    return { accessToken: result.accessToken };
  }

  // Revoga a sessão no servidor (antes o "Sair" só apagava o cookie no browser)
  @SkipThrottle()
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (token) await this.authService.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Get('me')
  getMe(@CurrentOrganizer() organizer: OrganizerPayload) {
    return this.authService.getMe(organizer.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Patch('me')
  updateMe(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Body() dto: UpdateOrganizerDto,
  ) {
    return this.authService.updateMe(organizer.sub, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('me/contact/request')
  requestContactChange(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Body() dto: RequestContactChangeDto,
  ) {
    return this.authService.requestContactChange(organizer.sub, dto.contact);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('me/contact/verify')
  confirmContactChange(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Body() dto: ConfirmContactChangeDto,
  ) {
    return this.authService.confirmContactChange(organizer.sub, dto.contact, dto.code);
  }
}
