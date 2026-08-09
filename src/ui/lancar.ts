import { getDb } from '../db';
import { insertDiario, settleDay, todayBelem } from '../db/queries.mjs';
import { formatCents, formatDateHeader } from './format';
import { renderHoje } from './hoje';
import { createAmountField, createNumpad } from './numpad';
import { renderUndoToast, type UndoState } from './undo';

interface Item {
  key: string;
  amountCents: bigint;
}

// Modo de recuperação (SPEC.md §8): a lista de pendentes é a fotografia
// tirada quando o usuário entrou, não uma consulta a cada dia. É o que
// mantém o "2 de 4" estável enquanto os dias vão sendo lançados.
export interface Recovery {
  days: string[];
  index: number;
}

export interface LancarOptions {
  recovery?: Recovery;
  undo?: UndoState;
}

// Tela Lançar (SPEC.md §7), Diário only — Cartão mode e recorrências são
// tickets posteriores.
export function renderLancar(app: HTMLDivElement, options: LancarOptions = {}): void {
  const { recovery, undo } = options;

  // Fim da fila (ou fotografia vazia): volta a Hoje com o saldo atualizado
  // em vez de mostrar "1 de 0".
  const date = recovery ? recovery.days[recovery.index] : todayBelem();
  if (date === undefined) {
    renderHoje(app, undo);
    return;
  }

  app.innerHTML = '';
  app.className = 'screen screen-lancar';

  const items: Item[] = [];

  // Data grande e explícita mesmo em recuperação: a posição diz onde o
  // usuário está na fila, mas o risco de erro da tela é justamente perder
  // de vista qual dia se está lançando (SPEC.md §7).
  const header = document.createElement('div');
  header.className = 'lancar-header';

  if (recovery) {
    const posicaoEl = document.createElement('p');
    posicaoEl.className = 'lancar-posicao';
    posicaoEl.textContent = `${recovery.index + 1} de ${recovery.days.length}`;
    header.append(posicaoEl);
  }

  const dateEl = document.createElement('h1');
  dateEl.className = 'lancar-date';
  dateEl.textContent = formatDateHeader(date);
  header.append(dateEl);

  const amount = createAmountField('Valor');

  const list = document.createElement('ul');
  list.className = 'lancar-lista';

  const totalEl = document.createElement('p');
  totalEl.className = 'lancar-total';

  const renderTotal = (): void => {
    const total = items.reduce((sum, item) => sum + item.amountCents, 0n);
    totalEl.textContent = `Total: ${formatCents(total)}`;
  };

  const renderList = (): void => {
    list.innerHTML = '';
    for (const item of items) {
      const li = document.createElement('li');

      const amountSpan = document.createElement('span');
      amountSpan.textContent = formatCents(item.amountCents);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'item-remover';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', 'Remover item');
      removeBtn.addEventListener('click', () => {
        const idx = items.findIndex((i) => i.key === item.key);
        if (idx !== -1) items.splice(idx, 1);
        renderList();
      });

      li.append(amountSpan, removeBtn);
      list.append(li);
    }
    renderTotal();
  };

  const commitItem = (): void => {
    const amountCents = amount.cents();
    if (amountCents <= 0n) return;
    items.push({ key: crypto.randomUUID(), amountCents });
    amount.clear();
    renderList();
  };

  const numpad = createNumpad({
    onDigit: (digit) => amount.addDigit(digit),
    onBackspace: () => amount.backspace(),
    onAdd: commitItem,
  });

  const footer = document.createElement('div');
  footer.className = 'tela-footer';

  const salvarBtn = document.createElement('button');
  salvarBtn.type = 'button';
  salvarBtn.className = 'btn-salvar';
  salvarBtn.textContent = 'Salvar';

  const naoGasteiBtn = document.createElement('button');
  naoGasteiBtn.type = 'button';
  naoGasteiBtn.className = 'btn-secundario';
  naoGasteiBtn.textContent = 'Não gastei nada';

  const errorEl = document.createElement('p');
  errorEl.className = 'lancar-erro';

  // "Ambos avançam direto para o próximo dia pendente sem voltar à tela
  // inicial; quando acabam, retorna a Hoje com o saldo atualizado" (§7).
  const avancar = (saved?: UndoState): void => {
    if (recovery) {
      renderLancar(app, {
        recovery: { days: recovery.days, index: recovery.index + 1 },
        undo: saved,
      });
    } else {
      renderHoje(app, saved);
    }
  };

  const salvar = async (): Promise<void> => {
    // A value typed but not yet added with "+" is still meant to be saved.
    commitItem();
    if (items.length === 0) return;

    salvarBtn.disabled = true;
    naoGasteiBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const db = await getDb();
      const ids = await insertDiario(
        db,
        date,
        items.map((item) => ({ amountCents: item.amountCents })),
      );
      avancar({ ids, expiresAt: Date.now() + 5000 });
    } catch (err) {
      salvarBtn.disabled = false;
      naoGasteiBtn.disabled = false;
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  const naoGastei = async (): Promise<void> => {
    salvarBtn.disabled = true;
    naoGasteiBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const db = await getDb();
      await settleDay(db, date);
      avancar();
    } catch (err) {
      salvarBtn.disabled = false;
      naoGasteiBtn.disabled = false;
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  salvarBtn.addEventListener('click', () => void salvar());
  naoGasteiBtn.addEventListener('click', () => void naoGastei());

  footer.append(naoGasteiBtn, salvarBtn);

  app.append(header, amount.input, list, totalEl, numpad, errorEl, footer);
  renderTotal();
  amount.input.focus();

  // Desfazer o dia anterior da fila: apagar os lançamentos deixa aquele
  // dia pendente de novo, então a tela volta para ele.
  if (undo) {
    renderUndoToast(app, undo, () =>
      renderLancar(app, recovery ? { recovery: { days: recovery.days, index: recovery.index - 1 } } : {}),
    );
  }
}
