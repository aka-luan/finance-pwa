import type { PGlite } from '@electric-sql/pglite';

export function todayBelem(): string;

export interface Hoje {
  saldoCents: bigint;
  podeGastarCents: bigint | null;
}

export function getHoje(db: PGlite, today: string): Promise<Hoje>;

export interface WhatIfEntry {
  date: string;
  kind: 'entrada' | 'saida';
  amount_cents: number;
}

export interface Milestone {
  label: string;
  day: string;
  balance_cents: bigint;
}

export function getMarcos(db: PGlite, today: string, whatIf?: WhatIfEntry[]): Promise<Milestone[]>;

export interface WorstPoint {
  day: string;
  balance_cents: bigint;
}

export function getWorstPoint(db: PGlite, today: string, whatIf?: WhatIfEntry[]): Promise<WorstPoint>;

export interface DiarioItem {
  amountCents: bigint;
  categoryId?: string;
  note?: string;
}

export function insertDiario(db: PGlite, date: string, items: DiarioItem[]): Promise<string[]>;

export function deleteTransactions(db: PGlite, ids: string[]): Promise<void>;

export function settleDay(db: PGlite, date: string): Promise<void>;

export function pendingDays(db: PGlite, today: string): Promise<string[]>;

export function setAnchor(db: PGlite, date: string, amountCents: bigint): Promise<void>;

export interface Recurrence {
  id: string;
  kind: 'entrada' | 'saida';
  amount_cents: bigint;
  day_of_month: number;
  label: string;
  start_date: string;
  end_date: string | null;
  active: boolean;
}

export function listRecurrences(db: PGlite, today: string): Promise<Recurrence[]>;

export interface RecurrenceInput {
  kind: 'entrada' | 'saida';
  dayOfMonth: number;
  amountCents: bigint;
  label: string;
  startDate: string;
}

export function createRecurrence(db: PGlite, input: RecurrenceInput): Promise<string>;

export function updateRecurrence(
  db: PGlite,
  id: string,
  input: Omit<RecurrenceInput, 'startDate'>,
): Promise<void>;

export function deactivateRecurrence(db: PGlite, id: string, today: string): Promise<void>;
