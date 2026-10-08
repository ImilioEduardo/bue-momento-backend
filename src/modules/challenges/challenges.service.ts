import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BulkChallengeItemDto, CreateChallengeDto } from './dto/create-challenge.dto.js';
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
      where: { eventId, active: true },
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
    const challenge = await this.prisma.challenge.findFirst({
      where: { id: challengeId, eventId },
      select: { id: true, _count: { select: { assignments: true } } },
    });
    if (!challenge) throw new NotFoundException({ code: 'CHALLENGE_NOT_FOUND', message: 'Desafio não encontrado.' });
    // Se já foi atribuído, desactiva em vez de apagar (a cascata apagaria as submissões)
    if (challenge._count.assignments > 0) {
      await this.prisma.challenge.update({ where: { id: challengeId }, data: { active: false } });
    } else {
      await this.prisma.challenge.delete({ where: { id: challengeId } });
    }
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

  /**
   * Sincroniza a lista de desafios do evento com a enviada pelo editor.
   * Antes: apagava TODOS os desafios e recriava-os — em eventos activos a cascata apagava
   * as atribuições e as SUBMISSÕES dos convidados (e a media ficava órfã no storage).
   * Agora: itens com `id` são actualizados; novos são criados; os removidos são apagados
   * só se ninguém os recebeu, senão ficam inactivos (os envios existentes mantêm-se).
   */
  async createBulk(organizerId: string, eventId: string, dtos: BulkChallengeItemDto[]) {
    const event = await this.assertEventOwnership(organizerId, eventId);
    if (event.status !== 'DRAFT' && new Date() > event.endsAt) {
      throw new BadRequestException({ code: 'EVENT_ENDED', message: 'Os desafios não podem ser editados após o término do evento.' });
    }
    if (dtos.length > 100) {
      throw new BadRequestException({ code: 'TOO_MANY_CHALLENGES', message: 'Máximo de 100 desafios por evento.' });
    }

    const valid = dtos.filter((d) => d.text.trim());
    const existing = await this.prisma.challenge.findMany({
      where: { eventId },
      select: { id: true, _count: { select: { assignments: true } } },
    });
    const existingIds = new Set(existing.map((c) => c.id));
    const keepIds = new Set(valid.filter((d) => d.id && existingIds.has(d.id)).map((d) => d.id as string));
    const removed = existing.filter((c) => !keepIds.has(c.id));
    const toDelete = removed.filter((c) => c._count.assignments === 0).map((c) => c.id);
    const toDeactivate = removed.filter((c) => c._count.assignments > 0).map((c) => c.id);

    await this.prisma.$transaction([
      this.prisma.challenge.deleteMany({ where: { id: { in: toDelete }, eventId } }),
      this.prisma.challenge.updateMany({ where: { id: { in: toDeactivate }, eventId }, data: { active: false } }),
      ...valid.map((d, i) => {
        const data = { text: d.text.trim(), mediaType: d.mediaType ?? MediaType.VIDEO, order: i, active: true };
        return d.id && keepIds.has(d.id)
          ? this.prisma.challenge.update({ where: { id: d.id }, data })
          : this.prisma.challenge.create({ data: { eventId, ...data } });
      }),
    ]);

    return this.findAll(organizerId, eventId);
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
