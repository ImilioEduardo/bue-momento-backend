import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { envSchema } from './config/env.schema.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { PlansModule } from './modules/plans/plans.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { ChallengesModule } from './modules/challenges/challenges.module.js';
import { PublicModule } from './modules/public/public.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        // Nunca escrever credenciais nos logs (o serializer por omissão inclui todos os headers)
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-admin-secret"]',
            'req.headers["x-signature"]',
            'req.headers["x-proxypay-signature"]',
            'req.headers["webhook-signature"]',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    // Limite por omissão: 120 pedidos/min por token (ou IP). Rotas sensíveis têm @Throttle próprio.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379' },
      }),
    }),
    PrismaModule,
    NotificationsModule,
    HealthModule,
    AuthModule,
    PlansModule,
    EventsModule,
    ChallengesModule,
    PublicModule,
    AdminModule,
    WebhooksModule,
    JobsModule,
  ],
  providers: [
    // Sem isto os @Throttle() não tinham efeito nenhum
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
