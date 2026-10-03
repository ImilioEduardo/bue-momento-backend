import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NOTIFIER } from '../notifications/notifier.interface.js';
import type { Notifier } from '../notifications/notifier.interface.js';
import { RequestOtpDto } from './dto/request-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { UpdateOrganizerDto } from '../organizers/dto/update-organizer.dto.js';

const OTP_THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_PER_WINDOW = 3;
const OTP_MAX_ATTEMPTS = 5;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  async checkContact(contact: string): Promise<{ exists: boolean }> {
    const isEmail = contact.includes('@');
    const organizer = await this.prisma.organizer.findFirst({
      where: isEmail ? { email: contact } : { phone: contact },
      select: { id: true },
    });
    return { exists: !!organizer };
  }

  async requestOtp(dto: RequestOtpDto): Promise<{ message: string }> {
    const windowStart = new Date(Date.now() - OTP_THROTTLE_WINDOW_MS);
    const recentCount = await this.prisma.otpCode.count({
      where: { target: dto.contact, createdAt: { gte: windowStart } },
    });
    if (recentCount >= OTP_MAX_PER_WINDOW) {
      throw new ConflictException({
        code: 'OTP_RATE_LIMIT',
        message: 'Demasiados pedidos. Tenta novamente em 10 minutos.',
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_THROTTLE_WINDOW_MS);

    await this.prisma.otpCode.create({
      data: { target: dto.contact, codeHash, expiresAt },
    });

    const isEmail = dto.contact.includes('@');
    if (isEmail) {
      await this.notifier.sendEmail(
        dto.contact,
        'O teu código de acesso — Bué Momentos',
        `<p>O teu código é: <strong>${code}</strong></p><p>Válido por 10 minutos.</p>`,
      );
    } else {
      await this.notifier.sendSms(dto.contact, `Bué Momentos: o teu código é ${code}. Válido 10 min.`);
    }

    return { message: 'Código enviado com sucesso.' };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        target: dto.contact,
        expiresAt: { gt: new Date() },
        attempts: { lt: OTP_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        message: 'Código inválido ou expirado.',
      });
    }

    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });

    const valid = await bcrypt.compare(dto.code, otpRecord.codeHash);
    if (!valid) {
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        message: 'Código incorreto.',
      });
    }

    await this.prisma.otpCode.delete({ where: { id: otpRecord.id } });

    const isEmail = dto.contact.includes('@');
    let organizer = await this.prisma.organizer.findFirst({
      where: isEmail ? { email: dto.contact } : { phone: dto.contact },
    });

    if (!organizer) {
      organizer = await this.prisma.organizer.create({
        data: {
          name: '',
          ...(isEmail ? { email: dto.contact } : { phone: dto.contact }),
        },
      });
    }

    const tokens = await this.issueTokens(organizer.id);
    return { ...tokens, organizer };
  }

  async refresh(refreshToken: string) {
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_INVALID',
        message: 'Token de renovação inválido ou expirado.',
      });
    }

    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    return this.issueTokens(stored.organizerId);
  }

  async getMe(organizerId: string) {
    const organizer = await this.prisma.organizer.findUnique({ where: { id: organizerId } });
    if (!organizer) throw new NotFoundException({ code: 'ORGANIZER_NOT_FOUND', message: 'Organizador não encontrado.' });
    return organizer;
  }

  async updateMe(organizerId: string, dto: UpdateOrganizerDto) {
    return this.prisma.organizer.update({ where: { id: organizerId }, data: dto });
  }

  private async issueTokens(organizerId: string) {
    const payload = { sub: organizerId };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const rawRefresh = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawRefresh).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { organizerId, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken: rawRefresh };
  }
}
