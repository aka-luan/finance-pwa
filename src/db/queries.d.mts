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

export interface TimelineDay {
  day: string;
  balance_cents: bigint;
  is_projection: boolean;
}

export function getTimeline(db: PGlite, today: string): Promise<TimelineDay[]>;

export interface TransactionItem {
  amountCents: bigint;
  categoryId?: string;
  note?: string;
}

export function insertTransactions(
  db: PGlite,
  date: string,
  kind: 'diario' | 'saida' | 'entrada',
  items: TransactionItem[],
): Promise<string[]>;

export function deleteTransactions(db: PGlite, ids: string[]): Promise<void>;

export function settleDay(db: PGlite, date: string): Promise<void>;

export function pendingDays(db: PGlite, today: string): Promise<string[]>;

export function setAnchor(db: PGlite, date: string, amountCents: bigint): Promise<void>;

export interface EstimateDeviation {
  month: string;
  actual_cents: bigint;
  estimate_cents: bigint;
}

export function getEstimateDeviation(db: PGlite, today: string): Promise<EstimateDeviation | null>;

export function updateEstimate(db: PGlite, amountCents: bigint, today: string): Promise<void>;

export function dismissEstimateDeviation(db: PGlite, month: string): Promise<void>;

export function clearEstimateDismissals(db: PGlite): Promise<void>;

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

export interface Card {
  id: string;
  name: string;
  closing_day: number;
  due_day: number;
  archived_at: string | null;
}

export function listCards(db: PGlite): Promise<Card[]>;

export interface CardInput {
  name: string;
  closingDay: number;
  dueDay: number;
}

export function createCard(db: PGlite, input: CardInput): Promise<string>;

export function updateCard(db: PGlite, id: string, input: CardInput): Promise<void>;

export function archiveCard(db: PGlite, id: string, today: string): Promise<void>;

export interface InstallmentPreview {
  installment_no: number;
  amount_cents: bigint;
  cycle_month: string;
  due_date: string;
}

export function previewInstallments(
  db: PGlite,
  cardId: string,
  date: string,
  amountCents: bigint,
  installments: number,
): Promise<InstallmentPreview[]>;

export interface PurchaseInput {
  cardId: string;
  date: string;
  amountCents: bigint;
  installments: number;
  description?: string;
  categoryId?: string;
}

export function insertPurchase(db: PGlite, input: PurchaseInput): Promise<string>;

export function deletePurchase(db: PGlite, id: string): Promise<void>;

export function needsFirstRun(db: PGlite): Promise<boolean>;

export interface Category {
  id: string;
  name: string;
}

export function listCategories(db: PGlite): Promise<Category[]>;

export interface MonthlyBudgetLine {
  category_id: string;
  name: string;
  amount_cents: bigint;
}

export interface MonthlyBudget {
  id: string;
  effective_from: string;
  lines: MonthlyBudgetLine[];
}

export function getMonthlyBudget(db: PGlite, today: string): Promise<MonthlyBudget | null>;

export interface CategorySpend {
  category_id: string | null;
  amount_cents: bigint;
}

export function spentByCategoryLast30Days(db: PGlite, today: string): Promise<CategorySpend[]>;

export function spentTodayDiario(db: PGlite, today: string): Promise<bigint>;

export interface PlanningCategoryInput {
  id?: string;
  name: string;
  plannedCents: bigint;
}

export interface PlanningFixoInput {
  id?: string;
  kind: 'entrada' | 'saida';
  label: string;
  amountCents: bigint;
  dayOfMonth: number;
}

export interface PlanningPayload {
  balanceCents: bigint;
  categories: PlanningCategoryInput[];
  fixos: PlanningFixoInput[];
}

export interface ConfirmPlanningResult {
  estimateCents: bigint;
  monthlyTotal: bigint;
}

export function confirmPlanning(
  db: PGlite,
  today: string,
  payload: PlanningPayload,
): Promise<ConfirmPlanningResult>;

export function roundHalfUpDiv(n: bigint, d: bigint): bigint;
