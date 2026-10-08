import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';

/**
 * Rate limit global.
 * - Pedidos autenticados (Bearer) são contados por token: vários convidados atrás
 *   do mesmo Wi-Fi do evento (mesmo IP público) não se bloqueiam uns aos outros.
 * - Pedidos anónimos são contados por IP real do cliente (requer `trust proxy`, ver main.ts).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const auth = req['headers']?.['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.length > 7) {
      return 'tok:' + createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 32);
    }
    return 'ip:' + (await super.getTracker(req));
  }
}
