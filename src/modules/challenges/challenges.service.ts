import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateChallengeDto } from './dto/create-challenge.dto.js';
import { UpdateChallengeDto } from './dto/update-challenge.dto.js';
import { ReorderChallengesDto } from './dto/reorder-challenges.dto.js';
import { FromTemplatesDto } from './dto/from-templates.dto.js';

@Injectable()
export class ChallengesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertEventOwnership(organizerId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    return event;
  }

  async create(organizerId: string, eventId: string, dto: CreateChallengeDto) {
    await this.assertEventOwnership(organizerId, eventId);
    return this.prisma.challenge.create({
      data: {
        eventId,
        text: dto.text,
        mediaType: dto.mediaType ?? MediaType.VIDEO,
        order: dto.order,
      },
    });
  }

  async findAll(organizerId: string, eventId: string) {
    await this.assertEventOwnership(organizerId, eventId);
    return this.prisma.challenge.findMany({
      where: { eventId },
      orderBy: { order: 'asc' },
    });
  }

  async update(organizerId: string, eventId: string, challengeId: string, dto: UpdateChallengeDto) {
    const event = await this.assertEventOwnership(organizerId, eventId);

    if (new Date() > event.endsAt) {
      throw new BadRequestException({
        code: 'EVENT_ENDED',
        message: 'Os desafios não podem ser editados após o término do evento.',
      });
    }

    const challenge = await this.prisma.challenge.findFirst({ where: { id: challengeId, eventId } });
    if (!challenge) throw new NotFoundException({ code: 'CHALLENGE_NOT_FOUND', message: 'Desafio não encontrado.' });

    return this.prisma.challenge.update({ where: { id: challengeId }, data: dto });
  }

  async remove(organizerId: string, eventId: string, challengeId: string) {
    await this.assertEventOwnership(organizerId, eventId);
    const challenge = await this.prisma.challenge.findFirst({ where: { id: challengeId, eventId } });
    if (!challenge) throw new NotFoundException({ code: 'CHALLENGE_NOT_FOUND', message: 'Desafio não encontrado.' });
    await this.prisma.challenge.delete({ where: { id: challengeId } });
    return { message: 'Desafio eliminado.' };
  }

  async reorder(organizerId: string, eventId: string, dto: ReorderChallengesDto) {
    await this.assertEventOwnership(organizerId, eventId);
    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.challenge.updateMany({ where: { id, eventId }, data: { order: index } }),
      ),
    );
    return this.prisma.challenge.findMany({ where: { eventId }, orderBy: { order: 'asc' } });
  }

  async listTemplates(category?: string) {
    const templates = await this.prisma.challengeTemplate.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ category: 'asc' }, { id: 'asc' }],
    });
    const grouped: Record<string, typeof templates> = {};
    for (const t of templates) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    }
    return Object.entries(grouped).map(([cat, items]) => ({ category: cat, items }));
  }

  async createBulk(organizerId: string, eventId: string, dtos: CreateChallengeDto[]) {
    await this.assertEventOwnership(organizerId, eventId);
    await this.prisma.challenge.deleteMany({ where: { eventId } });
    const valid = dtos.filter((d) => d.text?.trim());
    if (valid.length === 0) return [];
    return this.prisma.$transaction(
      valid.map((d, i) =>
        this.prisma.challenge.create({
          data: { eventId, text: d.text.trim(), mediaType: d.mediaType ?? MediaType.VIDEO, order: i },
        }),
      ),
    );
  }

  async fromTemplates(organizerId: string, eventId: string, dto: FromTemplatesDto) {
    await this.assertEventOwnership(organizerId, eventId);

    const templates = await this.prisma.challengeTemplate.findMany({
      where: { id: { in: dto.templateIds } },
    });

    if (templates.length === 0) {
      throw new NotFoundException({ code: 'TEMPLATES_NOT_FOUND', message: 'Nenhum modelo encontrado.' });
    }

    const existing = await this.prisma.challenge.count({ where: { eventId } });

    const created = await this.prisma.$transaction(
      templates.map((tpl, i) =>
        this.prisma.challenge.create({
          data: {
            eventId,
            text: tpl.text,
            mediaType: tpl.mediaType,
            order: existing + i,
          },
        }),
      ),
    );

    return created;
  }
}
