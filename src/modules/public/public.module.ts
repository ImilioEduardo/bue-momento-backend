import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PublicController, DevController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { GuestJwtGuard } from './guards/guest-jwt.guard.js';
import { EventsModule } from '../events/events.module.js';
import { MediaModule } from '../media/media.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [JwtModule.register({}), EventsModule, MediaModule, PrismaModule],
  controllers: [PublicController, DevController],
  providers: [PublicService, GuestJwtGuard],
})
export class PublicModule {}
