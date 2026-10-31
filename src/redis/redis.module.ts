import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
          // maxRetriesPerRequest: null would cause commands to queue forever on Redis outage.
          // 3 retries fail fast (< 1s) so HTTP handlers return 503 instead of hanging indefinitely.
          // BullMQ workers use their own separate Redis connections that require null.
          maxRetriesPerRequest: 3,
          enableReadyCheck: false,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
