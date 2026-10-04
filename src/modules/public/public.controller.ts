import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PublicService } from './public.service.js';
import { JoinEventDto } from './dto/join-event.dto.js';
import { UploadSubmissionDto } from './dto/upload-submission.dto.js';
import { GuestJwtGuard } from './guards/guest-jwt.guard.js';
import { CurrentGuest } from './decorators/current-guest.decorator.js';
import type { GuestPayload } from './decorators/current-guest.decorator.js';

@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get('events/:code')
  getEvent(@Param('code') code: string) {
    return this.svc.getPublicEvent(code);
  }

  @Post('events/:code/join')
  joinEvent(@Param('code') code: string, @Body() dto: JoinEventDto) {
    return this.svc.joinEvent(code, dto);
  }

  // Returns the authenticated guest's assignments and limits
  @UseGuards(GuestJwtGuard)
  @Get('me')
  getMe(@CurrentGuest() guest: GuestPayload) {
    return this.svc.getMe(guest.sub, guest.eventId);
  }

  @UseGuards(GuestJwtGuard)
  @Get('assignments/:aid')
  getAssignment(@Param('aid') aid: string, @CurrentGuest() guest: GuestPayload) {
    return this.svc.getAssignment(guest.sub, guest.eventId, aid);
  }

  // Unified upload endpoint — handles both VIDEO (returns tusUploadUrl) and PHOTO (returns putUrl)
  @UseGuards(GuestJwtGuard)
  @Post('assignments/:aid/uploads')
  initiateUpload(
    @Param('aid') aid: string,
    @Body() dto: UploadSubmissionDto,
    @CurrentGuest() guest: GuestPayload,
  ) {
    return this.svc.initiateUpload(guest.sub, guest.eventId, aid, dto);
  }

  @UseGuards(GuestJwtGuard)
  @Post('submissions/:sid/complete')
  completePhoto(@Param('sid') sid: string, @CurrentGuest() guest: GuestPayload) {
    return this.svc.completePhotoSubmission(guest.sub, sid);
  }

  @UseGuards(GuestJwtGuard)
  @Get('submissions/:sid')
  getSubmission(@Param('sid') sid: string, @CurrentGuest() guest: GuestPayload) {
    return this.svc.getSubmission(guest.sub, sid);
  }
}

// ── Dev-only TUS stub & photo stub (disabled in production) ──────────────────

@ApiTags('dev')
@Controller('dev')
export class DevController {
  constructor(private readonly svc: PublicService) {}

  @Get('tus/:sid')
  devTusHead(@Param('sid') sid: string, @Res() res: Response) {
    if (process.env['NODE_ENV'] === 'production') { res.status(404).end(); return; }
    const { offset } = this.svc.devTusHead(sid);
    res
      .status(200)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Offset', String(offset))
      .set('Cache-Control', 'no-store')
      .end();
  }

  @Patch('tus/:sid')
  async devTusPatch(
    @Param('sid') sid: string,
    @Headers('upload-offset') uploadOffsetHeader: string,
    @Headers('content-length') contentLengthHeader: string,
    @Headers('upload-length') uploadLengthHeader: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (process.env['NODE_ENV'] === 'production') { res.status(404).end(); return; }

    await new Promise<void>((resolve) => {
      req.resume();
      req.on('end', resolve);
      req.on('error', resolve);
    });

    const offset = parseInt(uploadOffsetHeader ?? '0', 10);
    const chunkSize = parseInt(contentLengthHeader ?? '0', 10);
    const total = parseInt(uploadLengthHeader ?? '0', 10);
    const newOffset = await this.svc.devTusPatch(sid, offset, chunkSize, total);

    res
      .status(204)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Offset', String(newOffset))
      .end();
  }

  @Put('photo/:sid')
  async devPhotoAccept(
    @Param('sid') sid: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (process.env['NODE_ENV'] === 'production') { res.status(404).end(); return; }

    await new Promise<void>((resolve) => {
      req.resume();
      req.on('end', resolve);
      req.on('error', resolve);
    });

    await this.svc.devPhotoAccept(sid);
    res.status(200).json({ ok: true });
  }
}
