import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { safeEqual } from '../../../common/security/safe-compare.js';
import type { OrganizerPayload } from '../../../common/decorators/current-organizer.decorator.js';

const REFRESH_COOKIE = 'refresh_token';

/**
 * Protege /admin/* no servidor. Exige as DUAS coisas:
 *  1. o segredo partilhado X-Admin-Secret (só o servidor Next.js o conhece), comparado em tempo constante;
 *  2. uma sessão de um organizador com isAdmin = true, lida da base de dados
 *     (access token Bearer ou cookie refresh_token reencaminhado pelo Next.js).
 * Falha fechado: sem ADMIN_SECRET configurado, ninguém entra.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = this.config.get<string>('ADMIN_SECRET') ?? '';
    if (!secret) {
      throw new UnauthorizedException({ code: 'ADMIN_NOT_CONFIGURED', message: 'Administração indisponível.' });
    }

    const req = context.switchToHttp().getRequest<Request & { adminId?: string }>();
    const provided = req.headers['x-admin-secret'];
    if (typeof provided !== 'string' || !safeEqual(provided, secret)) {
      throw new UnauthorizedException({ code: 'ADMIN_UNAUTHORIZED', message: 'Não autorizado.' });
    }

    const organizerId = await this.resolveOrganizerId(req);
    if (!organizerId) {
      throw new UnauthorizedException({ code: 'ADMIN_SESSION_REQUIRED', message: 'Sessão de administrador em falta.' });
    }

    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
      select: { isAdmin: true },
    });
    if (!organizer?.isAdmin) {
      throw new ForbiddenException({ code: 'ADMIN_FORBIDDEN', message: 'Acesso reservado a administradores.' });
    }

    req.adminId = organizerId;
    return true;
  }

  private async resolveOrganizerId(req: Request): Promise<string | null> {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const payload = await this.jwt.verifyAsync<OrganizerPayload>(auth.slice(7));
        return payload.sub;
      } catch {
        return null;
      }
    }

    const refresh = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (refresh) {
      const tokenHash = createHash('sha256').update(refresh).digest('hex');
      const stored = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: { organizerId: true, expiresAt: true },
      });
      if (stored && stored.expiresAt > new Date()) return stored.organizerId;
    }
    return null;
  }
}
