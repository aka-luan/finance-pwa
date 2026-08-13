import { getDb } from '../db';
import { getTimeline, todayBelem, type TimelineDay } from '../db/queries.mjs';
import { formatCents, formatMonthName } from './format';
import { back } from './nav';

// Linha do tempo completa (issue #9, SPEC.md §6): "acesso secundário" fora
// da tela principal — os 12 meses dia a dia, o condensado que substitui
// rolar as colunas de mês da planilha antiga. Backed diretamente por
// timeline(), já validada em ~11ms para 12 meses contra 3 anos de histórico
// (SPEC.md §4).
export function renderLinhaDoTempo(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-linha-tempo';

  const title = document.createElement('h1');
  title.className = 'config-title';
  title.textContent = 'Linha do tempo';

  const status = document.createElement('p');
  status.className = 'config-status';
  status.textContent = 'Carregando…';

  const list = document.createElement('div');
  list.className = 'linha-tempo-lista';

  const voltarBtn = document.createElement('button');
  voltarBtn.type = 'button';
  voltarBtn.className = 'btn-voltar';
  voltarBtn.textContent = 'Voltar';
  voltarBtn.addEventListener('click', () => back());

  app.append(title, status, list, voltarBtn);

  void loadLinhaDoTempo(status, list);
}

async function loadLinhaDoTempo(status: HTMLElement, list: HTMLElement): Promise<void> {
  try {
    const db = await getDb();
    const dias = await getTimeline(db, todayBelem());
    status.textContent = '';
    renderDias(list, dias);
  } catch (err) {
    status.textContent = `Falha ao carregar: ${(err as Error).message}`;
  }
}

// Agrupado por mês — o "condensado" das colunas de mês da planilha antiga
// que a issue #9 pede. "Real vence projeção" já está resolvido dentro de
// timeline(); aqui só distinguimos visualmente pelo is_projection que ela
// devolve, sem duplicar a regra (SPEC.md §4).
function renderDias(container: HTMLElement, dias: TimelineDay[]): void {
  container.innerHTML = '';

  let mesAtual = '';
  let mesEl: HTMLUListElement | null = null;

  for (const dia of dias) {
    const mes = formatMonthName(dia.day, { withYear: true });
    if (mes !== mesAtual) {
      mesAtual = mes;

      const header = document.createElement('p');
      header.className = 'linha-tempo-mes';
      header.textContent = mes;

      mesEl = document.createElement('ul');
      mesEl.className = 'linha-tempo-dias';

      container.append(header, mesEl);
    }

    const item = document.createElement('li');
    item.className = 'linha-tempo-dia';
    if (dia.is_projection) item.classList.add('linha-tempo-projetado');

    const dataEl = document.createElement('span');
    dataEl.className = 'linha-tempo-data';
    dataEl.textContent = String(Number(dia.day.split('-')[2]));

    const saldoEl = document.createElement('span');
    saldoEl.className = 'linha-tempo-saldo';
    saldoEl.textContent = formatCents(dia.balance_cents);

    item.append(dataEl, saldoEl);
    mesEl?.append(item);
  }
}
