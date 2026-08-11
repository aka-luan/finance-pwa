import { getDb } from '../db';
import { setAnchor, todayBelem } from '../db/queries.mjs';
import { renderHoje } from './hoje';
import { createAmountField, createNumpad } from './numpad';

// "Acertar saldo" (SPEC.md §8): o outro caminho legítimo para zerar dias
// pendentes. Grava um account_anchor com o valor real de hoje e o cálculo
// deixa de olhar atrás dele — o reequilíbrio manual da planilha, virado
// feature.
export function renderAcertarSaldo(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-acertar';

  const titleEl = document.createElement('h1');
  titleEl.className = 'acertar-titulo';
  titleEl.textContent = 'Acertar saldo';

  const hintEl = document.createElement('p');
  hintEl.className = 'acertar-hint';
  hintEl.textContent = 'Quanto o banco mostra agora?';

  const amount = createAmountField('Saldo em conta');

  const notaEl = document.createElement('p');
  notaEl.className = 'acertar-nota';
  notaEl.textContent = 'Os dias sem lançamento anteriores saem da lista.';

  const errorEl = document.createElement('p');
  errorEl.className = 'lancar-erro';

  const footer = document.createElement('div');
  footer.className = 'tela-footer';

  const voltarBtn = document.createElement('button');
  voltarBtn.type = 'button';
  voltarBtn.className = 'btn-secundario';
  voltarBtn.textContent = 'Voltar';
  voltarBtn.addEventListener('click', () => renderHoje(app));

  const salvarBtn = document.createElement('button');
  salvarBtn.type = 'button';
  salvarBtn.className = 'btn-salvar';
  salvarBtn.textContent = 'Salvar';
  // Sem dígito nenhum, "Salvar" gravaria um saldo zerado por engano.
  salvarBtn.disabled = true;

  const numpad = createNumpad({
    onDigit: (digit) => {
      amount.addDigit(digit);
      salvarBtn.disabled = amount.isEmpty();
    },
    onBackspace: () => {
      amount.backspace();
      salvarBtn.disabled = amount.isEmpty();
    },
  });

  const salvar = async (): Promise<void> => {
    salvarBtn.disabled = true;
    voltarBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const db = await getDb();
      await setAnchor(db, todayBelem(), amount.cents());
      renderHoje(app);
    } catch (err) {
      salvarBtn.disabled = false;
      voltarBtn.disabled = false;
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  salvarBtn.addEventListener('click', () => void salvar());

  footer.append(voltarBtn, salvarBtn);

  app.append(titleEl, hintEl, amount.input, notaEl, numpad.element, errorEl, footer);
  amount.input.focus();
}
