import { getDb } from '../db';
import {
  getTimeline,
  getTimelineMovements,
  todayBelem,
  type TimelineDay,
  type TimelineMovement,
} from '../db/queries.mjs';
import {
  formatAmount,
  formatCents,
  formatDateSlash,
  formatMonthAbbrev,
  formatMonthYear,
  formatSignedAmount,
} from './format';
import { back } from './nav';
import {
  HORIZON_RANGES,
  buildHorizonMonths,
  daysInMonths,
  horizonSummary,
  lowestBalanceDay,
  monthKey,
  type HorizonMonth,
  type HorizonRange,
  type HorizonSummary,
} from './previsao-horizon.mjs';

// Previsão (issue #9, SPEC.md §6): "acesso secundário" fora da tela
// principal. O horizonte responde "onde o dinheiro vai estar"; a lista
// diária embaixo explica o porquê — sem virar a planilha de colunas.
export function renderPrevisao(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-previsao';

  const title = document.createElement('h1');
  title.className = 'config-title';
  title.textContent = 'Previsão';

  const status = document.createElement('p');
  status.className = 'config-status';
  status.textContent = 'Carregando…';

  const horizonte = document.createElement('section');
  horizonte.className = 'previsao-horizonte';
  horizonte.hidden = true;

  const list = document.createElement('div');
  list.className = 'previsao-lista';

  const voltarBtn = document.createElement('button');
  voltarBtn.type = 'button';
  voltarBtn.className = 'btn-voltar';
  voltarBtn.textContent = 'Voltar';
  voltarBtn.addEventListener('click', () => back());

  app.append(title, status, horizonte, list, voltarBtn);

  void loadPrevisao(status, horizonte, list);
}

async function loadPrevisao(status: HTMLElement, horizonte: HTMLElement, list: HTMLElement): Promise<void> {
  try {
    const db = await getDb();
    const today = todayBelem();
    const [dias, movements] = await Promise.all([
      getTimeline(db, today),
      getTimelineMovements(db, today),
    ]);
    status.textContent = '';
    status.hidden = true;
    mountPrevisao(horizonte, list, dias, movements, today);
  } catch (err) {
    status.hidden = false;
    status.textContent = `Falha ao carregar: ${(err as Error).message}`;
  }
}

function mountPrevisao(
  horizonte: HTMLElement,
  list: HTMLElement,
  dias: TimelineDay[],
  movements: TimelineMovement[],
  today: string,
): void {
  let range: HorizonRange = 12;
  let selectedKey: string | null = monthKey(today);
  let jumping = false;
  let jumpTimer = 0;

  const render = (): void => {
    const months = buildHorizonMonths(dias, range);
    const visiveis = daysInMonths(dias, months);
    if (selectedKey === null || !months.some((month) => month.key === selectedKey)) {
      selectedKey = months[0]?.key ?? null;
    }

    renderHorizonte(horizonte, months, visiveis, today, range, selectedKey, {
      onRange(next) {
        range = next;
        render();
      },
      onSelect(key) {
        selectedKey = key;
        markSelectedMonth(horizonte, key);
        jumping = true;
        window.clearTimeout(jumpTimer);
        scrollListaToMonth(list, key);
        scrollHorizonteToMonth(horizonte, key);
        jumpTimer = window.setTimeout(() => {
          jumping = false;
        }, 450);
      },
    });

    renderDias(list, visiveis, movements, today);
    if (selectedKey) {
      scrollListaToMonth(list, selectedKey, false);
      scrollHorizonteToMonth(horizonte, selectedKey, false);
    }
  };

  list.addEventListener(
    'scroll',
    () => {
      if (jumping) return;
      const key = monthFromScroll(list);
      if (key && key !== selectedKey) {
        selectedKey = key;
        markSelectedMonth(horizonte, key);
        scrollHorizonteToMonth(horizonte, key);
      }
    },
    { passive: true },
  );

  render();
}

function horizonMonthLabel(firstDay: string, today: string): string {
  const name = formatMonthAbbrev(firstDay);
  if (firstDay.slice(0, 4) === today.slice(0, 4)) return name;
  return `${name} ${firstDay.slice(2, 4)}`;
}

interface HorizonteHandlers {
  onRange(range: HorizonRange): void;
  onSelect(key: string): void;
}

