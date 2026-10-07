import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { RequestOtpDto } from './dto/request-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { AdminLoginDto } from './dto/admin-login.dto.js';
import { JwtGuard } from './guards/jwt.guard.js';
import { CurrentOrganizer } from '../../common/decorators/current-organizer.decorator.js';
import type { OrganizerPayload } from '../../common/decorators/current-organizer.decorator.js';
import { UpdateOrganizerDto } from '../organizers/dto/update-organizer.dto.js';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/check')
  checkContact(@Body() dto: RequestOtpDto) {
    return this.authService.checkContact(dto.contact);
  }

  @Post('auth/otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

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
}
