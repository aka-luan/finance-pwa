/**
 * Production planning wizard (issue #27).
 * Sequence from #15: Saldo → Fixos → Cotidiano → Resumo.
 */

import { getDb } from '../db';
import {
  importBackup,
  parseBackup,
} from '../db/backup.mjs';
import {
  confirmPlanning,
  getHoje,
  getMonthlyBudget,
  listRecurrences,
  needsFirstRun,
  spentByCategoryLast30Days,
  spentTodayDiario,
  todayBelem,
} from '../db/queries.mjs';
import { formatAmount } from './format';
import { renderHoje } from './hoje';
import { back, reset } from './nav';
import {
  addFixedBtn,
  fixedRowList,
  moneyInput,
  newFixedRow,
  sectionLabel,
  withPreservedScroll,
} from './planning-rows';
import {
  type FixedRow,
  type WizardMode,
  type WizardState,
  SUGGESTED_NAMES,
  canConfirm,
  dailyEstimate,
  emptyFirstRunState,
  fixedNet,
  inflowTotal,
  leftoverAfterPlan,
  monthlyTotal,
  outflowTotal,
  previewToday,
} from './wizard-planning-state';

const STEPS = ['Saldo', 'Fixos', 'Cotidiano', 'Resumo'] as const;

export function renderWizardPlanning(app: HTMLDivElement, mode: WizardMode): void {
  app.innerHTML = '';
  app.className = 'screen screen-wizard';

  const status = document.createElement('p');
  status.className = 'config-status';
  status.textContent = 'Carregando…';
  app.append(status);

  void (async () => {
    try {
      const db = await getDb();
      const today = todayBelem();
      const state =
        mode === 'primeiro-uso'
          ? emptyFirstRunState()
          : await loadRecalibrateState(db, today);
      paint(app, state);
    } catch (err) {
      status.textContent = `Falha ao abrir o planejamento: ${(err as Error).message}`;
      status.classList.add('config-status-erro');
    }
  })();
}

async function loadRecalibrateState(
  db: Awaited<ReturnType<typeof getDb>>,
  today: string,
): Promise<WizardState> {
  const hoje = await getHoje(db, today);
  const spentToday = await spentTodayDiario(db, today);
  const budget = await getMonthlyBudget(db, today);
  const actuals = await spentByCategoryLast30Days(db, today);
  const actualByCat = new Map<string | null, bigint>();
  for (const row of actuals) {
    actualByCat.set(row.category_id, row.amount_cents);
  }

  const categories = [];
  if (budget) {
    for (const line of budget.lines) {
      categories.push({
        id: line.category_id,
        name: line.name,
        plannedCents: line.amount_cents,
        actualCents: actualByCat.get(line.category_id) ?? 0n,
      });
      actualByCat.delete(line.category_id);
    }
  } else {
    for (const name of SUGGESTED_NAMES) {
      categories.push({
        id: crypto.randomUUID(),
        name,
        plannedCents: 0n,
        actualCents: 0n,
      });
    }
  }
  for (const [categoryId, amount] of actualByCat) {
    if (categoryId === null) continue;
    const { rows } = await db.query<{ name: string }>(
      'select name from category where id = $1',
      [categoryId],
    );
    const name = rows[0]?.name ?? 'Categoria';
    categories.push({
      id: categoryId,
      name,
      plannedCents: 0n,
      actualCents: amount,
    });
  }

  const recs = await listRecurrences(db, today);
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

  return {
    mode: 'recalibrar',
    balanceCents: hoje.saldoCents,
    spentTodayCents: spentToday,
    inflows,
    outflows,
    categories,
    step: 0,
    error: '',
    saving: false,
  };
}

