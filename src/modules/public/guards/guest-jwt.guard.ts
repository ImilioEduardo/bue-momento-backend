import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { GuestPayload } from '../decorators/current-guest.decorator.js';

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
      const payload = await this.jwt.verifyAsync<GuestPayload & { type: string }>(token, {
        secret: this.config.get<string>('JWT_GUEST_SECRET'),
      });
      if (payload.type !== 'guest') throw new Error('wrong type');

      const guest = await this.prisma.guest.findUnique({
        where: { id: payload.sub },
        select: { id: true },
      });
      if (!guest) throw new UnauthorizedException({ code: 'GUEST_NOT_FOUND' });

      req.guest = { sub: payload.sub, eventId: payload.eventId };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException({ code: 'GUEST_TOKEN_INVALID' });
    }
  }
}
