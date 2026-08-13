import type { TimelineDay } from '../db/queries.mjs';

export const HORIZON_RANGES: readonly [3, 6, 12];

export type HorizonRange = (typeof HORIZON_RANGES)[number];

export interface HorizonMonth {
  key: string;
  firstDay: string;
  lastDay: string;
  endBalanceCents: bigint;
}

export interface HorizonSummary {
  currentBalanceCents: bigint;
  lowestBalanceCents: bigint;
  lowestDay: string;
}

export function monthKey(day: string): string;

export function buildHorizonMonths(dias: TimelineDay[], count: HorizonRange): HorizonMonth[];

export function daysInMonths(dias: TimelineDay[], months: HorizonMonth[]): TimelineDay[];

export function lowestBalanceDay(dias: TimelineDay[]): TimelineDay | null;

export function horizonSummary(dias: TimelineDay[]): HorizonSummary | null;
