import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface OrganizerPayload {
  sub: string;
  isAdmin: boolean;
  email?: string;
  phone?: string;
}

export const CurrentOrganizer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizerPayload => {
    const request = ctx.switchToHttp().getRequest<Request & { organizer: OrganizerPayload }>();
    return request.organizer;
  },
);
