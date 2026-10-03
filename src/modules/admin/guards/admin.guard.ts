import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('ADMIN_SECRET') ?? '';
    if (!secret) return true; // dev: no secret = open
    const req = context.switchToHttp().getRequest<Request>();
    if (req.headers['x-admin-secret'] === secret) return true;
    throw new UnauthorizedException({ code: 'ADMIN_UNAUTHORIZED' });
  }
}
