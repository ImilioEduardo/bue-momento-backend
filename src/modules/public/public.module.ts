import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PublicController, DevController } from './public.controller.js';
import { PublicService } from './public.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [PublicController, DevController],
  providers: [PublicService],
})
export class PublicModule {}
