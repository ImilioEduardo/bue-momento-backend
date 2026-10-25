import { Distribution, EventStatus } from '@prisma/client';

export interface MappableEvent {
  id: string;
  name: string;
  publicCode: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  coverUrl: string | null;
  status: EventStatus;
  distribution: Distribution;
  challengesPerGuest: number;
  moderation: boolean;
  planId: string | null;
  extraGuests: number;
  extraVideosPerGuest: number;
  createdAt: Date;
  plan?: { maxGuests: number; maxVideosPerGuest: number; retentionDays: number } | null;
  _count?: { guests?: number };
}

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
