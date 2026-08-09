import { getDb } from '../db';
import { getHoje, pendingDays, todayBelem } from '../db/queries.mjs';
import { renderAcertarSaldo } from './acertar-saldo';
import { renderConfiguracoes } from './configuracoes';
import { formatCents } from './format';
import { renderLancar } from './lancar';
import { renderUndoToast, type UndoState } from './undo';

// Tela Hoje (SPEC.md §6), scoped to this ticket: saldo em conta, quanto
// posso gastar hoje e o aviso de dias pendentes.
// Marcos/pior-momento/simulação are ticket #6.
export function renderHoje(app: HTMLDivElement, undo?: UndoState): void {
  app.innerHTML = '';
  app.className = 'screen screen-hoje';

  const podeGastarEl = document.createElement('p');
  podeGastarEl.className = 'pode-gastar';
  podeGastarEl.textContent = 'Carregando…';

  const saldoEl = document.createElement('p');
  saldoEl.className = 'saldo';

  const lancarBtn = document.createElement('button');
  lancarBtn.type = 'button';
  lancarBtn.className = 'btn-lancar';
  lancarBtn.textContent = 'Lançar';
  lancarBtn.addEventListener('click', () => renderLancar(app));

  const pendentesEl = document.createElement('div');
  pendentesEl.className = 'pendentes';

  // Discreet on purpose: the tela is built around the number at the top, and
  // backup is something the user does occasionally, not daily. Fica depois
  // do aviso de pendentes, que é o que pede ação hoje.
  const configBtn = document.createElement('button');
  configBtn.type = 'button';
  configBtn.className = 'btn-config';
  configBtn.textContent = 'Configurações';
  configBtn.addEventListener('click', () => renderConfiguracoes(app));

  app.append(podeGastarEl, saldoEl, lancarBtn, pendentesEl, configBtn);

  if (undo) {
    renderUndoToast(app, undo, () => renderHoje(app));
  }

  void loadHoje(app, podeGastarEl, saldoEl, pendentesEl);
}

async function loadHoje(
  app: HTMLDivElement,
  podeGastarEl: HTMLElement,
  saldoEl: HTMLElement,
  pendentesEl: HTMLElement,
): Promise<void> {
  try {
    const db = await getDb();
    const today = todayBelem();
    const { saldoCents, podeGastarCents } = await getHoje(db, today);
    const pendentes = await pendingDays(db, today);

    podeGastarEl.textContent =
      podeGastarCents === null
        ? 'Sem estimativa diária ainda'
        : `Hoje você pode gastar ${formatCents(podeGastarCents)}`;
    saldoEl.textContent = `Saldo em conta: ${formatCents(saldoCents)}`;

    if (pendentes.length > 0) {
      renderPendentes(app, pendentesEl, pendentes);
    }
  } catch (err) {
    podeGastarEl.textContent = `Falha ao carregar o saldo: ${(err as Error).message}`;
    saldoEl.textContent = '';
    throw err;
  }
}

// "Aviso de dias pendentes: discreto, tocável, leva ao modo de
// recuperação. Sem contador de ofensiva, sem vermelho de cobrança — se o
// app fizer o usuário se sentir devedor, ele para de abrir" (SPEC.md §6).
// Os dois caminhos de §8 ficam lado a lado: preencher em sequência é o
// aviso; acertar saldo é o outro, aqui e não escondido em configurações.
function renderPendentes(app: HTMLDivElement, container: HTMLElement, days: string[]): void {
  const aviso = document.createElement('button');
  aviso.type = 'button';
  aviso.className = 'pendentes-aviso';
  aviso.textContent = days.length === 1 ? '1 dia sem lançamento' : `${days.length} dias sem lançamento`;
  aviso.addEventListener('click', () => renderLancar(app, { recovery: { days, index: 0 } }));

  const acertar = document.createElement('button');
  acertar.type = 'button';
  acertar.className = 'pendentes-acertar';
  acertar.textContent = 'Acertar saldo';
  acertar.addEventListener('click', () => renderAcertarSaldo(app));

  container.append(aviso, acertar);
}
