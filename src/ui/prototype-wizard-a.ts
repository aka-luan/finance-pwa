/**
 * Variant A — linear stepper: one concern per screen.
 * Hierarchy: progress → single question → primary CTA.
 */

import { formatAmount } from './format';
import {
  type WizardState,
  canConfirm,
  dailyEstimate,
  fixedNet,
  inflowTotal,
  leftoverAfterPlan,
  outflowTotal,
  moneyFieldValue,
  monthlyTotal,
  parseMoneyInput,
  previewToday,
} from './prototype-wizard-state';

const STEPS = ['Saldo', 'Fixos', 'Cotidiano', 'Resumo'] as const;

export function renderVariantA(
  root: HTMLElement,
  state: WizardState,
  setState: (next: WizardState) => void,
): void {
  root.replaceChildren();
  const steps = STEPS;
  const step = Math.min(state.step, steps.length - 1);

  const screen = document.createElement('div');
  screen.className = 'screen proto-wizard proto-a';

  const progress = document.createElement('div');
  progress.className = 'proto-progress';
  progress.textContent = `${step + 1}/${steps.length} · ${steps[step]}`;

  const title = document.createElement('h1');
  title.className = 'proto-title';

  const body = document.createElement('div');
  body.className = 'proto-body';

  const footer = document.createElement('div');
  footer.className = 'proto-footer';

  const go = (nextStep: number) => setState({ ...state, step: nextStep });

  if (steps[step] === 'Saldo') {
    title.textContent =
      state.mode === 'primeiro-uso' ? 'Quanto você tem na conta agora?' : 'Atualizar saldo em conta';
    const hint = document.createElement('p');
    hint.className = 'proto-hint';
    hint.textContent = 'Pode ser negativo. Não inclui limite nem fatura do cartão.';
    const input = moneyInput(state.balanceCents, (cents) => {
      setState({ ...state, balanceCents: cents });
    });
    body.append(hint, input);
    if (state.mode === 'primeiro-uso') {
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'proto-linkish';
      restore.textContent = 'Restaurar backup…';
      restore.addEventListener('click', () => {
        window.alert('PROTOTYPE: restaurar backup (stub)');
      });
      body.append(restore);
    }
    footer.append(
      primaryBtn('Continuar', () => go(step + 1)),
    );
  } else if (steps[step] === 'Fixos') {
    title.textContent = 'O que entra e sai todo mês?';
    const hint = document.createElement('p');
    hint.className = 'proto-hint';
    hint.textContent =
      'Salário, freelas, aluguel, contas… viram entrada ou saída. Não entram no diário. Pode deixar zero.';
    body.append(hint, fixedEditor(state, setState));
    footer.append(
      secondaryBtn('Voltar', () => go(step - 1)),
      primaryBtn('Continuar', () => go(step + 1)),
    );
  } else if (steps[step] === 'Cotidiano') {
    title.textContent =
      state.mode === 'primeiro-uso'
        ? 'Quanto você geralmente gasta por categoria?'
        : 'Quanto você quer gastar por categoria?';
    const hint = document.createElement('p');
    hint.className = 'proto-hint';
    hint.textContent =
      state.mode === 'primeiro-uso'
        ? 'Por alto. A média disso no mês vira uma prévia do diário. Zero em alguma categoria tudo bem.'
        : 'Ajuste por alto o que mudou. A média no mês continua sendo a prévia do diário.';
    if (state.mode === 'recalibrar') {
      body.append(hint, compareList(state), categoryEditor(state, setState));
    } else {
      body.append(hint, categoryEditor(state, setState));
    }
    footer.append(
      secondaryBtn('Voltar', () => go(step - 1)),
      primaryBtn('Continuar', () => go(step + 1), !canConfirm(state)),
    );
  } else {
    title.textContent = 'Ficou assim';
    body.append(confirmSummary(state));
    footer.append(
      secondaryBtn('Voltar', () => go(step - 1)),
      primaryBtn('Salvar planejamento', () => {
        window.alert(
          'PROTOTYPE: gravaria saldo + fixos (entradas/saídas) + cotidianos + estimativa diária',
        );
      }, !canConfirm(state)),
    );
  }

  screen.append(progress, title, body, footer);
  root.append(screen);
}