function paint(app: HTMLDivElement, state: WizardState): void {
  withPreservedScroll(app, '.wizard-body', () => {
  app.innerHTML = '';
  app.className = 'screen screen-wizard';

  const step = Math.min(state.step, STEPS.length - 1);
  const setState = (next: WizardState) => paint(app, next);

  const progress = document.createElement('p');
  progress.className = 'wizard-progress';
  progress.textContent = `${step + 1}/${STEPS.length} · ${STEPS[step]}`;

  const title = document.createElement('h1');
  title.className = 'wizard-title';

  const body = document.createElement('div');
  body.className = 'wizard-body';

  const footer = document.createElement('div');
  footer.className = 'tela-footer';

  const errorEl = document.createElement('p');
  errorEl.className = 'lancar-erro';
  errorEl.textContent = state.error;

  if (STEPS[step] === 'Saldo') {
    title.textContent =
      state.mode === 'primeiro-uso' ? 'Quanto você tem na conta agora?' : 'Atualizar saldo em conta';
    const hint = document.createElement('p');
    hint.className = 'wizard-hint';
    hint.textContent = 'Pode ser negativo. Não inclui limite nem fatura do cartão.';
    body.append(hint, moneyInput(state.balanceCents, (cents) => {
      setState({ ...state, balanceCents: cents, error: '' });
    }));
    if (state.mode === 'primeiro-uso') {
      body.append(restoreControl(app, state, setState));
      footer.append(primaryBtn('Continuar', () => setState({ ...state, step: step + 1, error: '' })));
    } else {
      footer.append(
        secondaryBtn('Voltar', () => back()),
        primaryBtn('Continuar', () => setState({ ...state, step: step + 1, error: '' })),
      );
    }
  } else if (STEPS[step] === 'Fixos') {
    title.textContent = 'O que entra e sai todo mês?';
    const hint = document.createElement('p');
    hint.className = 'wizard-hint';
    hint.textContent = 'Entram automaticamente todo mês.';
    body.append(hint, fixedEditor(state, setState));
    footer.append(
      secondaryBtn('Voltar', () => setState({ ...state, step: step - 1, error: '' })),
      primaryBtn('Continuar', () => setState({ ...state, step: step + 1, error: '' })),
    );
  } else if (STEPS[step] === 'Cotidiano') {
    title.textContent =
      state.mode === 'primeiro-uso'
        ? 'Quanto você geralmente gasta por categoria?'
        : 'Quanto você quer gastar por categoria?';
    const hint = document.createElement('p');
    hint.className = 'wizard-hint';
    hint.textContent =
      state.mode === 'primeiro-uso'
        ? 'Por alto. A média disso no mês vira uma prévia do diário. Zero em alguma categoria tudo bem.'
        : 'Ajuste por alto o que mudou. A média no mês continua sendo a prévia do diário.';
    body.append(hint, categoryEditor(state, setState));
    footer.append(
      secondaryBtn('Voltar', () => setState({ ...state, step: step - 1, error: '' })),
      primaryBtn(
        'Continuar',
        () => setState({ ...state, step: step + 1, error: '' }),
        !canConfirm(state) || state.saving,
      ),
    );
  } else {
    title.textContent = 'Ficou assim';
    body.append(confirmSummary(state));
    footer.append(
      secondaryBtn('Voltar', () => setState({ ...state, step: step - 1, error: '' }), state.saving),
      primaryBtn(
        state.saving ? 'Salvando…' : 'Salvar planejamento',
        () => void save(state, setState),
        !canConfirm(state) || state.saving,
      ),
    );
  }

  app.append(progress, title, body, errorEl, footer);
  });
}

async function save(
  state: WizardState,
  setState: (s: WizardState) => void,
): Promise<void> {
  if (!canConfirm(state) || state.saving) return;
  setState({ ...state, saving: true, error: '' });
  try {
    const db = await getDb();
    const today = todayBelem();
    const fixos = [
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
    ];
    await confirmPlanning(db, today, {
      balanceCents: state.balanceCents,
      categories: state.categories.map((c) => ({
        id: c.id,
        name: c.name,
        plannedCents: c.plannedCents,
      })),
      fixos,
    });
    if (state.mode === 'primeiro-uso') {
      reset(renderHoje);
    } else {
      back();
    }
  } catch (err) {
    setState({ ...state, saving: false, error: (err as Error).message });
  }
}

function restoreControl(
  app: HTMLDivElement,
  state: WizardState,
  setState: (s: WizardState) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wizard-restore';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wizard-link';
  btn.textContent = 'Restaurar backup…';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.className = 'config-file';

  btn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    void (async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const backup = parseBackup(await file.text());
        const db = await getDb();
        await importBackup(db, backup);
        if (await needsFirstRun(db)) {
          setState({
            ...emptyFirstRunState(),
            error: 'Backup restaurado, mas ainda falta saldo ou estimativa. Continue o planejamento.',
          });
        } else {
          reset(renderHoje);
        }
      } catch (err) {
        setState({ ...state, error: `Arquivo recusado: ${(err as Error).message}` });
      }
    })();
  });

    wrap.append(btn, fileInput);
  return wrap;
}

