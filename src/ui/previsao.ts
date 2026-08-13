import { getDb } from '../db';
import {
  getTimeline,
  getTimelineMovements,
  todayBelem,
  type TimelineDay,
  type TimelineMovement,
} from '../db/queries.mjs';
import { formatAmount, formatCents, formatMonthYear } from './format';
import { back } from './nav';

// Previsão (issue #9, SPEC.md §6): "acesso secundário" fora da tela
// principal — os 12 meses dia a dia, o condensado que substitui rolar as
// colunas de mês da planilha antiga. Saldos vêm de timeline(); as causas
// nomeadas, de timeline_movements(), que espelha os mesmos filtros.
export function renderPrevisao(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-previsao';

  const title = document.createElement('h1');
  title.className = 'config-title';
  title.textContent = 'Previsão';

  const status = document.createElement('p');
  status.className = 'config-status';
  status.textContent = 'Carregando…';

  const list = document.createElement('div');
  list.className = 'previsao-lista';

  const voltarBtn = document.createElement('button');
  voltarBtn.type = 'button';
  voltarBtn.className = 'btn-voltar';
  voltarBtn.textContent = 'Voltar';
  voltarBtn.addEventListener('click', () => back());

  app.append(title, status, list, voltarBtn);

  void loadPrevisao(status, list);
}

async function loadPrevisao(status: HTMLElement, list: HTMLElement): Promise<void> {
  try {
    const db = await getDb();
    const today = todayBelem();
    const [dias, movements] = await Promise.all([
      getTimeline(db, today),
      getTimelineMovements(db, today),
    ]);
    status.textContent = '';
    status.hidden = true;
    renderDias(list, dias, movements, today);
  } catch (err) {
    status.hidden = false;
    status.textContent = `Falha ao carregar: ${(err as Error).message}`;
  }
}

function movementsByDay(movements: TimelineMovement[]): Map<string, TimelineMovement[]> {
  const map = new Map<string, TimelineMovement[]>();
  for (const movement of movements) {
    const list = map.get(movement.day) ?? [];
    list.push(movement);
    map.set(movement.day, list);
  }
  return map;
}

// Mesmo desempate de worst_point(): menor saldo, dia mais cedo.
function lowestBalanceDay(dias: TimelineDay[]): string | null {
  const first = dias[0];
  if (!first) return null;
  let best = first;
  for (const dia of dias) {
    if (dia.balance_cents < best.balance_cents) best = dia;
  }
  return best.day;
}

function isEventDay(movements: TimelineMovement[]): boolean {
  return movements.some((m) => m.source !== 'diario');
}

function orderedMovements(movements: TimelineMovement[]): TimelineMovement[] {
  const events = movements.filter((m) => m.source !== 'diario');
  const diario = movements.filter((m) => m.source === 'diario');
  return [...events, ...diario];
}

function formatSignedCents(cents: bigint): string {
  if (cents > 0n) return `+${formatCents(cents)}`;
  return formatCents(cents);
}

function movementHint(source: TimelineMovement['source']): string {
  return source === 'transaction' ? 'lançado' : 'projeção';
}

function collapseRow(item: HTMLElement): void {
  const btn = item.querySelector<HTMLButtonElement>('.previsao-dia-btn');
  const detalhe = item.querySelector<HTMLElement>('.previsao-detalhe');
  btn?.setAttribute('aria-expanded', 'false');
  if (detalhe) detalhe.hidden = true;
}

function renderDias(
  container: HTMLElement,
  dias: TimelineDay[],
  movements: TimelineMovement[],
  today: string,
): void {
  container.innerHTML = '';

  const byDay = movementsByDay(movements);
  const minDay = lowestBalanceDay(dias);
  let expanded: HTMLElement | null = null;

  let mesAtual = '';
  let mesEl: HTMLUListElement | null = null;

  for (const dia of dias) {
    const mes = formatMonthYear(dia.day);
    if (mes !== mesAtual) {
      mesAtual = mes;

      const header = document.createElement('p');
      header.className = 'previsao-mes';
      header.textContent = mes;

      mesEl = document.createElement('ul');
      mesEl.className = 'previsao-dias';

      container.append(header, mesEl);
    }

    const dayMovements = byDay.get(dia.day) ?? [];
    const event = isEventDay(dayMovements);
    const isToday = dia.day === today;
    const isMin = dia.day === minDay;

    const item = document.createElement('li');
    item.className = event ? 'previsao-dia previsao-evento' : 'previsao-dia previsao-quieto';
    if (isToday) item.classList.add('previsao-hoje');
    if (isMin) item.classList.add('previsao-min');

    const dataEl = document.createElement('span');
    dataEl.className = 'previsao-data';
    dataEl.textContent = String(Number(dia.day.split('-')[2]));
    if (isToday || isMin) {
      const marca = document.createElement('span');
      marca.className = 'previsao-marca';
      marca.textContent = isToday && isMin ? 'hoje · mín.' : isToday ? 'hoje' : 'mín.';
      dataEl.append(marca);
    }

    const saldoEl = document.createElement('span');
    saldoEl.className = 'previsao-saldo';
    saldoEl.textContent = formatCents(dia.balance_cents);
    saldoEl.classList.toggle('valor-negativo', dia.balance_cents < 0n);

    if (!event) {
      item.append(dataEl, saldoEl);
      mesEl?.append(item);
      continue;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'previsao-dia-btn';
    btn.setAttribute('aria-expanded', 'false');

    btn.append(dataEl);

    for (const movement of orderedMovements(dayMovements)) {
      const mov = document.createElement('span');
      mov.className = 'previsao-mov';
      if (movement.source === 'diario') mov.classList.add('previsao-mov-diario');

      const label = document.createElement('span');
      label.className = 'previsao-mov-label';
      label.textContent = movement.label;

      const valor = document.createElement('span');
      valor.className = 'previsao-mov-valor';
      valor.textContent =
        movement.source === 'diario' ? formatAmount(movement.signed_cents) : formatSignedCents(movement.signed_cents);

      mov.append(label, valor);
      btn.append(mov);
    }

    btn.append(saldoEl);

    const detalhe = document.createElement('div');
    detalhe.className = 'previsao-detalhe';
    detalhe.hidden = true;

    for (const movement of orderedMovements(dayMovements)) {
      const linha = document.createElement('div');
      linha.className = 'previsao-detalhe-linha';

      const label = document.createElement('span');
      label.className = 'previsao-detalhe-label';
      label.textContent = `${movement.label} · ${movementHint(movement.source)}`;

      const valor = document.createElement('span');
      valor.className = 'previsao-detalhe-valor';
      valor.textContent =
        movement.source === 'diario' ? formatAmount(movement.signed_cents) : formatSignedCents(movement.signed_cents);

      linha.append(label, valor);
      detalhe.append(linha);
    }

    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (expanded && expanded !== item) collapseRow(expanded);
      if (open) {
        collapseRow(item);
        expanded = null;
        return;
      }
      btn.setAttribute('aria-expanded', 'true');
      detalhe.hidden = false;
      expanded = item;
    });

    item.append(btn, detalhe);
    mesEl?.append(item);
  }
}
