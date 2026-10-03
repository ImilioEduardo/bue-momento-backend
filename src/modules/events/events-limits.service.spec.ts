import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Distribution, EventStatus, MediaType } from '@prisma/client';
import { EventLimitsService } from './events-limits.service.js';
import { EventWithPlan } from './events.types.js';

const basePlan = {
  maxGuests: 150,
  maxVideosPerGuest: 5,
  maxVideoSeconds: 30,
  retentionDays: 90,
};

const now = new Date();
const past = new Date(now.getTime() - 60 * 60 * 1000);
const future = new Date(now.getTime() + 60 * 60 * 1000);
const farFuture = new Date(now.getTime() + 10 * 60 * 60 * 1000);

function makeEvent(overrides: Partial<EventWithPlan> = {}): EventWithPlan {
  return {
    id: 'ev1',
    status: EventStatus.ACTIVE,
    startsAt: past,
    endsAt: future,
    graceHours: 24,
    distribution: Distribution.RANDOM,
    challengesPerGuest: 3,
    extraGuests: 0,
    extraVideosPerGuest: 0,
    extraRetentionDays: 0,
    extendedMaxSeconds: null,
    plan: basePlan,
    ...overrides,
  };
}

function makeChallenge(id: string, order: number, active = true) {
  return {
    id,
    eventId: 'ev1',
    text: `Desafio ${id}`,
    mediaType: MediaType.VIDEO,
    order,
    active,
  };
}

