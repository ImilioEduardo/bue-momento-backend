import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminGuard } from './guards/admin.guard.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PaymentsModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
