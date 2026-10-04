import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
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
})
export class AppModule {}
