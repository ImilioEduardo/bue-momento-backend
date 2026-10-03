import { Module } from '@nestjs/common';
import { ChallengesController, ChallengeTemplatesController } from './challenges.controller.js';
import { ChallengesService } from './challenges.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [ChallengesController, ChallengeTemplatesController],
  providers: [ChallengesService],
})
export class ChallengesModule {}
