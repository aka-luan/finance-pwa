import { getDb } from '../db';
import { deletePurchase, deleteTransactions } from '../db/queries.mjs';

export interface UndoState {
  ids: string[];
  expiresAt: number;
  // Defaults to 'transaction' — the only kind before Cartão (issue #7)
  // added a second table a save can undo.
  kind?: 'transaction' | 'purchase';
}

// "Desfazer disponível por alguns segundos após salvar. Lançamento rápido
// só é seguro se errar for barato" (SPEC.md §7). Lives outside the screens
// because in recovery mode the toast follows the flow to the next pending
// day instead of to Hoje — `onUndone` is where each screen goes back to.
export function renderUndoToast(app: HTMLDivElement, undo: UndoState, onUndone: () => void): void {
  const remaining = undo.expiresAt - Date.now();
  if (remaining <= 0) return;

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
        if (undo.kind === 'purchase') {
          await Promise.all(undo.ids.map((id) => deletePurchase(db, id)));
        } else {
          await deleteTransactions(db, undo.ids);
        }
        onUndone();
      } catch (err) {
        undoBtn.disabled = false;
        toast.textContent = `Falha ao desfazer: ${(err as Error).message}`;
        toast.append(undoBtn);
      }
    })();
  });

  toast.append(undoBtn);
  app.append(toast);

  setTimeout(() => toast.remove(), remaining);
}
