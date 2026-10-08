import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { GuestPayload } from '../decorators/current-guest.decorator.js';
import { GUEST_VERIFY_OPTIONS } from '../../../common/security/jwt.constants.js';

@Injectable()
export class GuestJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { guest: GuestPayload }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException({ code: 'GUEST_TOKEN_MISSING' });

    const token = auth.slice(7);
    try {
      const payload = await this.jwt.verifyAsync<GuestPayload & { type: string; did?: string }>(token, {
        ...GUEST_VERIFY_OPTIONS,
        secret: this.config.get<string>('JWT_GUEST_SECRET'),
      });
      if (payload.type !== 'guest') throw new Error('wrong type');

      const guest = await this.prisma.guest.findUnique({
        where: { id: payload.sub },
        select: { id: true, eventId: true, deviceId: true, blockedAt: true },
      });
      if (!guest || guest.eventId !== payload.eventId) throw new UnauthorizedException({ code: 'GUEST_NOT_FOUND' });
      // Bloqueado pelo organizador: o token deixa de servir (antes: continuava a enviar ficheiros)
      if (guest.blockedAt) throw new ForbiddenException({ code: 'GUEST_BLOCKED', message: 'O teu acesso a este evento foi bloqueado.' });
      // Acesso libertado/transferido para outro dispositivo: o token antigo deixa de valer
      if (!payload.did || payload.did !== guest.deviceId) {
        throw new UnauthorizedException({ code: 'GUEST_SESSION_REPLACED', message: 'Sessão terminada. Entra novamente no evento.' });
      }

      req.guest = { sub: payload.sub, eventId: payload.eventId };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) throw err;
      throw new UnauthorizedException({ code: 'GUEST_TOKEN_INVALID' });
    }
  }
}
