import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule } from '@nestjs/throttler';
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
    PrismaModule,
    NotificationsModule,
    HealthModule,
    AuthModule,
    PlansModule,
    EventsModule,
    ChallengesModule,
    PublicModule,
    AdminModule,
  ],
})
export class AppModule {}