function fixedEditor(state: WizardState, setState: (s: WizardState) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wizard-fixed';
  wrap.append(
    sectionLabel('Entradas fixas'),
    fixedRowList(state.inflows, (inflows) => setState({ ...state, inflows, error: '' }), 'plus'),
    addFixedBtn('+ Adicionar entrada', () =>
      setState({
        ...state,
        error: '',
        inflows: [...state.inflows, newFixedRow()],
      }),
    ),
    sectionLabel('Saídas fixas'),
    fixedRowList(state.outflows, (outflows) => setState({ ...state, outflows, error: '' }), 'minus'),
    addFixedBtn('+ Adicionar saída', () =>
      setState({
        ...state,
        error: '',
        outflows: [...state.outflows, newFixedRow()],
      }),
    ),
  );
  const total = document.createElement('p');
  total.className = 'wizard-running';
  const net = fixedNet(state);
  total.textContent =
    `Entra R$ ${formatAmount(inflowTotal(state))} · sai R$ ${formatAmount(outflowTotal(state))} · ` +
    `líquido ${net < 0n ? '−' : ''}R$ ${formatAmount(net < 0n ? -net : net)}`;
  wrap.append(total);
  return wrap;
}

function categoryEditor(state: WizardState, setState: (s: WizardState) => void): HTMLElement {
  const list = document.createElement('div');
  list.className = 'wizard-list';

  for (const cat of state.categories) {
    const row = document.createElement('div');
    row.className = 'wizard-row wizard-row-cat';
    const name = document.createElement('input');
    name.className = 'wizard-name';
    name.value = cat.name;
    name.addEventListener('change', () => {
      setState({
        ...state,
        error: '',
        categories: state.categories.map((c) =>
          c.id === cat.id ? { ...c, name: name.value.trim() || c.name } : c,
        ),
      });
    });
    const money = moneyInput(cat.plannedCents, (plannedCents) => {
      setState({
        ...state,
        error: '',
        categories: state.categories.map((c) =>
          c.id === cat.id ? { ...c, plannedCents } : c,
        ),
      });
    });
    row.append(name, money);
    if (state.mode === 'recalibrar' && (cat.plannedCents !== 0n || cat.actualCents !== 0n)) {
      row.append(actualLine(cat));
    }
    list.append(row);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'wizard-link';
  add.textContent = '+ categoria';
  add.addEventListener('click', () => {
    setState({
      ...state,
      categories: [
        ...state.categories,
        { id: crypto.randomUUID(), name: 'Nova', plannedCents: 0n, actualCents: 0n },
      ],
    });
  });
  list.append(add);

  const running = document.createElement('p');
  running.className = 'wizard-running';
  const total = monthlyTotal(state);
  running.textContent =
    `Total no mês R$ ${formatAmount(total)} · prévia do diário R$ ${formatAmount(dailyEstimate(state))}`;
  list.append(running);
  return list;
}

function actualLine(cat: { plannedCents: bigint; actualCents: bigint }): HTMLElement {
  const row = document.createElement('p');
  row.className = 'wizard-actual';
  const delta = cat.actualCents - cat.plannedCents;
  const deltaTxt =
    delta === 0n
      ? 'no plano'
      : `${delta > 0n ? '+' : '−'}R$ ${formatAmount(delta < 0n ? -delta : delta)}`;
  row.textContent = `30d R$ ${formatAmount(cat.actualCents)} (${deltaTxt})`;
  return row;
}

function confirmSummary(state: WizardState): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wizard-summary';
  const leftover = leftoverAfterPlan(state);
  const rows: [string, string][] = [
    ['Saldo em conta', `R$ ${formatAmount(state.balanceCents)}`],
    ['Entradas fixas', `R$ ${formatAmount(inflowTotal(state))}`],
    ['Saídas fixas', `R$ ${formatAmount(outflowTotal(state))}`],
    ['Cotidiano no mês', `R$ ${formatAmount(monthlyTotal(state))}`],
    ['Prévia do diário', `R$ ${formatAmount(dailyEstimate(state))}`],
    ['Prévia de hoje', `R$ ${formatAmount(previewToday(state))}`],
    [
      'Depois de fixos + cotidiano',
      `${leftover < 0n ? '−' : ''}R$ ${formatAmount(leftover < 0n ? -leftover : leftover)}`,
    ],
  ];
  for (const [k, v] of rows) {
    const row = document.createElement('div');
    row.className = 'wizard-summary-row';
    const kk = document.createElement('span');
    kk.textContent = k;
    const vv = document.createElement('span');
    vv.textContent = v;
    if (k === 'Prévia de hoje' && previewToday(state) < 0n) vv.classList.add('valor-negativo');
    if (k === 'Depois de fixos + cotidiano' && leftover < 0n) vv.classList.add('valor-negativo');
    row.append(kk, vv);
    wrap.append(row);
  }
  return wrap;
}

function primaryBtn(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-salvar';
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

function secondaryBtn(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secundario';
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}