function moneyInput(cents: bigint, onCommit: (c: bigint) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'proto-money';
  const prefix = document.createElement('span');
  prefix.textContent = 'R$';
  const input = document.createElement('input');
  input.inputMode = 'decimal';
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

function namedMoneyList(
  rows: { id: string; name: string; cents: bigint }[],
  onChange: (rows: { id: string; name: string; cents: bigint }[]) => void,
  addLabel: string,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'proto-cat-list';

  for (const rowData of rows) {
    const row = document.createElement('div');
    row.className = 'proto-cat-row';
    const name = document.createElement('input');
    name.className = 'proto-cat-name';
    name.value = rowData.name;
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
    row.append(name, money);
    list.append(row);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'proto-linkish';
  add.textContent = addLabel;
  add.addEventListener('click', () => {
    onChange([...rows, { id: `n${Date.now()}`, name: 'Novo', cents: 0n }]);
  });
  list.append(add);
  return list;
}

function sectionLabel(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'proto-section';
  h.textContent = text;
  return h;
}

function fixedEditor(state: WizardState, setState: (s: WizardState) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'proto-fixed';
  wrap.append(
    sectionLabel('Entradas fixas'),
    namedMoneyList(state.inflows, (inflows) => setState({ ...state, inflows }), '+ entrada'),
    sectionLabel('Saídas fixas'),
    namedMoneyList(state.outflows, (outflows) => setState({ ...state, outflows }), '+ conta'),
  );
  const total = document.createElement('p');
  total.className = 'proto-running';
  const net = fixedNet(state);
  total.textContent = `Entra R$ ${formatAmount(inflowTotal(state))} · sai R$ ${formatAmount(outflowTotal(state))} · líquido ${net < 0n ? '−' : ''}R$ ${formatAmount(net < 0n ? -net : net)}`;
  wrap.append(total);
  return wrap;
}

function categoryEditor(state: WizardState, setState: (s: WizardState) => void): HTMLElement {
  const list = document.createElement('div');
  list.className = 'proto-cat-list';

  for (const cat of state.categories) {
    const row = document.createElement('div');
    row.className = 'proto-cat-row';
    const name = document.createElement('input');
    name.className = 'proto-cat-name';
    name.value = cat.name;
    name.addEventListener('change', () => {
      setState({
        ...state,
        categories: state.categories.map((c) =>
          c.id === cat.id ? { ...c, name: name.value.trim() || c.name } : c,
        ),
      });
    });
    const money = moneyInput(cat.plannedCents, (plannedCents) => {
      setState({
        ...state,
        categories: state.categories.map((c) =>
          c.id === cat.id ? { ...c, plannedCents } : c,
        ),
      });
    });
    row.append(name, money);
    list.append(row);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'proto-linkish';
  add.textContent = '+ categoria';
  add.addEventListener('click', () => {
    setState({
      ...state,
      categories: [
        ...state.categories,
        {
          id: `c${Date.now()}`,
          name: 'Nova categoria',
          plannedCents: 0n,
          actualCents: 0n,
        },
      ],
    });
  });
  list.append(add);

  const total = document.createElement('p');
  total.className = 'proto-running';
  total.textContent = `No mês ~ R$ ${formatAmount(monthlyTotal(state))} · prévia do dia ~ R$ ${formatAmount(dailyEstimate(state))}`;
  list.append(total);
  return list;
}

function compareList(state: WizardState): HTMLElement {
  const list = document.createElement('div');
  list.className = 'proto-compare';
  for (const cat of state.categories) {
    const row = document.createElement('div');
    row.className = 'proto-compare-row';
    const name = document.createElement('div');
    name.className = 'proto-compare-name';
    name.textContent = cat.name;
    const nums = document.createElement('div');
    nums.className = 'proto-compare-nums';
    const delta = cat.actualCents - cat.plannedCents;
    nums.textContent = `plan R$ ${formatAmount(cat.plannedCents)} · real R$ ${formatAmount(cat.actualCents)} · ${delta >= 0n ? '+' : ''}R$ ${formatAmount(delta)}`;
    const bar = document.createElement('div');
    bar.className = 'proto-bar';
    const fill = document.createElement('div');
    fill.className = 'proto-bar-fill';
    const max = cat.plannedCents > cat.actualCents ? cat.plannedCents : cat.actualCents;
    const pct = max === 0n ? 0 : Number((cat.actualCents * 100n) / max);
    fill.style.width = `${Math.min(100, pct)}%`;
    fill.classList.toggle('over', cat.actualCents > cat.plannedCents && cat.plannedCents > 0n);
    bar.append(fill);
    row.append(name, nums, bar);
    list.append(row);
  }
  return list;
}

function confirmSummary(state: WizardState): HTMLElement {
  const box = document.createElement('div');
  box.className = 'proto-summary';
  const leftover = leftoverAfterPlan(state);
  const lines = [
    ['Saldo em conta', `R$ ${formatAmount(state.balanceCents)}`],
    ['Entradas fixas', `R$ ${formatAmount(inflowTotal(state))}`],
    ['Saídas fixas', `R$ ${formatAmount(outflowTotal(state))}`],
    ['Cotidiano no mês', `R$ ${formatAmount(monthlyTotal(state))}`],
    ['Prévia do diário', `R$ ${formatAmount(dailyEstimate(state))}`],
    ['Prévia de hoje', `R$ ${formatAmount(previewToday(state))}`],
    ['Depois de fixos + cotidiano', `R$ ${formatAmount(leftover)}`],
  ] as const;
  for (const [k, v] of lines) {
    const row = document.createElement('div');
    row.className = 'proto-summary-row';
    const kk = document.createElement('span');
    kk.textContent = k;
    const vv = document.createElement('span');
    vv.className = 'proto-mono';
    vv.textContent = v;
    if (k === 'Prévia de hoje' && previewToday(state) < 0n) vv.classList.add('valor-negativo');
    if (k === 'Saldo em conta' && state.balanceCents < 0n) vv.classList.add('valor-negativo');
    if (k === 'Depois de fixos + cotidiano' && leftover < 0n) vv.classList.add('valor-negativo');
    row.append(kk, vv);
    box.append(row);
  }
  const cats = document.createElement('ul');
  cats.className = 'proto-summary-cats';
  for (const c of state.categories) {
    if (c.plannedCents === 0n) continue;
    const li = document.createElement('li');
    li.textContent = `${c.name}: R$ ${formatAmount(c.plannedCents)}`;
    cats.append(li);
  }
  box.append(cats);
  return box;
}

function primaryBtn(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'proto-btn proto-btn-primary';
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function secondaryBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'proto-btn proto-btn-secondary';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export const VARIANT_A_NAME = 'Passos (um por tela)';
