import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { GuestPayload } from '../decorators/current-guest.decorator.js';

@Injectable()
export class GuestJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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
      req.guest = { sub: payload.sub, eventId: payload.eventId };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'GUEST_TOKEN_INVALID' });
    }
  }
}
