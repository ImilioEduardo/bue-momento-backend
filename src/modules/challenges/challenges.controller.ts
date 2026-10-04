import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '../auth/guards/jwt.guard.js';
import { CurrentOrganizer } from '../../common/decorators/current-organizer.decorator.js';
import type { OrganizerPayload } from '../../common/decorators/current-organizer.decorator.js';
import { ChallengesService } from './challenges.service.js';
import { CreateChallengeDto } from './dto/create-challenge.dto.js';
import { UpdateChallengeDto } from './dto/update-challenge.dto.js';
import { ReorderChallengesDto } from './dto/reorder-challenges.dto.js';
import { FromTemplatesDto } from './dto/from-templates.dto.js';

@ApiTags('challenge-templates')
@Controller('challenge-templates')
export class ChallengeTemplatesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Get()
  listTemplates(@Query('category') category?: string) {
    return this.challengesService.listTemplates(category);
  }
}

@ApiTags('challenges')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('events/:id/challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Post()
  create(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') eventId: string,
    @Body() dto: CreateChallengeDto,
  ) {
    return this.challengesService.create(organizer.sub, eventId, dto);
  }

  @Post('bulk')
  createBulk(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') eventId: string,
    @Body() dto: CreateChallengeDto[],
  ) {
    return this.challengesService.createBulk(organizer.sub, eventId, dto);
  }

  @Get()
  findAll(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') eventId: string,
  ) {
    return this.challengesService.findAll(organizer.sub, eventId);
  }

  @Patch(':cid')
  update(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') eventId: string,
    @Param('cid') challengeId: string,
    @Body() dto: UpdateChallengeDto,
  ) {
    return this.challengesService.update(organizer.sub, eventId, challengeId, dto);
  }

  @Delete(':cid')
  remove(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') eventId: string,
    @Param('cid') challengeId: string,
  ) {
    return this.challengesService.remove(organizer.sub, eventId, challengeId);
  }

  @Post('reorder')
  reorder(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') eventId: string,
    @Body() dto: ReorderChallengesDto,
  ) {
    return this.challengesService.reorder(organizer.sub, eventId, dto);
  }

  @Post('from-templates')
  fromTemplates(
    @CurrentOrganizer() organizer: OrganizerPayload,
    @Param('id') eventId: string,
    @Body() dto: FromTemplatesDto,
  ) {
    return this.challengesService.fromTemplates(organizer.sub, eventId, dto);
  }
}
