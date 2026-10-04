import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PublicController, DevController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { EventsModule } from '../events/events.module.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  imports: [JwtModule.register({}), EventsModule, MediaModule],
  controllers: [PublicController, DevController],
  providers: [PublicService],
})
export class PublicModule {}