function renderHorizonte(
  container: HTMLElement,
  months: HorizonMonth[],
  visiveis: TimelineDay[],
  today: string,
  range: HorizonRange,
  selectedKey: string | null,
  handlers: HorizonteHandlers,
): void {
  container.innerHTML = '';
  if (months.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const topo = document.createElement('div');
  topo.className = 'previsao-horizonte-topo';

  const label = document.createElement('p');
  label.className = 'previsao-horizonte-label';
  label.textContent = 'Horizonte';

  const periodos = document.createElement('div');
  periodos.className = 'previsao-horizonte-periodos';
  periodos.setAttribute('role', 'group');
  periodos.setAttribute('aria-label', 'Período');

  for (const monthsCount of HORIZON_RANGES) {
    if (periodos.childElementCount > 0) {
      const sep = document.createElement('span');
      sep.className = 'previsao-horizonte-periodo-sep';
      sep.textContent = '·';
      sep.setAttribute('aria-hidden', 'true');
      periodos.append(sep);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'previsao-horizonte-periodo';
    btn.textContent = `${monthsCount} meses`;
    btn.setAttribute('aria-pressed', String(monthsCount === range));
    if (monthsCount === range) btn.classList.add('is-ativo');
    btn.addEventListener('click', () => {
      if (monthsCount === range) return;
      handlers.onRange(monthsCount);
    });
    periodos.append(btn);
  }

  topo.append(label, periodos);

  const faixa = document.createElement('div');
  faixa.className = 'previsao-horizonte-meses';

  for (const month of months) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'previsao-horizonte-mes';
    btn.dataset.mes = month.key;
    if (month.key === selectedKey) btn.classList.add('is-selected');
    btn.setAttribute('aria-current', month.key === selectedKey ? 'true' : 'false');
    btn.setAttribute(
      'aria-label',
      `${formatMonthYear(month.firstDay)}, ${formatSignedAmount(month.endBalanceCents)}`,
    );

    const nome = document.createElement('span');
    nome.className = 'previsao-horizonte-nome';
    nome.textContent = horizonMonthLabel(month.firstDay, today);

    const valor = document.createElement('span');
    valor.className = 'previsao-horizonte-valor';
    valor.textContent = formatSignedAmount(month.endBalanceCents);
    valor.classList.toggle('valor-negativo', month.endBalanceCents < 0n);

    btn.append(nome, valor);
    btn.addEventListener('click', () => handlers.onSelect(month.key));
    faixa.append(btn);
  }

  container.append(topo, faixa);

  const summary = horizonSummary(visiveis);
  if (summary) {
    container.append(renderResumo(summary));
  }
}

function renderResumo(summary: HorizonSummary): HTMLElement {
  const resumo = document.createElement('p');
  resumo.className = 'previsao-horizonte-resumo';

  const saldoLabel = document.createElement('span');
  saldoLabel.className = 'previsao-horizonte-resumo-label';
  saldoLabel.textContent = 'saldo';

  const saldoValor = document.createElement('span');
  saldoValor.className = 'previsao-horizonte-resumo-valor';
  saldoValor.textContent = formatAmount(summary.currentBalanceCents);
  saldoValor.classList.toggle('valor-negativo', summary.currentBalanceCents < 0n);

  const sep = document.createElement('span');
  sep.className = 'previsao-horizonte-resumo-sep';
  sep.textContent = '·';

  const menorLabel = document.createElement('span');
  menorLabel.className = 'previsao-horizonte-resumo-label';
  menorLabel.textContent = 'menor';

  const menorValor = document.createElement('span');
  menorValor.className = 'previsao-horizonte-resumo-valor';
  menorValor.textContent = formatAmount(summary.lowestBalanceCents);
  menorValor.classList.toggle('valor-negativo', summary.lowestBalanceCents < 0n);

  const menorQuando = document.createElement('span');
  menorQuando.className = 'previsao-horizonte-resumo-quando';
  menorQuando.textContent = `em ${formatDateSlash(summary.lowestDay)}`;

  resumo.append(saldoLabel, saldoValor, sep, menorLabel, menorValor, menorQuando);
  return resumo;
}

function markSelectedMonth(horizonte: HTMLElement, key: string): void {
  for (const btn of horizonte.querySelectorAll<HTMLElement>('.previsao-horizonte-mes')) {
    const selected = btn.dataset.mes === key;
    btn.classList.toggle('is-selected', selected);
    btn.setAttribute('aria-current', selected ? 'true' : 'false');
  }
}

function scrollBehavior(smooth: boolean): ScrollBehavior {
  if (!smooth) return 'auto';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function scrollHorizonteToMonth(horizonte: HTMLElement, key: string, smooth = true): void {
  const faixa = horizonte.querySelector<HTMLElement>('.previsao-horizonte-meses');
  const btn = horizonte.querySelector<HTMLElement>(`.previsao-horizonte-mes[data-mes="${key}"]`);
  if (!faixa || !btn) return;
  const left =
    btn.getBoundingClientRect().left - faixa.getBoundingClientRect().left + faixa.scrollLeft - (faixa.clientWidth - btn.offsetWidth) / 2;
  faixa.scrollTo({ left: Math.max(0, left), behavior: scrollBehavior(smooth) });
}

function scrollListaToMonth(list: HTMLElement, key: string, smooth = true): void {
  const header = list.querySelector<HTMLElement>(`.previsao-mes[data-mes="${key}"]`);
  if (!header) return;
  const top = header.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  list.scrollTo({ top, behavior: scrollBehavior(smooth) });
}

function monthFromScroll(list: HTMLElement): string | null {
  const headers = [...list.querySelectorAll<HTMLElement>('.previsao-mes')];
  const top = list.getBoundingClientRect().top;
  let current = headers[0] ?? null;
  for (const header of headers) {
    if (header.getBoundingClientRect().top - top <= 12) current = header;
    else break;
  }
  return current?.dataset.mes ?? null;
}

function movementsByDay(movements: TimelineMovement[]): Map<string, TimelineMovement[]> {
  const map = new Map<string, TimelineMovement[]>();
  for (const movement of movements) {
    const dayList = map.get(movement.day) ?? [];
    dayList.push(movement);
    map.set(movement.day, dayList);
  }
  return map;
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
  const minDay = lowestBalanceDay(dias)?.day ?? null;
  let expanded: HTMLElement | null = null;

  let mesAtual = '';
  let mesEl: HTMLUListElement | null = null;

  for (const dia of dias) {
    const mes = formatMonthYear(dia.day);
    if (mes !== mesAtual) {
      mesAtual = mes;

      const header = document.createElement('p');
      header.className = 'previsao-mes';
      header.dataset.mes = monthKey(dia.day);
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
