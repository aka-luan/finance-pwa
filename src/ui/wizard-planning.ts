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
import { renderConfiguracoes } from './configuracoes';
import { renderHoje } from './hoje';
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
  moneyFieldValue,
  monthlyTotal,
  outflowTotal,
  parseMoneyInput,
  previewToday,
} from './wizard-planning-state';

const STEPS = ['Saldo', 'Fixos', 'Cotidiano', 'Resumo'] as const;

let dayPickerAbort: AbortController | null = null;

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
    }
    footer.append(primaryBtn('Continuar', () => setState({ ...state, step: step + 1, error: '' })));
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
        () => void save(app, state, setState),
        !canConfirm(state) || state.saving,
      ),
    );
  }

  app.append(progress, title, body, errorEl, footer);
}

async function save(
  app: HTMLDivElement,
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
      renderHoje(app);
    } else {
      renderConfiguracoes(app);
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
          renderHoje(app);
        }
      } catch (err) {
        setState({ ...state, error: `Arquivo recusado: ${(err as Error).message}` });
      }
    })();
  });

  wrap.append(btn, fileInput);
  return wrap;
}

function moneyInput(cents: bigint, onCommit: (c: bigint) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'wizard-money';
  const prefix = document.createElement('span');
  prefix.textContent = 'R$';
  const input = document.createElement('input');
  input.inputMode = 'decimal';
  input.setAttribute('aria-label', 'Valor');
  input.value = moneyFieldValue(cents);
  input.placeholder = '0,00';
  input.addEventListener('change', () => {
    const parsed = parseMoneyInput(input.value);
    if (parsed === null) {
      input.value = moneyFieldValue(cents);
      return;
    }
    onCommit(parsed);
  });
  wrap.append(prefix, input);
  return wrap;
}

function sectionLabel(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'wizard-section';
  h.textContent = text;
  return h;
}

function fixedEditor(state: WizardState, setState: (s: WizardState) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wizard-fixed';
  wrap.append(
    sectionLabel('Entradas fixas'),
    fixedRowList(state.inflows, (inflows) => setState({ ...state, inflows, error: '' })),
    addFixedBtn('+ Adicionar entrada', () =>
      setState({
        ...state,
        error: '',
        inflows: [...state.inflows, newFixedRow()],
      }),
    ),
    sectionLabel('Saídas fixas'),
    fixedRowList(state.outflows, (outflows) => setState({ ...state, outflows, error: '' })),
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

function newFixedRow(): FixedRow {
  return { id: crypto.randomUUID(), name: 'Novo', cents: 0n, dayOfMonth: 1 };
}

function addFixedBtn(label: string, onClick: () => void): HTMLButtonElement {
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'wizard-add';
  add.textContent = label;
  add.addEventListener('click', onClick);
  return add;
}

function closeFixedMenus(): void {
  document.querySelectorAll('.wizard-more-wrap').forEach((el) => {
    el.dispatchEvent(new Event('wizard-more-close'));
  });
}

function moreMenu(onRemove: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wizard-more-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wizard-more';
  btn.textContent = '•••';
  btn.setAttribute('aria-label', 'Mais ações');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'wizard-more-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.setAttribute('role', 'menuitem');
  remove.textContent = 'Remover';
  remove.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onRemove();
  });
  menu.append(remove);

  let onDoc: ((e: Event) => void) | null = null;
  let onKey: ((e: KeyboardEvent) => void) | null = null;

  const close = (): void => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (onDoc) document.removeEventListener('click', onDoc);
    if (onKey) document.removeEventListener('keydown', onKey);
    onDoc = null;
    onKey = null;
  };

  wrap.addEventListener('wizard-more-close', close);

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const willOpen = menu.hidden;
    closeFixedMenus();
    if (!willOpen) return;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    onDoc = (e: Event) => {
      if (wrap.contains(e.target as Node)) return;
      close();
    };
    onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    setTimeout(() => {
      if (onDoc) document.addEventListener('click', onDoc);
      if (onKey) document.addEventListener('keydown', onKey);
    }, 0);
  });

  wrap.append(btn, menu);
  return wrap;
}

function openDayPicker(current: number, onPick: (day: number) => void): void {
  document.querySelector('.wizard-day-sheet-overlay')?.remove();
  dayPickerAbort?.abort();
  dayPickerAbort = new AbortController();
  const { signal } = dayPickerAbort;

  const overlay = document.createElement('div');
  overlay.className = 'wizard-day-sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'wizard-day-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Dia do mês');

  const title = document.createElement('p');
  title.className = 'wizard-day-sheet-title';
  title.textContent = 'Dia do mês';

  const grid = document.createElement('div');
  grid.className = 'wizard-day-sheet-grid';

  const close = (): void => {
    overlay.remove();
    dayPickerAbort?.abort();
    dayPickerAbort = null;
  };

  for (let d = 1; d <= 31; d++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.textContent = String(d);
    if (d === current) {
      cell.classList.add('is-selected');
      cell.setAttribute('aria-current', 'true');
    }
    cell.addEventListener('click', () => {
      close();
      onPick(d);
    });
    grid.append(cell);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') close();
    },
    { signal },
  );

  sheet.append(title, grid);
  overlay.append(sheet);
  document.body.append(overlay);
  sheet.querySelector<HTMLButtonElement>('.is-selected')?.focus();
}

function fixedRowList(
  rows: FixedRow[],
  onChange: (rows: FixedRow[]) => void,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'wizard-list wizard-fixed-list';

  for (const rowData of rows) {
    const row = document.createElement('div');
    row.className = 'wizard-fixed-card';

    const name = document.createElement('input');
    name.className = 'wizard-name';
    name.value = rowData.name;
    name.setAttribute('aria-label', 'Nome');
    name.addEventListener('change', () => {
      onChange(
        rows.map((r) =>
          r.id === rowData.id ? { ...r, name: name.value.trim() || r.name } : r,
        ),
      );
    });

    const money = moneyInput(rowData.cents, (cents) => {
      onChange(rows.map((r) => (r.id === rowData.id ? { ...r, cents } : r)));
    });

    const dayBtn = document.createElement('button');
    dayBtn.type = 'button';
    dayBtn.className = 'wizard-day-btn';
    dayBtn.textContent = `Dia ${rowData.dayOfMonth} ▾`;
    dayBtn.setAttribute('aria-label', `Dia do mês: ${rowData.dayOfMonth}`);
    dayBtn.setAttribute('aria-haspopup', 'dialog');
    dayBtn.addEventListener('click', () => {
      closeFixedMenus();
      openDayPicker(rowData.dayOfMonth, (dayOfMonth) => {
        onChange(rows.map((r) => (r.id === rowData.id ? { ...r, dayOfMonth } : r)));
      });
    });

    row.append(
      name,
      moreMenu(() => onChange(rows.filter((r) => r.id !== rowData.id))),
      money,
      dayBtn,
    );
    list.append(row);
  }
  return list;
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
