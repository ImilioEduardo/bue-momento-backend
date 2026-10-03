import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EXTRAS } from './extras.js';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const plans = await this.prisma.plan.findMany({ where: { active: true } });

    const mappedPlans = plans.map((p) => ({
      id: p.id,
      name: p.name,
      maxGuests: p.maxGuests,
      maxChallengesPerGuest: p.maxVideosPerGuest,
      maxVideoSeconds: p.maxVideoSeconds,
      activeDays: p.retentionDays,
      priceKz: p.priceKz,
    }));

    const mappedExtras = EXTRAS.map((e) => ({
      id: e.code,
      label: e.label,
      description: e.description,
      priceKz: e.priceKz,
    }));

    return { plans: mappedPlans, extras: mappedExtras };
  }
}
