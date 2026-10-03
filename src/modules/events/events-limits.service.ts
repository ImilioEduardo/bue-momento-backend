import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Challenge, Distribution } from '@prisma/client';
import { EffectiveLimits, EventWithPlan } from './events.types.js';

const JOIN_WINDOW_LEAD_HOURS = 2;

@Injectable()
export class EventLimitsService {
  getEffectiveLimits(event: EventWithPlan): EffectiveLimits {
    const plan = event.plan;
    if (!plan) throw new BadRequestException({ code: 'EVENT_NO_PLAN', message: 'O evento não tem plano associado.' });

    const maxGuests = plan.maxGuests + event.extraGuests;
    const maxVideosPerGuest = plan.maxVideosPerGuest + event.extraVideosPerGuest;
    const maxVideoSeconds = event.extendedMaxSeconds ?? plan.maxVideoSeconds;
    const retentionDays = plan.retentionDays + event.extraRetentionDays;
    const expiresAt = new Date(event.endsAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    return { maxGuests, maxVideosPerGuest, maxVideoSeconds, expiresAt };
  }

  isWithinJoinWindow(event: EventWithPlan): boolean {
    const now = Date.now();
    const windowStart = event.startsAt.getTime() - JOIN_WINDOW_LEAD_HOURS * 60 * 60 * 1000;
    const windowEnd = event.endsAt.getTime() + event.graceHours * 60 * 60 * 1000;
    return now >= windowStart && now <= windowEnd;
  }

  isWithinSubmissionWindow(event: EventWithPlan): boolean {
    const now = Date.now();
    const windowEnd = event.endsAt.getTime() + event.graceHours * 60 * 60 * 1000;
    return now <= windowEnd;
  }

  canGuestJoin(event: EventWithPlan, currentGuestCount: number): boolean {
    const limits = this.getEffectiveLimits(event);
    return currentGuestCount < limits.maxGuests;
  }

  canAddMoreVideos(event: EventWithPlan, activeSubmissions: number): boolean {
    const limits = this.getEffectiveLimits(event);
    return activeSubmissions < limits.maxVideosPerGuest;
  }

  validateChallengesPerGuest(event: EventWithPlan): void {
    const limits = this.getEffectiveLimits(event);
    if (event.challengesPerGuest > limits.maxVideosPerGuest) {
      throw new BadRequestException({
        code: 'CHALLENGES_EXCEED_VIDEO_LIMIT',
        message: `O número de desafios por convidado (${event.challengesPerGuest}) não pode ser superior ao limite de vídeos por convidado (${limits.maxVideosPerGuest}).`,
      });
    }
  }

  assertGuestCanJoin(event: EventWithPlan, currentGuestCount: number): void {
    if (!this.isWithinJoinWindow(event)) {
      throw new ConflictException({
        code: 'EVENT_NOT_ACCEPTING_GUESTS',
        message: 'O evento não está a aceitar entradas de momento.',
      });
    }
    if (!this.canGuestJoin(event, currentGuestCount)) {
      throw new ConflictException({
        code: 'EVENT_GUEST_LIMIT_REACHED',
        message: 'O limite de convidados foi atingido.',
      });
    }
  }

  assignChallenges(
    challenges: Challenge[],
    perGuest: number,
    distribution: Distribution,
    assignmentCounts: Map<string, number>,
  ): Challenge[] {
    const active = challenges.filter((c) => c.active);

    if (active.length === 0 || perGuest === 0) return [];

    const count = Math.min(perGuest, active.length);

    if (distribution === Distribution.FIXED) {
      return [...active].sort((a, b) => a.order - b.order).slice(0, count);
    }

    // RANDOM with balanced coverage: prefer challenges with fewer assignments
    const sorted = [...active].sort((a, b) => {
      const aCount = assignmentCounts.get(a.id) ?? 0;
      const bCount = assignmentCounts.get(b.id) ?? 0;
      if (aCount !== bCount) return aCount - bCount;
      return Math.random() - 0.5;
    });

    return sorted.slice(0, count);
  }
}
