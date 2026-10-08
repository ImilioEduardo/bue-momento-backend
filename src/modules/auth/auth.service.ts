import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { safeEqual } from '../../common/security/safe-compare.js';
import { normalizeContact } from './contact.util.js';
import { ORGANIZER_SIGN_OPTIONS } from '../../common/security/jwt.constants.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NOTIFIER } from '../notifications/notifier.interface.js';
import type { Notifier } from '../notifications/notifier.interface.js';
import { RequestOtpDto } from './dto/request-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { UpdateOrganizerDto } from '../organizers/dto/update-organizer.dto.js';
import { AdminLoginDto } from './dto/admin-login.dto.js';

const OTP_THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_PER_WINDOW = 3;
const OTP_DAY_MS = 24 * 60 * 60 * 1000;
const OTP_MAX_PER_DAY = 10;
const OTP_MAX_ATTEMPTS = 5;
const ADMIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_MAX_FAILURES = 5;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;
// Tolerância para renovações simultâneas legítimas antes de tratar reutilização como roubo
const REFRESH_REUSE_GRACE_MS = 10_000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  // Falhas recentes de login de admin (memória do processo; há um único admin)
  private adminFailures: number[] = [];

  private otpInvalid() {
    // Mensagem única para não revelar se existe um código activo para o contacto
    return new UnauthorizedException({ code: 'OTP_INVALID', message: 'Código inválido ou expirado.' });
  }

  /**
   * Gera e envia um OTP. `target` é a chave interna (contacto de login, ou
   * "change:<organizerId>:<contacto>" para troca de contacto); `deliverTo` é para onde se envia.
   */
  private async sendOtp(target: string, deliverTo: string): Promise<void> {
    const now = Date.now();
    const [recentCount, dayCount] = await Promise.all([
      this.prisma.otpCode.count({
        where: { target, createdAt: { gte: new Date(now - OTP_THROTTLE_WINDOW_MS) } },
      }),
      this.prisma.otpCode.count({
        where: { target, createdAt: { gte: new Date(now - OTP_DAY_MS) } },
      }),
    ]);
    if (recentCount >= OTP_MAX_PER_WINDOW || dayCount >= OTP_MAX_PER_DAY) {
      throw new ConflictException({
        code: 'OTP_RATE_LIMIT',
        message: 'Demasiados pedidos. Tenta novamente mais tarde.',
      });
    }

    // Gerador criptograficamente seguro (Math.random é previsível)
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(now + OTP_THROTTLE_WINDOW_MS);

    // Invalida códigos anteriores ainda activos. Não se apagam as linhas porque são
    // elas que contam para o limite por janela/dia.
    await this.prisma.otpCode.updateMany({
      where: { target, expiresAt: { gt: new Date(now) } },
      data: { expiresAt: new Date(now) },
    });

    await this.prisma.otpCode.create({
      data: { target, codeHash, expiresAt },
    });

    if (deliverTo.includes('@')) {
      await this.notifier.sendEmail(
        deliverTo,
        'O teu código de acesso — Bué Momentos',
        `<p>O teu código é: <strong>${code}</strong></p><p>Válido por 10 minutos.</p>`,
      );
    } else {
      await this.notifier.sendSms(deliverTo, `Bué Momentos: o teu código é ${code}. Válido 10 min.`);
    }
  }

  /** Valida e consome um OTP de forma atómica. Lança OTP_INVALID em qualquer falha. */
  private async consumeOtp(target: string, code: string): Promise<void> {
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        target,
        expiresAt: { gt: new Date() },
        attempts: { lt: OTP_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) throw this.otpInvalid();

    // Incremento atómico e condicional ANTES de comparar: pedidos em paralelo já não
    // conseguem ultrapassar o limite de tentativas (antes: ler → comparar → incrementar).
    const { count } = await this.prisma.otpCode.updateMany({
      where: { id: otpRecord.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) throw this.otpInvalid();

    const valid = await bcrypt.compare(code, otpRecord.codeHash);
    if (!valid) throw this.otpInvalid();

    // Consumo atómico: se outro pedido já usou este código, este falha.
    const consumed = await this.prisma.otpCode.deleteMany({ where: { id: otpRecord.id } });
    if (consumed.count === 0) throw this.otpInvalid();
  }

  async requestOtp(dto: RequestOtpDto): Promise<{ message: string }> {
    const contact = normalizeContact(dto.contact);
    await this.sendOtp(contact, contact);
    return { message: 'Código enviado com sucesso.' };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const contact = normalizeContact(dto.contact);
    await this.consumeOtp(contact, dto.code);

    const isEmail = contact.includes('@');
    let organizer = await this.prisma.organizer.findFirst({
      where: isEmail ? { email: contact } : { phone: contact },
    });

    if (!organizer) {
      organizer = await this.prisma.organizer.create({
        data: {
          name: '',
          ...(isEmail ? { email: contact } : { phone: contact }),
        },
      });
    }

    const tokens = await this.issueTokens(organizer.id);
    return { ...tokens, organizer };
  }

  // ── Troca de email/telefone: só com OTP enviado para o NOVO contacto ──────────

  private contactChangeTarget(organizerId: string, contact: string) {
    return `change:${organizerId}:${contact}`;
  }

  async requestContactChange(organizerId: string, rawContact: string): Promise<{ message: string }> {
    const contact = normalizeContact(rawContact);
    await this.sendOtp(this.contactChangeTarget(organizerId, contact), contact);
    return { message: 'Código enviado para o novo contacto.' };
  }

  async confirmContactChange(organizerId: string, rawContact: string, code: string) {
    const contact = normalizeContact(rawContact);
    await this.consumeOtp(this.contactChangeTarget(organizerId, contact), code);

    const isEmail = contact.includes('@');
    try {
      return await this.prisma.organizer.update({
        where: { id: organizerId },
        data: isEmail ? { email: contact } : { phone: contact },
      });
    } catch (err) {
      // P2002 = violação de unique: o contacto já pertence a outra conta
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({ code: 'CONTACT_IN_USE', message: 'Este contacto já está associado a outra conta.' });
      }
      throw err;
    }
  }

  // ── Sessões (refresh tokens com rotação e deteção de reutilização) ────────────

  private hashToken(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

  async verifySession(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      include: { organizer: { select: { isAdmin: true } } },
    });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: 'Sessão inválida ou expirada.',
      });
    }
    return { valid: true, isAdmin: stored.organizer.isAdmin ?? false };
  }

  async refresh(refreshToken: string) {
    const invalid = () =>
      new UnauthorizedException({
        code: 'REFRESH_TOKEN_INVALID',
        message: 'Token de renovação inválido ou expirado.',
      });

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
    });
    const now = new Date();
    if (!stored || stored.expiresAt <= now) throw invalid();

    if (stored.revokedAt) {
      // Pedidos de renovação simultâneos (dois separadores) usam o mesmo token por instantes:
      // dentro da janela de tolerância não se trata como ataque.
      if (now.getTime() - stored.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS) throw invalid();

      // Token já rodado a ser reutilizado → provavelmente roubado: revoga a sessão inteira.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      this.logger.warn(`Refresh token reutilizado — sessão ${stored.familyId} revogada (organizer ${stored.organizerId})`);
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Sessão terminada por segurança. Faz login novamente.',
      });
    }

    // Rotação atómica: só um pedido consegue "gastar" este token
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count === 0) throw invalid();

    return this.issueTokens(stored.organizerId, stored.familyId);
  }

  /** Logout: revoga a sessão inteira (todos os tokens da família) no servidor. */
  async logout(refreshToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      select: { familyId: true },
    });
    if (!stored) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(organizerId: string) {
    const organizer = await this.prisma.organizer.findUnique({ where: { id: organizerId } });
    if (!organizer) throw new NotFoundException({ code: 'ORGANIZER_NOT_FOUND', message: 'Organizador não encontrado.' });
    return organizer;
  }

  async adminLogin(dto: AdminLoginDto) {
    const adminPhone = this.config.get<string>('ADMIN_PHONE') ?? '';
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD') ?? '';

    const now = Date.now();
    this.adminFailures = this.adminFailures.filter((t) => now - t < ADMIN_LOCK_WINDOW_MS);
    if (this.adminFailures.length >= ADMIN_MAX_FAILURES) {
      throw new HttpException(
        { code: 'ADMIN_LOCKED', message: 'Demasiadas tentativas. Tenta novamente dentro de 15 minutos.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Comparação em tempo constante (avalia sempre as duas para não revelar qual falhou)
    const phoneOk = safeEqual(dto.phone, adminPhone);
    const passwordOk = safeEqual(dto.password, adminPassword);
    if (!adminPhone || !adminPassword || !phoneOk || !passwordOk) {
      this.adminFailures.push(now);
      throw new UnauthorizedException({ code: 'ADMIN_INVALID_CREDENTIALS', message: 'Credenciais inválidas.' });
    }
    this.adminFailures = [];

    // Garante que o organizer admin existe na BD
    let organizer = await this.prisma.organizer.findFirst({ where: { phone: adminPhone } });
    if (!organizer) {
      organizer = await this.prisma.organizer.create({
        data: { name: 'Admin', phone: adminPhone, isAdmin: true },
      });
    } else if (!organizer.isAdmin) {
      organizer = await this.prisma.organizer.update({
        where: { id: organizer.id },
        data: { isAdmin: true },
      });
    }

    return this.issueTokens(organizer.id);
  }

  async updateMe(organizerId: string, dto: UpdateOrganizerDto) {
    // Só o nome. Email/telefone mudam apenas via /me/contact/* (com OTP no novo contacto).
    return this.prisma.organizer.update({ where: { id: organizerId }, data: { name: dto.name } });
  }

  private async issueTokens(organizerId: string, familyId: string = randomUUID()) {
    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
      select: { isAdmin: true },
    });
    const payload = { sub: organizerId, isAdmin: organizer?.isAdmin ?? false };
    const accessToken = await this.jwtService.signAsync(payload, {
      ...ORGANIZER_SIGN_OPTIONS,
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const rawRefresh = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefresh);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { organizerId, tokenHash, expiresAt, familyId },
    });

    return { accessToken, refreshToken: rawRefresh };
  }
}
