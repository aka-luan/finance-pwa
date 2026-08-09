import { getDb } from '../db';
import { deleteTransactions, getHoje, todayBelem } from '../db/queries.mjs';
import { renderConfiguracoes } from './configuracoes';
import { formatCents } from './format';
import { renderLancar } from './lancar';

export interface UndoState {
  ids: string[];
  expiresAt: number;
}

// Tela Hoje (SPEC.md §6), scoped to this ticket: saldo em conta and quanto
// posso gastar hoje only. Marcos/pior-momento/simulação are ticket #6.
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

  // Discreet on purpose: the tela is built around the number at the top, and
  // backup is something the user does occasionally, not daily.
  const configBtn = document.createElement('button');
  configBtn.type = 'button';
  configBtn.className = 'btn-config';
  configBtn.textContent = 'Configurações';
  configBtn.addEventListener('click', () => renderConfiguracoes(app));

  app.append(podeGastarEl, saldoEl, lancarBtn, configBtn);

  if (undo && undo.expiresAt > Date.now()) {
    renderUndoToast(app, undo);
  }

  void loadHoje(podeGastarEl, saldoEl);
}

async function loadHoje(podeGastarEl: HTMLElement, saldoEl: HTMLElement): Promise<void> {
  try {
    const db = await getDb();
    const today = todayBelem();
    const { saldoCents, podeGastarCents } = await getHoje(db, today);

    podeGastarEl.textContent =
      podeGastarCents === null
        ? 'Sem estimativa diária ainda'
        : `Hoje você pode gastar ${formatCents(podeGastarCents)}`;
    saldoEl.textContent = `Saldo em conta: ${formatCents(saldoCents)}`;
  } catch (err) {
    podeGastarEl.textContent = `Falha ao carregar o saldo: ${(err as Error).message}`;
    saldoEl.textContent = '';
    throw err;
  }
}

function renderUndoToast(app: HTMLDivElement, undo: UndoState): void {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = 'Lançamento salvo. ';

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'btn-desfazer';
  undoBtn.textContent = 'Desfazer';
  undoBtn.addEventListener('click', () => {
    void (async () => {
      undoBtn.disabled = true;
      try {
        const db = await getDb();
        await deleteTransactions(db, undo.ids);
        renderHoje(app);
      } catch (err) {
        undoBtn.disabled = false;
        toast.textContent = `Falha ao desfazer: ${(err as Error).message}`;
        toast.append(undoBtn);
      }
    })();
  });

  toast.append(undoBtn);
  app.append(toast);

  setTimeout(() => toast.remove(), Math.max(undo.expiresAt - Date.now(), 0));
}
