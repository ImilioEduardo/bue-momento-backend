import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PublicController, DevController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { GuestJwtGuard } from './guards/guest-jwt.guard.js';
import { EventsModule } from '../events/events.module.js';
import { MediaModule } from '../media/media.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { isDevEnv } from '../../config/runtime.js';

@Module({
  imports: [JwtModule.register({}), EventsModule, MediaModule, PrismaModule],
  // As rotas /dev/* (stubs de upload sem autenticação) só existem em desenvolvimento/testes
  controllers: isDevEnv() ? [PublicController, DevController] : [PublicController],
  providers: [PublicService, GuestJwtGuard],
})
export class PublicModule {}
