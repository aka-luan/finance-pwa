import { getDb } from '../db';
import {
  insertDiario,
  insertPurchase,
  listCards,
  previewInstallments,
  settleDay,
  todayBelem,
} from '../db/queries.mjs';
import { debounce } from './debounce';
import { formatCents, formatDateHeader, formatDateShort } from './format';
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

// Tela Lançar (SPEC.md §7): Diário (lista de valores) e Cartão (compra
// parcelada, issue #7). Entrada/Saída manuais não são pedidos por nenhum
// ticket ainda — só as recorrências os alimentam por ora — então o toggle
// abaixo fica com dois modos, não os quatro do §7.
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

  let tipo: 'diario' | 'cartao' = 'diario';
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

  // --- Tipo toggle -----------------------------------------------------

  const tipoToggle = document.createElement('div');
  tipoToggle.className = 'kind-toggle';

  const diarioBtn = document.createElement('button');
  diarioBtn.type = 'button';
  diarioBtn.textContent = 'Diário';

  const cartaoBtn = document.createElement('button');
  cartaoBtn.type = 'button';
  cartaoBtn.textContent = 'Cartão';

  // --- Diário section ----------------------------------------------------

  const diarioSection = document.createElement('div');
  diarioSection.className = 'lancar-diario';

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

  const diarioNumpad = createNumpad({
    onDigit: (digit) => amount.addDigit(digit),
    onBackspace: () => amount.backspace(),
    onAdd: commitItem,
  });

  diarioSection.append(amount.input, list, totalEl, diarioNumpad);

  // --- Cartão section ------------------------------------------------

  const cartaoSection = document.createElement('div');
  cartaoSection.className = 'lancar-cartao';

  const cardSelect = document.createElement('select');
  cardSelect.className = 'cartao-select';
  cardSelect.setAttribute('aria-label', 'Cartão');

  const parcelasLabel = document.createElement('label');
  parcelasLabel.className = 'recorrencia-dia-label';
  parcelasLabel.textContent = 'Parcelas';

  const parcelasInput = document.createElement('input');
  parcelasInput.type = 'number';
  parcelasInput.min = '1';
  parcelasInput.max = '48';
  parcelasInput.value = '1';
  parcelasInput.className = 'recorrencia-dia-input';
  parcelasLabel.append(parcelasInput);

  const cartaoAmount = createAmountField('Valor da compra');

  const previewEl = document.createElement('p');
  previewEl.className = 'cartao-preview';

  const updatePreview = debounce(async (): Promise<void> => {
    const cardId = cardSelect.value;
    const installments = Number(parcelasInput.value);
    const amountCents = cartaoAmount.cents();

    if (
      cardId === '' ||
      amountCents <= 0n ||
      !Number.isInteger(installments) ||
      installments < 1 ||
      installments > 48
    ) {
      previewEl.textContent = '';
      return;
    }

    try {
      const db = await getDb();
      const rows = await previewInstallments(db, cardId, date, amountCents, installments);
      const first = rows[0];
      const last = rows[rows.length - 1];
      if (!first || !last) {
        previewEl.textContent = '';
        return;
      }
      const vencimento = formatDateShort(first.due_date);
      if (installments === 1) {
        previewEl.textContent = `À vista — vence ${vencimento}`;
      } else if (first.amount_cents === last.amount_cents) {
        previewEl.textContent = `${installments}x de ${formatCents(first.amount_cents)} — primeira vence ${vencimento}`;
      } else {
        // O resto da divisão vai só na primeira parcela (SPEC.md §4), então
        // ela difere das demais em 1 centavo — dizer "Nx de R$X" aqui
        // afirmaria um valor uniforme que as outras parcelas não têm.
        previewEl.textContent =
          `${installments}x — primeira de ${formatCents(first.amount_cents)} (vence ${vencimento}), ` +
          `demais de ${formatCents(last.amount_cents)}`;
      }
    } catch (err) {
      previewEl.textContent = `Falha ao calcular: ${(err as Error).message}`;
    }
  }, 150);

  const cartaoNumpad = createNumpad({
    onDigit: (digit) => {
      cartaoAmount.addDigit(digit);
      void updatePreview();
    },
    onBackspace: () => {
      cartaoAmount.backspace();
      void updatePreview();
    },
  });

  cartaoSection.append(cardSelect, parcelasLabel, cartaoAmount.input, cartaoNumpad, previewEl);

  cardSelect.addEventListener('change', () => void updatePreview());
  parcelasInput.addEventListener('input', () => void updatePreview());

  let cardsLoaded = false;
  const loadCardsOnce = async (): Promise<void> => {
    if (cardsLoaded) return;
    cardSelect.innerHTML = '<option value="">Carregando…</option>';
    try {
      const db = await getDb();
      const cards = (await listCards(db)).filter((c) => c.archived_at === null);
      // Only latch on success — a failed load (e.g. getDb() not ready yet)
      // must stay retryable on the next tap of the Cartão tab, not lock the
      // screen into a permanent "Falha ao carregar" with no way forward.
      cardsLoaded = true;
      cardSelect.innerHTML = '';
      if (cards.length === 0) {
        cardSelect.innerHTML = '<option value="">Nenhum cartão cadastrado</option>';
        return;
      }
      for (const card of cards) {
        const option = document.createElement('option');
        option.value = card.id;
        option.textContent = card.name;
        cardSelect.append(option);
      }
      void updatePreview();
    } catch (err) {
      cardSelect.innerHTML = `<option value="">Falha ao carregar: ${(err as Error).message}</option>`;
    }
  };

  // --- Tipo switching ------------------------------------------------

  const renderTipo = (): void => {
    diarioBtn.classList.toggle('kind-ativo', tipo === 'diario');
    cartaoBtn.classList.toggle('kind-ativo', tipo === 'cartao');
    diarioBtn.setAttribute('aria-pressed', String(tipo === 'diario'));
    cartaoBtn.setAttribute('aria-pressed', String(tipo === 'cartao'));
    diarioSection.hidden = tipo !== 'diario';
    cartaoSection.hidden = tipo !== 'cartao';
    naoGasteiBtn.hidden = tipo !== 'diario';
    errorEl.textContent = '';
  };

  diarioBtn.addEventListener('click', () => {
    tipo = 'diario';
    renderTipo();
    amount.input.focus();
  });
  cartaoBtn.addEventListener('click', () => {
    tipo = 'cartao';
    renderTipo();
    void loadCardsOnce();
  });

  tipoToggle.append(diarioBtn, cartaoBtn);

  // --- Footer ----------------------------------------------------------

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

  const salvarDiario = async (): Promise<void> => {
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

  // Compra no cartão nunca toca o saldo (SPEC.md §3): só grava `purchase`.
  // pending_days só olha `transaction`, então o dia continua pendente até
  // um Diário real ser lançado nele — comportamento correto, não um bug a
  // esconder com um settleDay artificial aqui.
  const salvarCartao = async (): Promise<void> => {
    const cardId = cardSelect.value;
    const installments = Number(parcelasInput.value);
    const amountCents = cartaoAmount.cents();

    if (cardId === '') {
      errorEl.textContent = 'Escolha um cartão.';
      return;
    }
    if (!Number.isInteger(installments) || installments < 1 || installments > 48) {
      errorEl.textContent = 'Parcelas precisa estar entre 1 e 48.';
      return;
    }
    if (amountCents <= 0n) {
      errorEl.textContent = 'Valor precisa ser maior que zero.';
      return;
    }

    salvarBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const db = await getDb();
      const id = await insertPurchase(db, { cardId, date, amountCents, installments });
      avancar({ ids: [id], expiresAt: Date.now() + 5000, kind: 'purchase' });
    } catch (err) {
      salvarBtn.disabled = false;
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  const salvar = (): void => {
    void (tipo === 'diario' ? salvarDiario() : salvarCartao());
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

  salvarBtn.addEventListener('click', salvar);
  naoGasteiBtn.addEventListener('click', () => void naoGastei());

  footer.append(naoGasteiBtn, salvarBtn);

  app.append(header, tipoToggle, diarioSection, cartaoSection, errorEl, footer);
  renderTotal();
  renderTipo();
  amount.input.focus();

  // Desfazer o dia anterior da fila: apagar os lançamentos deixa aquele
  // dia pendente de novo, então a tela volta para ele.
  if (undo) {
    renderUndoToast(app, undo, () =>
      renderLancar(app, recovery ? { recovery: { days: recovery.days, index: recovery.index - 1 } } : {}),
    );
  }
}
