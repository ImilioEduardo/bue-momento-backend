import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface GuestPayload {
  sub: string;
  eventId: string;
}

export const CurrentGuest = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GuestPayload => {
    const req = ctx.switchToHttp().getRequest<Request & { guest: GuestPayload }>();
    return req.guest;
  },
);
