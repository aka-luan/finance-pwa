import { getDb } from '../db';
import type { Backup } from '../db/backup.mjs';
import {
  exportBackup,
  findTablesOutsideBackup,
  importBackup,
  parseBackup,
  serializeBackup,
} from '../db/backup.mjs';
import { clearEstimateDismissals, todayBelem } from '../db/queries.mjs';
import { renderCartoes } from './cartoes';
import { formatTimestamp } from './format';
import { renderHoje } from './hoje';
import { renderRecorrencias } from './recorrencias';

// Tela Configurações, por ora só backup (SPEC.md §5). Manual export and
// restore, reachable without devtools — see docs/adr/0001-backup-json-manual.md
// for why manual and why JSON.
export function renderConfiguracoes(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-config';

  const title = document.createElement('h1');
  title.className = 'config-title';
  title.textContent = 'Configurações';

  const recorrenciasTitle = document.createElement('h2');
  recorrenciasTitle.className = 'config-secao';
  recorrenciasTitle.textContent = 'Recorrências';

  const recorrenciasBtn = document.createElement('button');
  recorrenciasBtn.type = 'button';
  recorrenciasBtn.className = 'btn-bloco';
  recorrenciasBtn.textContent = 'Gerenciar recorrências';
  recorrenciasBtn.addEventListener('click', () => renderRecorrencias(app));

  const cartoesTitle = document.createElement('h2');
  cartoesTitle.className = 'config-secao';
  cartoesTitle.textContent = 'Cartões';

  const cartoesBtn = document.createElement('button');
  cartoesBtn.type = 'button';
  cartoesBtn.className = 'btn-bloco';
  cartoesBtn.textContent = 'Gerenciar cartões';
  cartoesBtn.addEventListener('click', () => renderCartoes(app));

  const estimativaTitle = document.createElement('h2');
  estimativaTitle.className = 'config-secao';
  estimativaTitle.textContent = 'Estimativa diária';

  const revisarBtn = document.createElement('button');
  revisarBtn.type = 'button';
  revisarBtn.className = 'btn-bloco';
  revisarBtn.textContent = 'Rever estimativa';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'config-secao';
  sectionTitle.textContent = 'Backup';

  const explanation = document.createElement('p');
  explanation.className = 'config-explicacao';
  explanation.textContent =
    'Os dados ficam só neste aparelho e o navegador pode apagá-los quando faltar ' +
    'espaço. Exporte de vez em quando e guarde o arquivo em outro lugar.';

  const status = document.createElement('p');
  status.className = 'config-status';
  status.setAttribute('role', 'status');

  const confirmacao = document.createElement('div');
  confirmacao.className = 'config-confirmacao';

  const setStatus = (message: string, isError = false): void => {
    status.textContent = message;
    status.classList.toggle('config-status-erro', isError);
  };

  // Apaga as dispensas de todos os meses de uma vez, então pede confirmação
  // como a restauração de backup abaixo — a mesma lógica de blast radius.
  revisarBtn.addEventListener('click', () => {
    confirmacao.innerHTML = '';
    setStatus('');

    const question = document.createElement('p');
    question.textContent =
      'Isso apaga as dispensas de todos os meses e volta pra Hoje, onde a comparação roda de novo.';

    const cancelarBtn = document.createElement('button');
    cancelarBtn.type = 'button';
    cancelarBtn.className = 'btn-cancelar';
    cancelarBtn.textContent = 'Cancelar';
    cancelarBtn.addEventListener('click', () => {
      confirmacao.innerHTML = '';
    });

    const confirmarBtn = document.createElement('button');
    confirmarBtn.type = 'button';
    confirmarBtn.className = 'btn-confirmar';
    confirmarBtn.textContent = 'Rever';
    confirmarBtn.addEventListener('click', () => {
      void (async () => {
        confirmarBtn.disabled = true;
        cancelarBtn.disabled = true;
        try {
          const db = await getDb();
          await clearEstimateDismissals(db);
          renderHoje(app);
        } catch (err) {
          confirmarBtn.disabled = false;
          cancelarBtn.disabled = false;
          setStatus(`Falha ao rever a estimativa: ${(err as Error).message}`, true);
        }
      })();
    });

    const actions = document.createElement('div');
    actions.className = 'config-acoes';
    actions.append(cancelarBtn, confirmarBtn);
    confirmacao.append(question, actions);
  });

  const exportarBtn = document.createElement('button');
  exportarBtn.type = 'button';
  exportarBtn.className = 'btn-exportar';
  exportarBtn.textContent = 'Exportar backup';

  // Restoring starts by picking a file, and the browser's own picker is the
  // only way to read one. A real button driving a hidden input, rather than a
  // <label> wrapping it: the input has to be hidden, and a hidden input inside
  // a label can't be reached by keyboard at all.
  const restaurarBtn = document.createElement('button');
  restaurarBtn.type = 'button';
  restaurarBtn.className = 'btn-restaurar';
  restaurarBtn.textContent = 'Restaurar backup';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.className = 'config-file';
  restaurarBtn.addEventListener('click', () => fileInput.click());

  const voltarBtn = document.createElement('button');
  voltarBtn.type = 'button';
  voltarBtn.className = 'btn-voltar';
  voltarBtn.textContent = 'Voltar';
  voltarBtn.addEventListener('click', () => renderHoje(app));

  const exportar = async (): Promise<void> => {
    exportarBtn.disabled = true;
    confirmacao.innerHTML = '';
    setStatus('Preparando o arquivo…');
    try {
      const db = await getDb();
      const foraDoBackup = await findTablesOutsideBackup(db);
      const text = serializeBackup(await exportBackup(db));
      download(`termometro-${todayBelem()}.json`, text);

      // Where the file goes after this is the browser's business, so the
      // message says what actually happened — the file was generated — rather
      // than claiming a save this code can't observe.
      if (foraDoBackup.length > 0) {
        setStatus(
          `Arquivo gerado, mas sem estas tabelas: ${foraDoBackup.join(', ')}. ` +
            'Atualize o app antes de confiar neste backup.',
          true,
        );
      } else {
        setStatus('Arquivo gerado. Guarde-o fora do aparelho.');
      }
    } catch (err) {
      setStatus(`Falha ao exportar: ${(err as Error).message}`, true);
    } finally {
      exportarBtn.disabled = false;
    }
  };

  const escolherArquivo = async (): Promise<void> => {
    const file = fileInput.files?.[0];
    if (!file) return;
    confirmacao.innerHTML = '';
    setStatus('');
    try {
      // parseBackup validates fully before anything touches the database, so a
      // bad file costs nothing.
      renderConfirmacao(parseBackup(await file.text()));
    } catch (err) {
      setStatus(`Arquivo recusado: ${(err as Error).message}`, true);
    } finally {
      // Without this, picking the same file again after a cancel fires no
      // change event.
      fileInput.value = '';
    }
  };

  // Restoring replaces everything, so it asks first and says what it will do.
  const renderConfirmacao = (backup: Backup): void => {
    confirmacao.innerHTML = '';

    const total = Object.values(backup.tables).reduce((n, rows) => n + rows.length, 0);
    const question = document.createElement('p');
    question.textContent =
      `O arquivo tem ${total} ${total === 1 ? 'registro' : 'registros'}, ` +
      `de ${formatTimestamp(backup.exported_at)}. Restaurar apaga o que está ` +
      'neste aparelho e coloca o do arquivo no lugar.';

    const cancelarBtn = document.createElement('button');
    cancelarBtn.type = 'button';
    cancelarBtn.className = 'btn-cancelar';
    cancelarBtn.textContent = 'Cancelar';
    cancelarBtn.addEventListener('click', () => {
      confirmacao.innerHTML = '';
      setStatus('Restauração cancelada.');
    });

    const confirmarBtn = document.createElement('button');
    confirmarBtn.type = 'button';
    confirmarBtn.className = 'btn-confirmar';
    confirmarBtn.textContent = 'Restaurar';
    confirmarBtn.addEventListener('click', () => {
      void (async () => {
        confirmarBtn.disabled = true;
        cancelarBtn.disabled = true;
        setStatus('Restaurando…');
        try {
          const db = await getDb();
          await importBackup(db, backup);
          // Back to Hoje: the restored saldo on screen is the proof it worked.
          renderHoje(app);
        } catch (err) {
          confirmarBtn.disabled = false;
          cancelarBtn.disabled = false;
          setStatus(`Falha ao restaurar: ${(err as Error).message}`, true);
        }
      })();
    });

    const actions = document.createElement('div');
    actions.className = 'config-acoes';
    actions.append(cancelarBtn, confirmarBtn);
    confirmacao.append(question, actions);
  };

  exportarBtn.addEventListener('click', () => void exportar());
  fileInput.addEventListener('change', () => void escolherArquivo());

  app.append(
    title,
    recorrenciasTitle,
    recorrenciasBtn,
    cartoesTitle,
    cartoesBtn,
    estimativaTitle,
    revisarBtn,
    sectionTitle,
    explanation,
    exportarBtn,
    restaurarBtn,
    fileInput,
    status,
    confirmacao,
    voltarBtn,
  );
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;

  // Safari only follows a programmatic click on an anchor that is in the
  // document, and revoking in the same task can cancel the download it just
  // started — the next task is late enough.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
