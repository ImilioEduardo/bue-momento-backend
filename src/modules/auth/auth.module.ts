import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtGuard } from './guards/jwt.guard.js';
import { ORGANIZER_SIGN_OPTIONS, ORGANIZER_VERIFY_OPTIONS } from '../../common/security/jwt.constants.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { ...ORGANIZER_SIGN_OPTIONS, expiresIn: '15m' },
        verifyOptions: ORGANIZER_VERIFY_OPTIONS,
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtGuard],
  exports: [JwtGuard, JwtModule],
})
export class AuthModule {}
