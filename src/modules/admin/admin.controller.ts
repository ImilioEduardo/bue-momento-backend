import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from './guards/admin.guard.js';
import { AdminService } from './admin.service.js';

@ApiTags('admin')
// Chamado só a partir do servidor Next.js (IP partilhado) e já protegido pelo AdminGuard
@SkipThrottle()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('organizers')
  getOrganizers() {
    return this.adminService.getOrganizers();
  }

  @Get('events')
  getEvents() {
    return this.adminService.getEvents();
  }

  @Get('payments')
  getPayments() {
    return this.adminService.getPayments();
  }

  @Get('consumption')
  getConsumption() {
    return this.adminService.getConsumption();
  }

  @Post('payments/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirmPayment(@Param('id') id: string) {
    return this.adminService.confirmPayment(id);
  }
}
