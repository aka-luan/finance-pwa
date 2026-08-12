/**
 * Planning wizard state helpers (issue #27 / map #14).
 * Pure functions shared by the production wizard UI.
 */

export type WizardMode = 'primeiro-uso' | 'recalibrar';

export type CategoryRow = {
  id: string;
  name: string;
  plannedCents: bigint;
  actualCents: bigint;
};

export type FixedRow = {
  id: string;
  name: string;
  cents: bigint;
  dayOfMonth: number;
};

export type WizardState = {
  mode: WizardMode;
  balanceCents: bigint;
  spentTodayCents: bigint;
  inflows: FixedRow[];
  outflows: FixedRow[];
  categories: CategoryRow[];
  step: number;
  error: string;
  saving: boolean;
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

export function emptyFirstRunState(): WizardState {
  return {
    mode: 'primeiro-uso',
    balanceCents: 0n,
    spentTodayCents: 0n,
    inflows: SUGGESTED_INFLOWS.map((name, i) => ({
      id: crypto.randomUUID(),
      name,
      cents: 0n,
      dayOfMonth: 1,
    })),
    outflows: SUGGESTED_OUTFLOWS.map((name, i) => ({
      id: crypto.randomUUID(),
      name,
      cents: 0n,
      dayOfMonth: 1,
    })),
    categories: SUGGESTED_NAMES.map((name) => ({
      id: crypto.randomUUID(),
      name,
      plannedCents: 0n,
      actualCents: 0n,
    })),
    step: 0,
    error: '',
    saving: false,
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

export function leftoverAfterPlan(state: WizardState): bigint {
  return state.balanceCents + fixedNet(state) - monthlyTotal(state);
}

export function dailyEstimate(state: WizardState): bigint {
  return roundHalfUpDiv(monthlyTotal(state), 30n);
}

export function previewToday(state: WizardState): bigint {
  return dailyEstimate(state) - state.spentTodayCents;
}

export function canConfirm(state: WizardState): boolean {
  if (monthlyTotal(state) <= 0n) return false;
  for (const f of [...state.inflows, ...state.outflows]) {
    if (f.cents > 0n && !f.name.trim()) return false;
    if (f.cents > 0n && (!Number.isInteger(f.dayOfMonth) || f.dayOfMonth < 1 || f.dayOfMonth > 31)) {
      return false;
    }
  }
  for (const c of state.categories) {
    if (!c.name.trim()) return false;
  }
  return true;
}

export function roundHalfUpDiv(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error('roundHalfUpDiv: divisor must be non-zero');
  if (n === 0n) return 0n;
  const sign = n < 0n ? -1n : 1n;
  const absN = n < 0n ? -n : n;
  const absD = d < 0n ? -d : d;
  const absQ = absN / absD;
  const absR = absN % absD;
  return sign * (absR * 2n >= absD ? absQ + 1n : absQ);
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
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  const withDots = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${withDots},${frac}`;
}
