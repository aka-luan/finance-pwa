/**
 * PROTOTYPE — throwaway for issue #15.
 * Question: which step sequence / layout makes first-run planning and
 * recalibration understandable (negative balance, editable categories,
 * backup restore, planned-vs-actual, confirmation)?
 *
 * Three variants via ?prototype=wizard&variant=A|B|C
 * State is in-memory only. Do not promote this code to production as-is.
 */

import { formatAmount } from './format';

export type WizardMode = 'primeiro-uso' | 'recalibrar';

export type CategoryRow = {
  id: string;
  name: string;
  plannedCents: bigint;
  actualCents: bigint; // last 30d stub; 0 on first use
};

/** Recurring month line — entrada (salary, freelance) or saída (bills). Not the diário. */
export type FixedRow = {
  id: string;
  name: string;
  cents: bigint;
};

export type WizardState = {
  mode: WizardMode;
  balanceCents: bigint;
  spentTodayCents: bigint;
  inflows: FixedRow[];
  outflows: FixedRow[];
  categories: CategoryRow[];
  step: number; // variant A
};

export const SUGGESTED_NAMES = [
  'Mercado',
  'Transporte',
  'Lanches e passeios',
  'Farmácia e saúde',
  'Cuidados pessoais',
  'Pequenos imprevistos',
] as const;

export const SUGGESTED_INFLOWS = ['Salário', 'Freelas'] as const;
export const SUGGESTED_OUTFLOWS = ['Aluguel', 'Internet', 'Energia', 'Assinaturas'] as const;

export function seedState(mode: WizardMode): WizardState {
  const categories: CategoryRow[] = SUGGESTED_NAMES.map((name, i) => ({
    id: `c${i}`,
    name,
    plannedCents:
      mode === 'recalibrar'
        ? [45_000n, 20_000n, 15_000n, 8_000n, 6_000n, 10_000n][i]!
        : 0n,
    actualCents:
      mode === 'recalibrar'
        ? [52_300n, 18_100n, 21_400n, 3_200n, 7_800n, 4_500n][i]!
        : 0n,
  }));

  const inflows: FixedRow[] = SUGGESTED_INFLOWS.map((name, i) => ({
    id: `in${i}`,
    name,
    cents: mode === 'recalibrar' ? [420_000n, 80_000n][i]! : 0n,
  }));

  const outflows: FixedRow[] = SUGGESTED_OUTFLOWS.map((name, i) => ({
    id: `out${i}`,
    name,
    cents: mode === 'recalibrar' ? [180_000n, 12_000n, 22_000n, 6_000n][i]! : 0n,
  }));

  return {
    mode,
    balanceCents: mode === 'recalibrar' ? 312_450n : 0n,
    spentTodayCents: mode === 'recalibrar' ? 4_850n : 0n,
    inflows,
    outflows,
    categories,
    step: 0,
  };
}

export function monthlyTotal(state: WizardState): bigint {
  return state.categories.reduce((s, c) => s + c.plannedCents, 0n);
}

export function inflowTotal(state: WizardState): bigint {
  return state.inflows.reduce((s, f) => s + f.cents, 0n);
}

export function outflowTotal(state: WizardState): bigint {
  return state.outflows.reduce((s, f) => s + f.cents, 0n);
}

export function fixedNet(state: WizardState): bigint {
  return inflowTotal(state) - outflowTotal(state);
}

/** Saldo + entradas − saídas − cotidiano. Informational — not the diário. */
export function leftoverAfterPlan(state: WizardState): bigint {
  return state.balanceCents + fixedNet(state) - monthlyTotal(state);
}

export function dailyEstimate(state: WizardState): bigint {
  return divRoundHalfUp(monthlyTotal(state), 30n);
}

export function previewToday(state: WizardState): bigint {
  return dailyEstimate(state) - state.spentTodayCents;
}

/**
 * BigInt division rounding: "half up" to the nearest integer, ties away from 0.
 *
 * Example (d=30):
 *  -  149/30 -> 5  (remainder 29)
 *  -  150/30 -> 5 + 1 (exact half)
 *  - -149/30 -> -5 (remainder -29, abs 29)
 *  - -150/30 -> -5 - 1 (exact half, away from 0)
 */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error('divRoundHalfUp: divisor must be non-zero');
  if (n === 0n) return 0n;

  const sign = n < 0n ? -1n : 1n;
  const absN = n < 0n ? -n : n;
  const absQ = absN / (d < 0n ? -d : d);
  const absR = absN % (d < 0n ? -d : d);

  // "half up": increment when remainder is >= half the divisor.
  const absD = d < 0n ? -d : d;
  return sign * (absR * 2n >= absD ? absQ + 1n : absQ);
}

export function canConfirm(state: WizardState): boolean {
  return monthlyTotal(state) > 0n;
}

/** Parse "1.234,56" / "1234,56" / "1234" style pt-BR money into cents. */
export function parseMoneyInput(raw: string): bigint | null {
  const trimmed = raw.trim().replace(/\s/g, '');
  if (!trimmed) return 0n;
  const neg = trimmed.startsWith('-') || trimmed.startsWith('−');
  const body = trimmed.replace(/^[-−]/, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(body)) return null;
  const [reais, frac = ''] = body.split('.');
  const cents = BigInt(reais!) * 100n + BigInt((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

export function moneyFieldValue(cents: bigint): string {
  if (cents === 0n) return '';
  return formatAmount(cents);
}
