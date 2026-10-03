import { Distribution, EventStatus } from '@prisma/client';

export interface PlanSnapshot {
  maxGuests: number;
  maxVideosPerGuest: number;
  maxVideoSeconds: number;
  retentionDays: number;
}

export interface EventWithPlan {
  id: string;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  graceHours: number;
  distribution: Distribution;
  challengesPerGuest: number;
  extraGuests: number;
  extraVideosPerGuest: number;
  extraRetentionDays: number;
  extendedMaxSeconds: number | null;
  plan: PlanSnapshot | null;
}

export interface EffectiveLimits {
  maxGuests: number;
  maxVideosPerGuest: number;
  maxVideoSeconds: number;
  expiresAt: Date;
}
