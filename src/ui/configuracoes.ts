import { getDb } from '../db';
import type { Backup } from '../db/backup.mjs';
import { exportBackup, importBackup, parseBackup, serializeBackup } from '../db/backup.mjs';
import { todayBelem } from '../db/queries.mjs';
import { renderHoje } from './hoje';

// Tela Configurações, por ora só backup (SPEC.md §5). Manual export and
// restore, reachable without devtools — see docs/adr/0001-backup-json-manual.md
// for why manual and why JSON.
export function renderConfiguracoes(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-config';

  const title = document.createElement('h1');
  title.className = 'config-title';
  title.textContent = 'Configurações';

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

  const exportarBtn = document.createElement('button');
  exportarBtn.type = 'button';
  exportarBtn.className = 'btn-exportar';
  exportarBtn.textContent = 'Exportar backup';

  // A file input styled as a button: restoring starts by picking a file, and
  // the browser's own picker is the only way to read one.
  const restaurarLabel = document.createElement('label');
  restaurarLabel.className = 'btn-restaurar';
  restaurarLabel.textContent = 'Restaurar backup';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.className = 'config-file';
  restaurarLabel.append(fileInput);

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
      const text = serializeBackup(await exportBackup(db));
      download(`termometro-${todayBelem()}.json`, text);
      setStatus('Backup exportado.');
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
      `de ${formatExportedAt(backup.exported_at)}. Restaurar apaga o que está ` +
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
    sectionTitle,
    explanation,
    exportarBtn,
    restaurarLabel,
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

// exported_at is an ISO instant, not one of the schema's date strings, so it
// formats through Date directly.
function formatExportedAt(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'data desconhecida';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Belem',
  }).format(date);
}
