/**
 * Planejamento: operational editor for the assumptions that feed the
 * forecast. Recurrences (fixos) and monthly everyday budget write through
 * savePlanningAssumptions — the same tables Previsão and Termômetro read.
 */

import { getDb } from '../db';
import {
  getMonthlyBudget,
  listRecurrences,
  savePlanningAssumptions,
  todayBelem,
} from '../db/queries.mjs';
import { debounce } from './debounce';
import { renderForecastNav } from './destinations';
import { formatAmount } from './format';
import {
  addFixedBtn,
  compactRowList,
  fixedRowList,
  newFixedRow,
  sectionLabel,
} from './planning-rows';
import { type FixedRow, dailyEstimateFromTotal } from './wizard-planning-state';

type PlanejamentoState = {
  today: string;
  inflows: FixedRow[];
  outflows: FixedRow[];
  categories: FixedRow[];
  error: string;
};

const persist = debounce((state: PlanejamentoState, setError: (msg: string) => void) => {
  void persistNow(state, setError);
}, 150);

let persistSeq = 0;

export function renderPlanejamento(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-planejamento';

  const status = document.createElement('p');
  status.className = 'config-status';
  status.textContent = 'Carregando…';
  app.append(status, renderForecastNav('planejamento'));

  void (async () => {
    try {
      const db = await getDb();
      const today = todayBelem();
      const state = await loadState(db, today);
      paint(app, state);
    } catch (err) {
      status.textContent = `Falha ao abrir o planejamento: ${(err as Error).message}`;
      status.classList.add('config-status-erro');
    }
  })();
}

async function loadState(
  db: Awaited<ReturnType<typeof getDb>>,
  today: string,
): Promise<PlanejamentoState> {
  const [recs, budget] = await Promise.all([
    listRecurrences(db, today),
    getMonthlyBudget(db, today),
  ]);

  const inflows: FixedRow[] = [];
  const outflows: FixedRow[] = [];
  for (const r of recs) {
    if (!r.active) continue;
    const row: FixedRow = {
      id: r.id,
      name: r.label,
      cents: r.amount_cents,
      dayOfMonth: r.day_of_month,
    };
    if (r.kind === 'entrada') inflows.push(row);
    else outflows.push(row);
  }

  const categories: FixedRow[] = (budget?.lines ?? []).map((line) => ({
    id: line.category_id,
    name: line.name,
    cents: line.amount_cents,
    dayOfMonth: 1,
  }));

  return { today, inflows, outflows, categories, error: '' };
}

function paint(app: HTMLDivElement, state: PlanejamentoState): void {
  app.innerHTML = '';
  app.className = 'screen screen-planejamento';

  const setState = (next: PlanejamentoState, shouldPersist = true): void => {
    paint(app, next);
    if (shouldPersist) persist(next, (error) => {
      if (error === next.error) return;
      paint(app, { ...next, error });
    });
  };

  const title = document.createElement('h1');
  title.className = 'config-title';
  title.textContent = 'Planejamento';

  const hint = document.createElement('p');
  hint.className = 'wizard-hint';
  hint.textContent = 'De onde vem a previsão.';

  const body = document.createElement('div');
  body.className = 'planejamento-body';

  const fixos = document.createElement('div');
  fixos.className = 'wizard-fixed';
  fixos.append(
    sectionLabel('Entradas fixas'),
    fixedRowList(state.inflows, (inflows) => setState({ ...state, inflows, error: '' }), 'plus'),
    addFixedBtn('+ Adicionar entrada', () =>
      setState({ ...state, error: '', inflows: [...state.inflows, newFixedRow()] }, false),
    ),
    sectionLabel('Contas fixas'),
    fixedRowList(state.outflows, (outflows) => setState({ ...state, outflows, error: '' }), 'minus'),
    addFixedBtn('+ Adicionar conta', () =>
      setState({ ...state, error: '', outflows: [...state.outflows, newFixedRow()] }, false),
    ),
  );

  const gastos = document.createElement('div');
  gastos.className = 'wizard-fixed';
  gastos.append(
    sectionLabel('Gastos mensais'),
    compactRowList(
      state.categories,
      (categories) => setState({ ...state, categories, error: '' }),
      { withDay: false },
    ),
    addFixedBtn('+ Adicionar gasto', () =>
      setState(
        { ...state, error: '', categories: [...state.categories, newFixedRow()] },
        false,
      ),
    ),
    calcFooter(state),
  );

  body.append(fixos, gastos);

  const errorEl = document.createElement('p');
  errorEl.className = 'lancar-erro';
  errorEl.textContent = state.error;

  app.append(title, hint, body, errorEl, renderForecastNav('planejamento'));
}

function calcFooter(state: PlanejamentoState): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'planejamento-calc';

  const total = state.categories.reduce((s, c) => s + c.cents, 0n);
  const diario = dailyEstimateFromTotal(total);

  wrap.append(calcRow('Gastos previstos', `R$ ${formatAmount(total)}`));

  const rule = document.createElement('hr');
  rule.className = 'planejamento-calc-rule';
  wrap.append(rule);

  const suggested = calcRow('Estimativa diária', `R$ ${formatAmount(diario)}`);
  suggested.classList.add('planejamento-calc-sugerido');
  wrap.append(suggested);
  return wrap;
}

function calcRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'planejamento-calc-row';
  const k = document.createElement('span');
  k.textContent = label;
  const v = document.createElement('span');
  v.textContent = value;
  row.append(k, v);
  return row;
}

async function persistNow(
  state: PlanejamentoState,
  setError: (msg: string) => void,
): Promise<void> {
  const seq = ++persistSeq;
  try {
    const db = await getDb();
    const result = await savePlanningAssumptions(db, state.today, {
      categories: state.categories.map((c) => ({
        id: c.id,
        name: c.name,
        plannedCents: c.cents,
      })),
      fixos: [
        ...state.inflows.map((f) => ({
          id: f.id,
          kind: 'entrada' as const,
          label: f.name,
          amountCents: f.cents,
          dayOfMonth: f.dayOfMonth,
        })),
        ...state.outflows.map((f) => ({
          id: f.id,
          kind: 'saida' as const,
          label: f.name,
          amountCents: f.cents,
          dayOfMonth: f.dayOfMonth,
        })),
      ],
    });
    if (seq !== persistSeq) return;
    if (!result.budgetSaved) {
      setError('O orçamento mensal de gastos cotidianos precisa ser maior que zero.');
      return;
    }
    setError('');
  } catch (err) {
    if (seq !== persistSeq) return;
    setError((err as Error).message);
  }
}
