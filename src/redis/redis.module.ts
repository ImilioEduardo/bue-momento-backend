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
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
