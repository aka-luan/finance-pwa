import type { PGlite } from '@electric-sql/pglite';

export function todayBelem(): string;

export interface Hoje {
  saldoCents: bigint;
  podeGastarCents: bigint | null;
}

export function getHoje(db: PGlite, today: string): Promise<Hoje>;

export interface DiarioItem {
  amountCents: bigint;
  categoryId?: string;
  note?: string;
}

export function insertDiario(db: PGlite, date: string, items: DiarioItem[]): Promise<string[]>;

export function deleteTransactions(db: PGlite, ids: string[]): Promise<void>;

export function settleDay(db: PGlite, date: string): Promise<void>;
