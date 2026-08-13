import { getDb } from '../db';
import {
  createRecurrence,
  deactivateRecurrence,
  listRecurrences,
  todayBelem,
  updateRecurrence,
  type Recurrence,
} from '../db/queries.mjs';
import { formatCents } from './format';
import { back, push, replace } from './nav';
import { createAmountField, createNumpad } from './numpad';

// Tela Recorrências (issue #5): CRUD de entrada/saída em dia fixo do mês,
// alcançável a partir de Configurações. A regra "real vence projeção" já
// está implementada no timeline/balance_on de schema.sql — esta tela só
// precisa gravar a recorrência corretamente para que ela entre em vigor.
export function renderRecorrencias(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-recorrencias';

  const title = document.createElement('h1');
  title.className = 'config-title';
  title.textContent = 'Recorrências';

  const novaBtn = document.createElement('button');
  novaBtn.type = 'button';
  novaBtn.className = 'btn-bloco';
  novaBtn.textContent = 'Nova recorrência';
  novaBtn.addEventListener('click', () => push((el) => renderRecorrenciaForm(el)));

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

  app.append(title, novaBtn, status, list, voltarBtn);

  void loadRecorrencias(app, status, list);
}

async function loadRecorrencias(
  app: HTMLDivElement,
  status: HTMLElement,
  list: HTMLUListElement,
): Promise<void> {
  try {
    const db = await getDb();
    const recorrencias = await listRecurrences(db, todayBelem());

    list.innerHTML = '';
    if (recorrencias.length === 0) {
      status.textContent = 'Nenhuma recorrência cadastrada.';
      return;
    }
    status.textContent = '';

    for (const rec of recorrencias) {
      list.append(renderItem(app, rec, status));
    }
  } catch (err) {
    status.textContent = `Falha ao carregar: ${(err as Error).message}`;
  }
}

function renderItem(app: HTMLDivElement, rec: Recurrence, status: HTMLElement): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'recorrencia-item';
  if (!rec.active) li.classList.add('recorrencia-inativa');

  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'recorrencia-info';
  // Editar uma recorrência inativa não teria efeito nenhum: updateRecurrence
  // não mexe em end_date, então o registro voltaria pra tela ainda inativa.
  // Reativar não é escopo deste ticket, então o clique fica desligado.
  if (rec.active) {
    info.addEventListener('click', () => push((el) => renderRecorrenciaForm(el, rec)));
  } else {
    info.disabled = true;
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'recorrencia-label';
  labelEl.textContent = rec.label;

  const detalheEl = document.createElement('span');
  detalheEl.className = 'recorrencia-detalhe';
  const kindLabel = rec.kind === 'entrada' ? 'Entrada' : 'Saída';
  const sinal = rec.kind === 'entrada' ? '' : '-';
  detalheEl.textContent =
    `${kindLabel} · dia ${rec.day_of_month} · ${sinal}${formatCents(rec.amount_cents)}` +
    (rec.active ? '' : ' · inativa');

  info.append(labelEl, detalheEl);
  li.append(info);

  if (rec.active) {
    const desativarBtn = document.createElement('button');
    desativarBtn.type = 'button';
    desativarBtn.className = 'btn-destrutivo';
    desativarBtn.textContent = 'Desativar';
    desativarBtn.addEventListener('click', () => {
      void (async () => {
        desativarBtn.disabled = true;
        try {
          const db = await getDb();
          await deactivateRecurrence(db, rec.id, todayBelem());
          replace(renderRecorrencias);
        } catch (err) {
          desativarBtn.disabled = false;
          status.textContent = `Falha ao desativar: ${(err as Error).message}`;
        }
      })();
    });
    li.append(desativarBtn);
  }

  return li;
}

// Formulário de criar/editar. dayOfMonth e label são inputs simples; o
// valor reusa o mesmo par createAmountField/createNumpad de Lançar e
// Acertar saldo — é o mesmo controle de dinheiro em toda a tela.
function renderRecorrenciaForm(app: HTMLDivElement, existing?: Recurrence): void {
  app.innerHTML = '';
  app.className = 'screen screen-recorrencia-form';

  let kind: 'entrada' | 'saida' = existing?.kind ?? 'saida';

  const title = document.createElement('h1');
  title.className = 'acertar-titulo';
  title.textContent = existing ? 'Editar recorrência' : 'Nova recorrência';

  const kindToggle = document.createElement('div');
  kindToggle.className = 'kind-toggle';

  const entradaBtn = document.createElement('button');
  entradaBtn.type = 'button';
  entradaBtn.textContent = 'Entrada';

  const saidaBtn = document.createElement('button');
  saidaBtn.type = 'button';
  saidaBtn.textContent = 'Saída';

  const renderKind = (): void => {
    entradaBtn.classList.toggle('kind-ativo', kind === 'entrada');
    saidaBtn.classList.toggle('kind-ativo', kind === 'saida');
    entradaBtn.setAttribute('aria-pressed', String(kind === 'entrada'));
    saidaBtn.setAttribute('aria-pressed', String(kind === 'saida'));
  };
  entradaBtn.addEventListener('click', () => {
    kind = 'entrada';
    renderKind();
  });
  saidaBtn.addEventListener('click', () => {
    kind = 'saida';
    renderKind();
  });
  renderKind();

  kindToggle.append(entradaBtn, saidaBtn);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'recorrencia-label-input';
  labelInput.placeholder = 'Descrição';
  labelInput.value = existing?.label ?? '';
  labelInput.setAttribute('aria-label', 'Descrição');

  const diaLabel = document.createElement('label');
  diaLabel.className = 'recorrencia-dia-label';
  diaLabel.textContent = 'Dia do mês';

  const diaInput = document.createElement('input');
  diaInput.type = 'number';
  diaInput.min = '1';
  diaInput.max = '31';
  diaInput.className = 'recorrencia-dia-input';
  diaInput.value = String(existing?.day_of_month ?? '');
  diaLabel.append(diaInput);

  const amount = createAmountField('Valor');
  if (existing) {
    amount.setCents(existing.amount_cents);
  }

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
    const dayOfMonth = Number(diaInput.value);
    const label = labelInput.value.trim();
    const amountCents = amount.cents();

    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      errorEl.textContent = 'Dia do mês precisa estar entre 1 e 31.';
      return;
    }
    if (label === '') {
      errorEl.textContent = 'Descrição não pode ficar em branco.';
      return;
    }
    if (amountCents <= 0n) {
      errorEl.textContent = 'Valor precisa ser maior que zero.';
      return;
    }

    salvarBtn.disabled = true;
    cancelarBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const db = await getDb();
      if (existing) {
        await updateRecurrence(db, existing.id, { kind, dayOfMonth, amountCents, label });
      } else {
        await createRecurrence(db, { kind, dayOfMonth, amountCents, label, startDate: todayBelem() });
      }
      back();
    } catch (err) {
      salvarBtn.disabled = false;
      cancelarBtn.disabled = false;
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  salvarBtn.addEventListener('click', () => void salvar());

  const numpad = createNumpad({
    onDigit: (digit) => amount.addDigit(digit),
    onBackspace: () => amount.backspace(),
  });

  footer.append(cancelarBtn, salvarBtn);

  app.append(title, kindToggle, labelInput, diaLabel, amount.input, numpad.element, errorEl, footer);
}