describe('EventLimitsService', () => {
  let service: EventLimitsService;

  beforeEach(() => {
    service = new EventLimitsService();
  });

  describe('getEffectiveLimits', () => {
    it('returns base plan limits when no extras', () => {
      const limits = service.getEffectiveLimits(makeEvent());
      expect(limits.maxGuests).toBe(150);
      expect(limits.maxVideosPerGuest).toBe(5);
      expect(limits.maxVideoSeconds).toBe(30);
    });

    it('adds extras to base limits', () => {
      const limits = service.getEffectiveLimits(
        makeEvent({ extraGuests: 50, extraVideosPerGuest: 2 }),
      );
      expect(limits.maxGuests).toBe(200);
      expect(limits.maxVideosPerGuest).toBe(7);
    });

    it('uses extendedMaxSeconds when set', () => {
      const limits = service.getEffectiveLimits(makeEvent({ extendedMaxSeconds: 60 }));
      expect(limits.maxVideoSeconds).toBe(60);
    });

    it('calculates expiresAt from endsAt + retentionDays', () => {
      const event = makeEvent();
      const limits = service.getEffectiveLimits(event);
      const expectedMs = event.endsAt.getTime() + 90 * 24 * 60 * 60 * 1000;
      expect(limits.expiresAt.getTime()).toBe(expectedMs);
    });

    it('includes extraRetentionDays in expiresAt', () => {
      const event = makeEvent({ extraRetentionDays: 180 });
      const limits = service.getEffectiveLimits(event);
      const expectedMs = event.endsAt.getTime() + (90 + 180) * 24 * 60 * 60 * 1000;
      expect(limits.expiresAt.getTime()).toBe(expectedMs);
    });

    it('throws if no plan associated', () => {
      expect(() => service.getEffectiveLimits(makeEvent({ plan: null }))).toThrow(BadRequestException);
    });
  });

  describe('isWithinJoinWindow', () => {
    it('returns true when now is between startsAt-2h and endsAt+graceHours', () => {
      expect(service.isWithinJoinWindow(makeEvent())).toBe(true);
    });

    it('returns true exactly 2h before startsAt', () => {
      const startsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const endsAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      expect(service.isWithinJoinWindow(makeEvent({ startsAt, endsAt }))).toBe(true);
    });

    it('returns false when event ended and grace hours passed', () => {
      const endsAt = new Date(now.getTime() - 25 * 60 * 60 * 1000);
      const startsAt = new Date(endsAt.getTime() - 4 * 60 * 60 * 1000);
      expect(service.isWithinJoinWindow(makeEvent({ startsAt, endsAt, graceHours: 24 }))).toBe(false);
    });

    it('returns false when event not started yet (>2h away)', () => {
      const startsAt = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      const endsAt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
      expect(service.isWithinJoinWindow(makeEvent({ startsAt, endsAt }))).toBe(false);
    });
  });

  describe('canGuestJoin', () => {
    it('returns true when below guest limit', () => {
      expect(service.canGuestJoin(makeEvent(), 100)).toBe(true);
    });

    it('returns false when at guest limit', () => {
      expect(service.canGuestJoin(makeEvent(), 150)).toBe(false);
    });

    it('returns false when above guest limit', () => {
      expect(service.canGuestJoin(makeEvent(), 200)).toBe(false);
    });

    it('accounts for extraGuests', () => {
      expect(service.canGuestJoin(makeEvent({ extraGuests: 50 }), 150)).toBe(true);
      expect(service.canGuestJoin(makeEvent({ extraGuests: 50 }), 200)).toBe(false);
    });
  });

  describe('canAddMoreVideos', () => {
    it('returns true when below video limit', () => {
      expect(service.canAddMoreVideos(makeEvent(), 3)).toBe(true);
    });

    it('returns false when at video limit', () => {
      expect(service.canAddMoreVideos(makeEvent(), 5)).toBe(false);
    });
  });

  describe('validateChallengesPerGuest', () => {
    it('does not throw when challengesPerGuest <= maxVideosPerGuest', () => {
      expect(() => service.validateChallengesPerGuest(makeEvent({ challengesPerGuest: 5 }))).not.toThrow();
    });

    it('throws when challengesPerGuest > maxVideosPerGuest', () => {
      expect(() => service.validateChallengesPerGuest(makeEvent({ challengesPerGuest: 6 }))).toThrow(BadRequestException);
    });
  });

  describe('assertGuestCanJoin', () => {
    it('throws ConflictException with EVENT_GUEST_LIMIT_REACHED when at limit', () => {
      expect(() => service.assertGuestCanJoin(makeEvent(), 150)).toThrow(ConflictException);
    });

    it('throws ConflictException with EVENT_NOT_ACCEPTING_GUESTS when outside window', () => {
      const endsAt = new Date(now.getTime() - 25 * 60 * 60 * 1000);
      const startsAt = new Date(endsAt.getTime() - 4 * 60 * 60 * 1000);
      expect(() => service.assertGuestCanJoin(makeEvent({ startsAt, endsAt }), 10)).toThrow(ConflictException);
    });
  });

  describe('assignChallenges — FIXED', () => {
    const challenges = [
      makeChallenge('c3', 3),
      makeChallenge('c1', 1),
      makeChallenge('c2', 2),
      makeChallenge('c4', 4),
      makeChallenge('c5', 5),
    ];

    it('returns first N by order', () => {
      const result = service.assignChallenges(challenges, 3, Distribution.FIXED, new Map());
      expect(result.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    });

    it('excludes inactive challenges', () => {
      const withInactive = [...challenges, makeChallenge('c0', 0, false)];
      const result = service.assignChallenges(withInactive, 3, Distribution.FIXED, new Map());
      expect(result.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    });

    it('returns all if perGuest > active count', () => {
      const result = service.assignChallenges(challenges, 10, Distribution.FIXED, new Map());
      expect(result).toHaveLength(5);
    });
  });

  describe('assignChallenges — RANDOM balanced coverage', () => {
    it('distributes challenges evenly across 150 simulated guests (deviation ≤ 1)', () => {
      const challengeList = Array.from({ length: 5 }, (_, i) => makeChallenge(`c${i}`, i));
      const counts = new Map<string, number>(challengeList.map((c) => [c.id, 0]));

      for (let i = 0; i < 150; i++) {
        const assigned = service.assignChallenges(challengeList, 3, Distribution.RANDOM, counts);
        for (const c of assigned) {
          counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
        }
      }

      const values = [...counts.values()];
      const min = Math.min(...values);
      const max = Math.max(...values);
      expect(max - min).toBeLessThanOrEqual(1);
    });

    it('returns exactly perGuest challenges', () => {
      const challengeList = Array.from({ length: 10 }, (_, i) => makeChallenge(`c${i}`, i));
      const result = service.assignChallenges(challengeList, 3, Distribution.RANDOM, new Map());
      expect(result).toHaveLength(3);
    });

    it('returns empty array when no active challenges', () => {
      const inactive = [makeChallenge('c1', 1, false)];
      const result = service.assignChallenges(inactive, 3, Distribution.RANDOM, new Map());
      expect(result).toHaveLength(0);
    });
  });
});
