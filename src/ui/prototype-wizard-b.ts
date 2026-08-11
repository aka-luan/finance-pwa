/**
 * Variant B — single continuous worksheet; sticky live summary + confirm.
 * Hierarchy: everything editable at once; numbers always visible at bottom.
 */

import { formatAmount } from './format';
import {
  type WizardState,
  canConfirm,
  dailyEstimate,
  moneyFieldValue,
  monthlyTotal,
  parseMoneyInput,
  previewToday,
} from './prototype-wizard-state';

export function renderVariantB(
  root: HTMLElement,
  state: WizardState,
  setState: (next: WizardState) => void,
): void {
  root.replaceChildren();
  const screen = document.createElement('div');
  screen.className = 'screen proto-wizard proto-b';

  const head = document.createElement('header');
  head.className = 'proto-b-head';
  const title = document.createElement('h1');
  title.className = 'proto-title';
  title.textContent =
    state.mode === 'primeiro-uso' ? 'Montar o planejamento' : 'Recalibrar planejamento';
  const sub = document.createElement('p');
  sub.className = 'proto-hint';
  sub.textContent =
    state.mode === 'primeiro-uso'
      ? 'Preencha saldo e categorias. A estimativa diária atualiza embaixo.'
      : 'Ajuste o que mudou. A comparação com os últimos 30 dias fica ao lado de cada categoria.';
  head.append(title, sub);

  if (state.mode === 'primeiro-uso') {
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'proto-linkish';
    restore.textContent = 'Prefiro restaurar um backup…';
    restore.addEventListener('click', () => window.alert('PROTOTYPE: restaurar backup (stub)'));
    head.append(restore);
  }

  const sheet = document.createElement('div');
  sheet.className = 'proto-b-sheet';

  // Saldo block
  const saldoBlock = document.createElement('section');
  saldoBlock.className = 'proto-b-block';
  const saldoLabel = document.createElement('h2');
  saldoLabel.textContent = 'Saldo em conta';
  saldoBlock.append(saldoLabel, moneyInput(state.balanceCents, (balanceCents) => {
    setState({ ...state, balanceCents });
  }));

  // Categories
  const catBlock = document.createElement('section');
  catBlock.className = 'proto-b-block';
  const catLabel = document.createElement('h2');
  catLabel.textContent = 'Categorias do mês';
  catBlock.append(catLabel);

  for (const cat of state.categories) {
    const row = document.createElement('div');
    row.className = 'proto-b-cat';
    const top = document.createElement('div');
    top.className = 'proto-b-cat-top';
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
    top.append(
      name,
      moneyInput(cat.plannedCents, (plannedCents) => {
        setState({
          ...state,
          categories: state.categories.map((c) =>
            c.id === cat.id ? { ...c, plannedCents } : c,
          ),
        });
      }),
    );
    row.append(top);
    if (state.mode === 'recalibrar') {
      const cmp = document.createElement('div');
      cmp.className = 'proto-b-cmp';
      const delta = cat.actualCents - cat.plannedCents;
      cmp.textContent = `real 30d R$ ${formatAmount(cat.actualCents)} (${delta >= 0n ? '+' : ''}R$ ${formatAmount(delta)})`;
      row.append(cmp);
    }
    catBlock.append(row);
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
        { id: `c${Date.now()}`, name: 'Nova categoria', plannedCents: 0n, actualCents: 0n },
      ],
    });
  });
  catBlock.append(add);

  sheet.append(saldoBlock, catBlock);

  const dock = document.createElement('div');
  dock.className = 'proto-b-dock';
  const stats = document.createElement('div');
  stats.className = 'proto-b-stats';
  const preview = previewToday(state);
  stats.innerHTML = '';
  const mk = (label: string, value: bigint, negClass = false) => {
    const el = document.createElement('div');
    el.innerHTML = `<span>${label}</span><strong class="proto-mono${negClass && value < 0n ? ' valor-negativo' : ''}">R$ ${formatAmount(value)}</strong>`;
    return el;
  };
  stats.append(
    mk('mês', monthlyTotal(state)),
    mk('dia', dailyEstimate(state)),
    mk('hoje', preview, true),
  );

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'proto-btn proto-btn-primary';
  save.textContent = 'Salvar planejamento';
  save.disabled = !canConfirm(state);
  save.addEventListener('click', () => {
    window.alert('PROTOTYPE: gravaria saldo + composição + estimativa juntos');
  });
  dock.append(stats, save);

  screen.append(head, sheet, dock);
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

export const VARIANT_B_NAME = 'Folha única + resumo fixo';
