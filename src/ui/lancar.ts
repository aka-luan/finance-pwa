import { getDb } from '../db';
import { insertDiario, settleDay, todayBelem } from '../db/queries.mjs';
import { formatCents, formatDateHeader } from './format';
import { renderHoje } from './hoje';

interface Item {
  key: string;
  amountCents: bigint;
}

const MAX_DIGITS = 8; // up to R$ 999.999,99 — plenty for one Diário item

// Tela Lançar (SPEC.md §7), Diário only — Cartão mode, recorrências and
// dias-pendentes navigation are later tickets. Cents-first entry: every
// digit shifts into cents, so the value is always an integer and never
// needs a decimal-point parse step (resolves §11's open comma question).
export function renderLancar(app: HTMLDivElement): void {
  app.innerHTML = '';
  app.className = 'screen screen-lancar';

  const date = todayBelem();
  const items: Item[] = [];
  let digits = '';

  const dateEl = document.createElement('h1');
  dateEl.className = 'lancar-date';
  dateEl.textContent = formatDateHeader(date);

  // readonly suppresses iOS's native keyboard while still allowing focus,
  // so "focused on open" and "no native keyboard" aren't in tension.
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.readOnly = true;
  valueInput.inputMode = 'none';
  valueInput.className = 'valor-input';
  valueInput.setAttribute('aria-label', 'Valor');

  const list = document.createElement('ul');
  list.className = 'lancar-lista';

  const totalEl = document.createElement('p');
  totalEl.className = 'lancar-total';

  const currentDigitsCents = (): bigint => (digits === '' ? 0n : BigInt(digits));

  const renderValue = (): void => {
    valueInput.value = formatCents(currentDigitsCents());
  };

  const renderTotal = (): void => {
    const total = items.reduce((sum, item) => sum + item.amountCents, 0n);
    totalEl.textContent = `Total: ${formatCents(total)}`;
  };

  const renderList = (): void => {
    list.innerHTML = '';
    for (const item of items) {
      const li = document.createElement('li');

      const amountSpan = document.createElement('span');
      amountSpan.textContent = formatCents(item.amountCents);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'item-remover';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', 'Remover item');
      removeBtn.addEventListener('click', () => {
        const idx = items.findIndex((i) => i.key === item.key);
        if (idx !== -1) items.splice(idx, 1);
        renderList();
        renderTotal();
      });

      li.append(amountSpan, removeBtn);
      list.append(li);
    }
    renderTotal();
  };

  const addDigit = (d: string): void => {
    if (digits.length >= MAX_DIGITS) return;
    digits += d;
    renderValue();
  };

  const backspace = (): void => {
    digits = digits.slice(0, -1);
    renderValue();
  };

  const commitItem = (): void => {
    const amount = currentDigitsCents();
    if (amount <= 0n) return;
    items.push({ key: crypto.randomUUID(), amountCents: amount });
    digits = '';
    renderValue();
    renderList();
  };

  const numpad = document.createElement('div');
  numpad.className = 'numpad';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '+'];
  for (const key of keys) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = key === '+' ? 'numpad-key numpad-add' : 'numpad-key';
    btn.textContent = key;
    btn.addEventListener('click', () => {
      if (key === '⌫') backspace();
      else if (key === '+') commitItem();
      else addDigit(key);
    });
    numpad.append(btn);
  }

  const footer = document.createElement('div');
  footer.className = 'lancar-footer';

  const salvarBtn = document.createElement('button');
  salvarBtn.type = 'button';
  salvarBtn.className = 'btn-salvar';
  salvarBtn.textContent = 'Salvar';

  const naoGasteiBtn = document.createElement('button');
  naoGasteiBtn.type = 'button';
  naoGasteiBtn.className = 'btn-nao-gastei';
  naoGasteiBtn.textContent = 'Não gastei nada';

  const errorEl = document.createElement('p');
  errorEl.className = 'lancar-erro';

  const salvar = async (): Promise<void> => {
    // A value typed but not yet added with "+" is still meant to be saved.
    commitItem();
    if (items.length === 0) return;

    salvarBtn.disabled = true;
    naoGasteiBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const db = await getDb();
      const ids = await insertDiario(
        db,
        date,
        items.map((item) => ({ amountCents: item.amountCents })),
      );
      renderHoje(app, { ids, expiresAt: Date.now() + 5000 });
    } catch (err) {
      salvarBtn.disabled = false;
      naoGasteiBtn.disabled = false;
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  const naoGastei = async (): Promise<void> => {
    salvarBtn.disabled = true;
    naoGasteiBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const db = await getDb();
      await settleDay(db, date);
      renderHoje(app);
    } catch (err) {
      salvarBtn.disabled = false;
      naoGasteiBtn.disabled = false;
      errorEl.textContent = `Falha ao salvar: ${(err as Error).message}`;
    }
  };

  salvarBtn.addEventListener('click', () => void salvar());
  naoGasteiBtn.addEventListener('click', () => void naoGastei());

  footer.append(naoGasteiBtn, salvarBtn);

  app.append(dateEl, valueInput, list, totalEl, numpad, errorEl, footer);
  renderValue();
  renderTotal();
  valueInput.focus();
}
