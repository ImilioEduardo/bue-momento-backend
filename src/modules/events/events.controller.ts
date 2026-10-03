import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtGuard } from '../auth/guards/jwt.guard.js';
import { CurrentOrganizer } from '../../common/decorators/current-organizer.decorator.js';
import type { OrganizerPayload } from '../../common/decorators/current-organizer.decorator.js';
import { EventsService } from './events.service.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';
import { CheckoutDto } from './dto/checkout.dto.js';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  create(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventsService.create(organizer.sub, dto);
  }

  @Get()
  findAll(@CurrentOrganizer() organizer: OrganizerPayload) {
    return this.eventsService.findAll(organizer.sub);
  }

  @Get(':id')
  findOne(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
  ) {
    return this.eventsService.findOne(organizer.sub, id);
  }

  @Patch(':id')
  update(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(organizer.sub, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
  ) {
    return this.eventsService.remove(organizer.sub, id);
  }

  @Post(':id/checkout')
  checkout(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.eventsService.checkout(organizer.sub, id, dto);
  }

  @Get(':id/qr.png')
  async getQrPng(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.eventsService.generateQrPng(organizer.sub, id);
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  }

  @Get(':id/qr-card.pdf')
  async getQrCardPdf(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.eventsService.generateQrCardPdf(organizer.sub, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="qr-card.pdf"');
    res.send(buffer);
  }

  @Get(':id/payment')
  getPayment(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
  ) {
    return this.eventsService.getPayment(organizer.sub, id);
  }

  @Get(':id/stats')
  getStats(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
  ) {
    return this.eventsService.getStats(organizer.sub, id);
  }

  @Get(':id/submissions')
  getGallery(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
  ) {
    return this.eventsService.getGallery(organizer.sub, id);
  }

  @Get(':id/guests')
  getGuests(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
  ) {
    return this.eventsService.getGuests(organizer.sub, id);
  }

  @Patch(':id/guests/:gid')
  updateGuest(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
    @Param('gid') gid: string,
    @Body() body: { blocked: boolean },
  ) {
    return this.eventsService.updateGuest(organizer.sub, gid, body.blocked);
  }

  @Delete(':id/guests/:gid')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGuest(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
    @Param('gid') gid: string,
  ) {
    await this.eventsService.deleteGuest(organizer.sub, gid);
  }

  @Patch(':id/submissions/:sid/moderation')
  moderateSubmission(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @Body() body: { status: 'PENDING_APPROVAL' | 'APPROVED' | 'HIDDEN' },
  ) {
    return this.eventsService.moderateSubmission(organizer.sub, sid, body.status);
  }

  @Post(':id/exports')
  createExport(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
  ) {
    return this.eventsService.createExport(organizer.sub, id);
  }

  @Get(':id/exports/:eid')
  getExport(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') id: string,
    @Param('eid') eid: string,
  ) {
    return this.eventsService.getExport(organizer.sub, id, eid);
  }
}
