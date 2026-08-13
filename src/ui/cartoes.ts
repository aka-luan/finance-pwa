import { getDb } from '../db';
import { archiveCard, createCard, listCards, todayBelem, updateCard, type Card } from '../db/queries.mjs';
import { back, push, replace } from './nav';

// Tela Cartões (issue #7): CRUD de closing_day/due_day, alcançável a
// partir de Configurações. installment/card_bill (schema.sql) já sabem
// calcular ciclo e vencimento a partir desses dois campos — esta tela só
// precisa gravá-los.
export function renderCartoes(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-cartoes';

  const title = document.createElement('h1');
  title.className = 'config-title';
  title.textContent = 'Cartões';

  const novoBtn = document.createElement('button');
  novoBtn.type = 'button';
  novoBtn.className = 'btn-bloco';
  novoBtn.textContent = 'Novo cartão';
  novoBtn.addEventListener('click', () => push((el) => renderCartaoForm(el)));

  const status = document.createElement('p');
  status.className = 'config-status';
  status.textContent = 'Carregando…';

  const list = document.createElement('ul');
  list.className = 'recorrencias-lista';

  const voltarBtn = document.createElement('button');
  voltarBtn.type = 'button';
  voltarBtn.className = 'btn-voltar';
  voltarBtn.textContent = 'Voltar';
  voltarBtn.addEventListener('click', () => back());

  app.append(title, novoBtn, status, list, voltarBtn);

  void loadCartoes(app, status, list);
}

async function loadCartoes(app: HTMLDivElement, status: HTMLElement, list: HTMLUListElement): Promise<void> {
  try {
    const db = await getDb();
    const cartoes = await listCards(db);

    list.innerHTML = '';
    if (cartoes.length === 0) {
      status.textContent = 'Nenhum cartão cadastrado.';
      return;
    }
    status.textContent = '';

    for (const cartao of cartoes) {
      list.append(renderItem(app, cartao, status));
    }
  } catch (err) {
    status.textContent = `Falha ao carregar: ${(err as Error).message}`;
  }
}

function renderItem(app: HTMLDivElement, cartao: Card, status: HTMLElement): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'recorrencia-item';
  const archived = cartao.archived_at !== null;
  if (archived) li.classList.add('recorrencia-inativa');

  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'recorrencia-info';
  if (!archived) {
    info.addEventListener('click', () => push((el) => renderCartaoForm(el, cartao)));
  } else {
    info.disabled = true;
  }

  const nomeEl = document.createElement('span');
  nomeEl.className = 'recorrencia-label';
  nomeEl.textContent = cartao.name;

  const detalheEl = document.createElement('span');
  detalheEl.className = 'recorrencia-detalhe';
  detalheEl.textContent =
    `fecha dia ${cartao.closing_day} · vence dia ${cartao.due_day}` + (archived ? ' · arquivado' : '');

  info.append(nomeEl, detalheEl);
  li.append(info);

  if (!archived) {
    const arquivarBtn = document.createElement('button');
    arquivarBtn.type = 'button';
    arquivarBtn.className = 'btn-destrutivo';
    arquivarBtn.textContent = 'Arquivar';
    arquivarBtn.addEventListener('click', () => {
      void (async () => {
        arquivarBtn.disabled = true;
        try {
          const db = await getDb();
          await archiveCard(db, cartao.id, todayBelem());
          replace(renderCartoes);
        } catch (err) {
          arquivarBtn.disabled = false;
          status.textContent = `Falha ao arquivar: ${(err as Error).message}`;
        }
      })();
    });
    li.append(arquivarBtn);
  }

  return li;
}

function renderCartaoForm(app: HTMLDivElement, existing?: Card): void {
  app.innerHTML = '';
  app.className = 'screen screen-cartao-form';

  const title = document.createElement('h1');
  title.className = 'acertar-titulo';
  title.textContent = existing ? 'Editar cartão' : 'Novo cartão';

  const nomeInput = document.createElement('input');
  nomeInput.type = 'text';
  nomeInput.className = 'recorrencia-label-input';
  nomeInput.placeholder = 'Nome do cartão';
  nomeInput.value = existing?.name ?? '';
  nomeInput.setAttribute('aria-label', 'Nome do cartão');

  const fechamentoLabel = document.createElement('label');
  fechamentoLabel.className = 'recorrencia-dia-label';
  fechamentoLabel.textContent = 'Dia do fechamento';

  const fechamentoInput = document.createElement('input');
  fechamentoInput.type = 'number';
  fechamentoInput.min = '1';
  fechamentoInput.max = '31';
  fechamentoInput.className = 'recorrencia-dia-input';
  fechamentoInput.value = String(existing?.closing_day ?? '');
  fechamentoLabel.append(fechamentoInput);

  const vencimentoLabel = document.createElement('label');
  vencimentoLabel.className = 'recorrencia-dia-label';
  vencimentoLabel.textContent = 'Dia do vencimento';

  const vencimentoInput = document.createElement('input');
  vencimentoInput.type = 'number';
  vencimentoInput.min = '1';
  vencimentoInput.max = '31';
  vencimentoInput.className = 'recorrencia-dia-input';
  vencimentoInput.value = String(existing?.due_day ?? '');
  vencimentoLabel.append(vencimentoInput);

  const errorEl = document.createElement('p');
  errorEl.className = 'lancar-erro';

  const footer = document.createElement('div');
  footer.className = 'tela-footer';

  const cancelarBtn = document.createElement('button');
  cancelarBtn.type = 'button';
  cancelarBtn.className = 'btn-secundario';
  cancelarBtn.textContent = 'Cancelar';
  cancelarBtn.addEventListener('click', () => back());

  const salvarBtn = document.createElement('button');
  salvarBtn.type = 'button';
  salvarBtn.className = 'btn-salvar';
  salvarBtn.textContent = 'Salvar';

  const salvar = async (): Promise<void> => {
    const name = nomeInput.value.trim();
    const closingDay = Number(fechamentoInput.value);
    const dueDay = Number(vencimentoInput.value);

    if (name === '') {
      errorEl.textContent = 'Nome não pode ficar em branco.';
      return;
    }
    if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) {
      errorEl.textContent = 'Dia do fechamento precisa estar entre 1 e 31.';
      return;
    }
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      errorEl.textContent = 'Dia do vencimento precisa estar entre 1 e 31.';
      return;
    }

    salvarBtn.disabled = true;
    cancelarBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const db = await getDb();
      if (existing) {
        await updateCard(db, existing.id, { name, closingDay, dueDay });
      } else {
        await createCard(db, { name, closingDay, dueDay });
      }
      back();
    } catch (err) {
      salvarBtn.disabled = false;
      cancelarBtn.disabled = false;
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  salvarBtn.addEventListener('click', () => void salvar());

  footer.append(cancelarBtn, salvarBtn);

  app.append(title, nomeInput, fechamentoLabel, vencimentoLabel, errorEl, footer);
}
