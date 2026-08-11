/**
 * Variant C — comparison-first (recalibration as the home metaphor).
 * First use collapses comparison into a short "começar do zero" path;
 * recalibration leads with planned vs actual, then inline adjust.
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

export function renderVariantC(
  root: HTMLElement,
  state: WizardState,
  setState: (next: WizardState) => void,
): void {
  root.replaceChildren();
  const screen = document.createElement('div');
  screen.className = 'screen proto-wizard proto-c';

  const rail = document.createElement('aside');
  rail.className = 'proto-c-rail';
  const live = document.createElement('div');
  live.className = 'proto-c-live';
  live.innerHTML = `
    <div class="proto-c-live-kicker">Prévia Hoje</div>
    <div class="proto-c-live-num proto-mono${previewToday(state) < 0n ? ' valor-negativo' : ''}">R$ ${formatAmount(previewToday(state))}</div>
    <div class="proto-c-live-sub">estimativa R$ ${formatAmount(dailyEstimate(state))} · mês R$ ${formatAmount(monthlyTotal(state))}</div>
    <div class="proto-c-live-sub${state.balanceCents < 0n ? ' valor-negativo' : ''}">saldo R$ ${formatAmount(state.balanceCents)}</div>
  `;
  rail.append(live);

  const main = document.createElement('div');
  main.className = 'proto-c-main';

  const title = document.createElement('h1');
  title.className = 'proto-title';
  title.textContent =
    state.mode === 'primeiro-uso' ? 'Primeiro planejamento' : 'O que mudou nos últimos 30 dias?';

  const hint = document.createElement('p');
  hint.className = 'proto-hint';
  hint.textContent =
    state.mode === 'primeiro-uso'
      ? 'Defina saldo e quanto quer gastar por categoria. A coluna da esquerda mostra a prévia de Hoje.'
      : 'Olhe a diferença, depois edite o planejado. Nada é aplicado sozinho.';

  main.append(title, hint);

  // Saldo as a compact chip row
  const saldoRow = document.createElement('div');
  saldoRow.className = 'proto-c-saldo';
  const saldoLab = document.createElement('label');
  saldoLab.textContent = 'Saldo em conta';
  saldoRow.append(
    saldoLab,
    moneyInput(state.balanceCents, (balanceCents) => setState({ ...state, balanceCents })),
  );
  if (state.mode === 'primeiro-uso') {
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'proto-linkish';
    restore.textContent = 'Restaurar backup';
    restore.addEventListener('click', () => window.alert('PROTOTYPE: restaurar backup (stub)'));
    saldoRow.append(restore);
  }
  main.append(saldoRow);

  const list = document.createElement('div');
  list.className = 'proto-c-list';

  for (const cat of state.categories) {
    const card = document.createElement('div');
    card.className = 'proto-c-item';

    if (state.mode === 'recalibrar') {
      const head = document.createElement('div');
      head.className = 'proto-c-item-head';
      const delta = cat.actualCents - cat.plannedCents;
      const badge = document.createElement('span');
      badge.className = 'proto-c-badge' + (delta > 0n ? ' over' : delta < 0n ? ' under' : '');
      badge.textContent =
        delta === 0n
          ? 'no alvo'
          : delta > 0n
            ? `+R$ ${formatAmount(delta)} acima`
            : `R$ ${formatAmount(-delta)} abaixo`;
      head.append(badge);
      card.append(head);

      const dual = document.createElement('div');
      dual.className = 'proto-c-dual';
      dual.innerHTML = `<span>planejado R$ ${formatAmount(cat.plannedCents)}</span><span>real R$ ${formatAmount(cat.actualCents)}</span>`;
      card.append(dual);
    }

    const edit = document.createElement('div');
    edit.className = 'proto-c-edit';
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
    edit.append(
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
    card.append(edit);
    list.append(card);
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

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'proto-btn proto-btn-primary proto-c-save';
  save.textContent = 'Confirmar e gravar';
  save.disabled = !canConfirm(state);
  save.addEventListener('click', () => {
    window.alert(
      `PROTOTYPE confirm\nsaldo ${formatAmount(state.balanceCents)}\nmês ${formatAmount(monthlyTotal(state))}\ndia ${formatAmount(dailyEstimate(state))}\nhoje ${formatAmount(previewToday(state))}`,
    );
  });

  main.append(list, add, save);
  screen.append(rail, main);
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

export const VARIANT_C_NAME = 'Comparar → ajustar';
