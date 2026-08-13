import { getDb } from '../db';
import {
  insertPurchase,
  insertTransactions,
  listCards,
  previewInstallments,
  settleDay,
  todayBelem,
  type Card,
} from '../db/queries.mjs';
import { debounce } from './debounce';
import { formatAmount, formatDateHeader, formatDateSlash } from './format';
import { renderHoje } from './hoje';
import { replace, reset } from './nav';
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

// Parcelamentos que a tela oferece. O botão cicla a lista em vez de abrir um
// campo numérico: parcela é escolha de dois ou três toques, não de digitação.
// Vai além do 12 do design porque o schema aceita até 48 e trocar o campo por
// um ciclo não deveria tirar do usuário um parcelamento que ele já podia
// lançar — os valores altos são os que se usa na prática (24x, 36x, 48x).
const PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24, 36, 48];

const KIND_HINT: Record<'diario' | 'saida' | 'entrada' | 'cartao', string> = {
  diario: 'gasto cotidiano (Pix, débito)',
  saida: 'despesa estrutural',
  entrada: 'dinheiro na conta',
  cartao: 'compra no crédito',
};

// Tela Lançar (SPEC.md §7): quatro modos — Diário, Saída, Entrada (lista de
// valores, issue #12) e Cartão (compra parcelada, issue #7). Diário/Saída/
// Entrada compartilham a mesma seção de lista-de-valores; só o `kind`
// gravado por linha muda.
export function renderLancar(app: HTMLDivElement, options: LancarOptions = {}): void {
  const { recovery, undo } = options;

  // Fim da fila (ou fotografia vazia): volta a Hoje com o saldo atualizado
  // em vez de mostrar "1 de 0".
  const date = recovery ? recovery.days[recovery.index] : todayBelem();
  if (date === undefined) {
    reset((el) => renderHoje(el, undo));
    return;
  }

  app.innerHTML = '';
  app.className = 'screen screen-lancar';

  let tipo: 'diario' | 'saida' | 'entrada' | 'cartao' = 'diario';
  const items: Item[] = [];
  const isLista = (t: typeof tipo): boolean => t !== 'cartao';

  // --- Topo: posição na fila -------------------------------------------

  const topo = document.createElement('div');
  topo.className = 'lancar-topo';

  if (recovery) {
    const posicaoEl = document.createElement('span');
    posicaoEl.className = 'lancar-posicao';
    posicaoEl.textContent = `${recovery.index + 1} de ${recovery.days.length}`;
    topo.append(posicaoEl);
  }

  // --- Contexto: que dia (ou que cartão) se está lançando ---------------

  // Data grande e explícita mesmo em recuperação: a posição diz onde o
  // usuário está na fila, mas o risco de erro da tela é justamente perder
  // de vista qual dia se está lançando (SPEC.md §7).
  const contexto = document.createElement('div');
  contexto.className = 'lancar-contexto';

  const dataBloco = document.createElement('div');
  dataBloco.className = 'lancar-data-bloco';

  const dataLabel = document.createElement('div');
  dataLabel.className = 'lancar-data-label';
  dataLabel.textContent = 'Lançando';

  const dateEl = document.createElement('h1');
  dateEl.className = 'lancar-date';
  dateEl.textContent = formatDateHeader(date);

  dataBloco.append(dataLabel, dateEl);

  // Em Cartão a data some do lugar de destaque porque o que decide a compra
  // é outro par: qual cartão e em quantas vezes. A data continua sendo a do
  // dia lançado, usada no insert e na previsão de vencimento.
  const cartaoPickers = document.createElement('div');
  cartaoPickers.className = 'cartao-pickers';

  let cards: Card[] = [];
  let cardIdx = 0;
  let parcelasIdx = 0;

  const cartaoPicker = criarPicker('Cartão', 'cartao-picker-nome');
  const parcelasPicker = criarPicker('Parcelas', 'cartao-picker-parcelas');
  cartaoPickers.append(cartaoPicker.botao, parcelasPicker.botao);

  contexto.append(dataBloco, cartaoPickers);

  // --- Lista de valores --------------------------------------------------

  const list = document.createElement('ol');
  list.className = 'lancar-lista';

  const listaArea = document.createElement('div');
  listaArea.className = 'lancar-lista-area';
  listaArea.append(list);

  // --- Total -------------------------------------------------------------

  const totalLinha = document.createElement('div');
  totalLinha.className = 'lancar-total-linha';

  const totalLabel = document.createElement('span');
  totalLabel.className = 'lancar-total-label';
  totalLabel.textContent = 'Adicionado';

  const totalValor = document.createElement('span');
  totalValor.className = 'lancar-total-valor';

  totalLinha.append(totalLabel, totalValor);

  // Espaçador depois do recibo (lista + total), não entre eles: em tela
  // alta a digitação fica na zona do polegar; a lista e o total continuam
  // juntos embaixo da data. Em Cartão a lista some, e sem alguém para
  // absorver a sobra o teclado subiria para o meio da tela.
  const espacador = document.createElement('div');
  espacador.className = 'lancar-espacador';

  // Consequência da compra parcelada, em âmbar como a simulação da Tela
  // Hoje: as duas dizem a mesma coisa — "isto ainda não aconteceu".
  const previewEl = document.createElement('p');
  previewEl.className = 'lancar-consequencia';

  // --- Campo de valor ----------------------------------------------------

  // Um campo só — trocar o tipo não pode apagar o que já está no teclado.
  // No modo lista, Adicionado é a soma já na lista; Digitando é o buffer
  // do numpad, repetido no botão Adicionar. Em Cartão o buffer some e o
  // valor vai para a linha do Total.
  const amount = createAmountField('Digitando');
  amount.input.classList.add('lancar-buffer');

  const bufferLabel = document.createElement('span');
  bufferLabel.className = 'lancar-buffer-label';
  bufferLabel.textContent = 'Digitando';

  const bufferRow = document.createElement('div');
  bufferRow.className = 'lancar-buffer-row';
  bufferRow.append(bufferLabel, amount.input);

  const renderTotal = (): void => {
    const total = isLista(tipo)
      ? items.reduce((sum, item) => sum + item.amountCents, 0n)
      : amount.cents();
    totalValor.textContent = `R$ ${formatAmount(total)}`;
  };

  const renderList = (): void => {
    list.innerHTML = '';
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'lancar-item';

      // Numeração de dois dígitos: dá à coluna uma largura fixa, então os
      // valores à direita continuam alinhados do item 1 ao 10.
      const n = document.createElement('span');
      n.className = 'item-numero';
      n.textContent = String(i + 1).padStart(2, '0');

      const amountSpan = document.createElement('span');
      amountSpan.className = 'item-valor';
      amountSpan.textContent = `R$ ${formatAmount(item.amountCents)}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'item-remover';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', `Remover ${formatAmount(item.amountCents)}`);
      removeBtn.addEventListener('click', () => {
        const idx = items.findIndex((i2) => i2.key === item.key);
        if (idx !== -1) items.splice(idx, 1);
        renderList();
      });

      li.append(n, amountSpan, removeBtn);
      list.append(li);
    });

    listaArea.hidden = items.length === 0;
    renderTotal();
    updateActions();
  };

  const commitItem = (): void => {
    const amountCents = amount.cents();
    if (amountCents <= 0n) return;
    items.push({ key: crypto.randomUUID(), amountCents });
    amount.clear();
    renderList();
  };

  // --- Ações: Adicionar / Salvar / Não gastei nada ----------------------

  // Uma ação óbvia por estágio: o valor digitado só vive no Adicionar;
  // Adicionado é a soma já na lista. Salvar auto-grava o buffer (caminho rápido
  // de um valor só). Não gastei nada só aparece com a lista e o buffer
  // vazios — senão seria uma saída que descarta o que já se digitou.
  const adicionarBtn = document.createElement('button');
  adicionarBtn.type = 'button';
  adicionarBtn.className = 'lancar-adicionar';
  adicionarBtn.addEventListener('click', commitItem);

  const salvarBtn = document.createElement('button');
  salvarBtn.type = 'button';
  salvarBtn.className = 'btn-salvar';
  salvarBtn.textContent = 'Salvar';

  const naoGasteiBtn = document.createElement('button');
  naoGasteiBtn.type = 'button';
  naoGasteiBtn.className = 'btn-nao-gastei';
  naoGasteiBtn.textContent = 'Não gastei nada';

  const errorEl = document.createElement('p');
  errorEl.className = 'lancar-erro';

  const updateActions = (): void => {
    const lista = isLista(tipo);
    const buffer = amount.cents();
    const temBuffer = buffer > 0n;
    const temItens = items.length > 0;

    adicionarBtn.hidden = !lista;
    adicionarBtn.disabled = !temBuffer;
    adicionarBtn.textContent = `+ Adicionar R$ ${formatAmount(buffer)}`;
    adicionarBtn.setAttribute(
      'aria-label',
      `Adicionar R$ ${formatAmount(buffer)} à lista`,
    );

    salvarBtn.disabled = lista ? !temItens && !temBuffer : !temBuffer;
    naoGasteiBtn.hidden = !lista || temItens || temBuffer;
    naoGasteiBtn.disabled = false;
    amount.input.classList.toggle('lancar-buffer-vazio', !temBuffer);
  };

  // --- Numpad ------------------------------------------------------------

  // Um teclado só para os quatro tipos: em Cartão o Adicionar some (a
  // compra é um valor, não uma lista) e o valor digitado aparece no Total.
  const numpad = createNumpad({
    onDigit: (digit) => {
      amount.addDigit(digit);
      if (isLista(tipo)) {
        updateActions();
      } else {
        renderTotal();
        updateActions();
        void updatePreview();
      }
    },
    onBackspace: () => {
      amount.backspace();
      if (isLista(tipo)) {
        updateActions();
      } else {
        renderTotal();
        updateActions();
        void updatePreview();
      }
    },
  });

  // --- Cartão: pickers e consequência ------------------------------------

  function criarPicker(label: string, valorClass: string): {
    botao: HTMLButtonElement;
    valorEl: HTMLElement;
  } {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'cartao-picker';

    const labelEl = document.createElement('span');
    labelEl.className = 'cartao-picker-label';
    labelEl.textContent = label;

    const valorEl = document.createElement('span');
    valorEl.className = `cartao-picker-valor ${valorClass}`;

    botao.append(labelEl, valorEl);
    return { botao, valorEl };
  }

  const renderPickers = (): void => {
    const card = cards[cardIdx];
    cartaoPicker.valorEl.textContent = card ? card.name : 'nenhum';
    parcelasPicker.valorEl.textContent = `${PARCELAS[parcelasIdx] as number}x`;
  };

  cartaoPicker.botao.addEventListener('click', () => {
    if (cards.length === 0) return;
    cardIdx = (cardIdx + 1) % cards.length;
    renderPickers();
    void updatePreview();
  });

  parcelasPicker.botao.addEventListener('click', () => {
    parcelasIdx = (parcelasIdx + 1) % PARCELAS.length;
    renderPickers();
    void updatePreview();
  });

  const updatePreview = debounce(async (): Promise<void> => {
    const card = cards[cardIdx];
    const installments = PARCELAS[parcelasIdx] as number;
    const amountCents = amount.cents();

    if (!card || amountCents <= 0n) {
      previewEl.textContent = '';
      return;
    }

    try {
      const db = await getDb();
      const rows = await previewInstallments(db, card.id, date, amountCents, installments);
      const first = rows[0];
      const last = rows[rows.length - 1];
      if (!first || !last) {
        previewEl.textContent = '';
        return;
      }
      const vencimento = formatDateSlash(first.due_date);
      if (installments === 1) {
        previewEl.textContent = `à vista — vence ${vencimento}`;
      } else if (first.amount_cents === last.amount_cents) {
        previewEl.textContent = `${installments}x de R$ ${formatAmount(first.amount_cents)} — primeira vence ${vencimento}`;
      } else {
        // O resto da divisão vai só na primeira parcela (SPEC.md §4), então
        // ela difere das demais em 1 centavo — dizer "Nx de R$X" aqui
        // afirmaria um valor uniforme que as outras parcelas não têm.
        previewEl.textContent =
          `${installments}x — primeira de R$ ${formatAmount(first.amount_cents)} (vence ${vencimento}), ` +
          `demais de R$ ${formatAmount(last.amount_cents)}`;
      }
    } catch (err) {
      previewEl.textContent = `Falha ao calcular: ${(err as Error).message}`;
    }
  }, 150);

  let cardsLoaded = false;
  const loadCardsOnce = async (): Promise<void> => {
    if (cardsLoaded) return;
    cartaoPicker.valorEl.textContent = 'carregando…';
    try {
      const db = await getDb();
      const carregados = (await listCards(db)).filter((c) => c.archived_at === null);
      // Only latch on success — a failed load (e.g. getDb() not ready yet)
      // must stay retryable on the next tap of the Cartão tab, not lock the
      // screen into a permanent "Falha ao carregar" with no way forward.
      cardsLoaded = true;
      cards = carregados;
      cardIdx = 0;
      renderPickers();
      void updatePreview();
    } catch (err) {
      cartaoPicker.valorEl.textContent = 'erro';
      errorEl.textContent = `Falha ao carregar cartões: ${(err as Error).message}`;
    }
  };

  // --- Tipo toggle -------------------------------------------------------

  const tipoToggle = document.createElement('div');
  tipoToggle.className = 'kind-toggle';

  const criarPill = (label: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    tipoToggle.append(btn);
    return btn;
  };

  const diarioBtn = criarPill('Diário');
  const saidaBtn = criarPill('Saída');
  const entradaBtn = criarPill('Entrada');
  const cartaoBtn = criarPill('Cartão');

  const kindHint = document.createElement('p');
  kindHint.className = 'lancar-kind-hint';

  const renderTipo = (): void => {
    const pills: [HTMLButtonElement, typeof tipo][] = [
      [diarioBtn, 'diario'],
      [saidaBtn, 'saida'],
      [entradaBtn, 'entrada'],
      [cartaoBtn, 'cartao'],
    ];
    for (const [btn, t] of pills) {
      btn.classList.toggle('kind-ativo', tipo === t);
      btn.setAttribute('aria-pressed', String(tipo === t));
    }

    const lista = isLista(tipo);
    dataBloco.hidden = !lista;
    cartaoPickers.hidden = lista;
    listaArea.hidden = !lista || items.length === 0;
    bufferRow.hidden = !lista;
    previewEl.hidden = lista;
    totalLabel.textContent = lista ? 'Adicionado' : 'Total';
    kindHint.textContent = KIND_HINT[tipo];
    errorEl.textContent = '';
    if (lista) previewEl.textContent = '';
    renderTotal();
    updateActions();
  };

  // O `kind` gravado é o da pill no Salvar, visível. Trocar de tipo no meio
  // da digitação é o fluxo de "digitei e só depois vi que era Saída" — o
  // teclado e a lista ainda não salva ficam.
  const selecionarLista = (novoTipo: 'diario' | 'saida' | 'entrada'): void => {
    tipo = novoTipo;
    renderTipo();
  };

  diarioBtn.addEventListener('click', () => selecionarLista('diario'));
  saidaBtn.addEventListener('click', () => selecionarLista('saida'));
  entradaBtn.addEventListener('click', () => selecionarLista('entrada'));
  cartaoBtn.addEventListener('click', () => {
    tipo = 'cartao';
    renderTipo();
    // Sair de Cartão apaga a linha de consequência (não cabe no modo lista).
    // Sem recalcular ao voltar, o Total já teria o valor e a preview não.
    void updatePreview();
    void loadCardsOnce();
  });

  // --- Footer ----------------------------------------------------------

  const footer = document.createElement('div');
  footer.className = 'tela-footer';

  // "Ambos avançam direto para o próximo dia pendente sem voltar à tela
  // inicial; quando acabam, retorna a Hoje com o saldo atualizado" (§7).
  const avancar = (saved?: UndoState): void => {
    if (recovery) {
      replace((el) =>
        renderLancar(el, {
          recovery: { days: recovery.days, index: recovery.index + 1 },
          undo: saved,
        }),
      );
    } else {
      reset((el) => renderHoje(el, saved));
    }
  };

  const lockSave = (): void => {
    salvarBtn.disabled = true;
    naoGasteiBtn.disabled = true;
    adicionarBtn.disabled = true;
  };

  const salvarLista = async (kind: 'diario' | 'saida' | 'entrada'): Promise<void> => {
    // A value typed but not yet added with "+" is still meant to be saved.
    commitItem();
    if (items.length === 0) return;

    lockSave();
    errorEl.textContent = '';
    try {
      const db = await getDb();
      const ids = await insertTransactions(
        db,
        date,
        kind,
        items.map((item) => ({ amountCents: item.amountCents })),
      );
      avancar({ ids, expiresAt: Date.now() + 5000 });
    } catch (err) {
      updateActions();
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  // Compra no cartão nunca toca o saldo (SPEC.md §3): só grava `purchase`.
  // pending_days só olha `transaction`, então o dia continua pendente até
  // um Diário real ser lançado nele — comportamento correto, não um bug a
  // esconder com um settleDay artificial aqui.
  const salvarCartao = async (): Promise<void> => {
    const card = cards[cardIdx];
    const installments = PARCELAS[parcelasIdx] as number;
    const amountCents = amount.cents();

    if (!card) {
      errorEl.textContent = 'Nenhum cartão cadastrado.';
      return;
    }
    if (amountCents <= 0n) {
      errorEl.textContent = 'Valor precisa ser maior que zero.';
      return;
    }

    lockSave();
    errorEl.textContent = '';
    try {
      const db = await getDb();
      const id = await insertPurchase(db, { cardId: card.id, date, amountCents, installments });
      avancar({ ids: [id], expiresAt: Date.now() + 5000, kind: 'purchase' });
    } catch (err) {
      updateActions();
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  const salvar = (): void => {
    void (tipo === 'cartao' ? salvarCartao() : salvarLista(tipo));
  };

  const naoGastei = async (): Promise<void> => {
    lockSave();
    errorEl.textContent = '';
    try {
      const db = await getDb();
      await settleDay(db, date);
      avancar();
    } catch (err) {
      updateActions();
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  salvarBtn.addEventListener('click', salvar);
  naoGasteiBtn.addEventListener('click', () => void naoGastei());

  footer.append(salvarBtn, naoGasteiBtn);

  app.append(
    topo,
    contexto,
    listaArea,
    totalLinha,
    previewEl,
    espacador,
    tipoToggle,
    kindHint,
    bufferRow,
    numpad.element,
    adicionarBtn,
    errorEl,
    footer,
  );

  renderPickers();
  renderList();
  renderTipo();
  amount.input.focus();

  // Desfazer o dia anterior da fila: apagar os lançamentos deixa aquele
  // dia pendente de novo, então a tela volta para ele.
  if (undo) {
    renderUndoToast(app, undo, () =>
      replace((el) =>
        renderLancar(el, recovery ? { recovery: { days: recovery.days, index: recovery.index - 1 } } : {}),
      ),
    );
  }
}
