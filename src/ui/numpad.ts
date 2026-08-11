import { formatCents } from './format';

const MAX_DIGITS = 8; // up to R$ 999.999,99 — plenty for one value

export interface AmountField {
  input: HTMLInputElement;
  cents(): bigint;
  isEmpty(): boolean;
  addDigit(digit: string): void;
  backspace(): void;
  clear(): void;
  setCents(cents: bigint): void;
}

// Cents-first entry: every digit shifts into cents, so the value is always
// an integer and never needs a decimal-point parse step (resolves §11's
// open comma question). Shared by Lançar and Acertar saldo.
export function createAmountField(label: string): AmountField {
  let digits = '';

  // readonly suppresses iOS's native keyboard while still allowing focus,
  // so "focused on open" and "no native keyboard" aren't in tension.
  const input = document.createElement('input');
  input.type = 'text';
  input.readOnly = true;
  input.inputMode = 'none';
  input.className = 'valor-input';
  input.setAttribute('aria-label', label);

  const cents = (): bigint => (digits === '' ? 0n : BigInt(digits));
  const render = (): void => {
    input.value = formatCents(cents());
  };

  render();

  return {
    input,
    cents,
    isEmpty: () => digits === '',
    addDigit(digit) {
      if (digits.length >= MAX_DIGITS) return;
      digits += digit;
      render();
    },
    backspace() {
      digits = digits.slice(0, -1);
      render();
    },
    clear() {
      digits = '';
      render();
    },
    // Prefilling an already-stored value (e.g. opening a form to edit) is not
    // digit entry, so it bypasses MAX_DIGITS — the cap only exists to keep a
    // human from fat-fingering a huge amount on the numpad.
    setCents(cents) {
      digits = cents <= 0n ? '' : cents.toString();
      render();
    },
  };
}

export interface NumpadHandlers {
  onDigit(digit: string): void;
  onBackspace(): void;
  // The big add key, in the thumb zone (SPEC.md §7). Screens that take a
  // single value leave it out and get the plain 3-column keypad.
  onAdd?: () => void;
}

export interface Numpad {
  element: HTMLDivElement;
  // O valor sendo digitado mora dentro da tecla de adicionar, então quem
  // controla o AmountField precisa empurrar cada mudança para cá. No teclado
  // sem `onAdd` não há onde mostrar e a chamada não faz nada.
  setBuffer(text: string): void;
}

// Numpad próprio em HTML: `inputmode` nativo não entrega um `+` acessível
// e o teclado do sistema empurra o layout no iOS (SPEC.md §7).
export function createNumpad(handlers: NumpadHandlers): Numpad {
  const element = document.createElement('div');
  element.className = handlers.onAdd ? 'numpad numpad-com-adicionar' : 'numpad';

  const addKey = (label: string, ariaLabel: string, onPress: () => void): void => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'numpad-key';
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('click', onPress);
    element.append(btn);
  };

  for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    addKey(digit, digit, () => handlers.onDigit(digit));
  }
  // "00" antes do "0": valores redondos ("40,00", "1200,00") são a maioria do
  // que se lança num dia, e digitar cada zero é o que mais custa na entrada
  // cents-first. Dois addDigit em vez de um append de '00' para respeitar o
  // MAX_DIGITS de createAmountField no dígito, não no par.
  addKey('00', 'Dois zeros', () => {
    handlers.onDigit('0');
    handlers.onDigit('0');
  });
  addKey('0', '0', () => handlers.onDigit('0'));
  addKey('⌫', 'Apagar', () => handlers.onBackspace());

  if (!handlers.onAdd) {
    return { element, setBuffer: () => {} };
  }

  const onAdd = handlers.onAdd;

  // Uma célula só, ocupando as quatro linhas da quarta coluna: é a tecla de
  // maior alvo do teclado e fica sob o polegar. Mostra o valor digitado
  // porque, com a lista já ocupando o meio da tela, não há um campo de valor
  // separado — o buffer aparece aqui, dentro do botão que o consome.
  const adicionarBtn = document.createElement('button');
  adicionarBtn.type = 'button';
  adicionarBtn.className = 'numpad-adicionar';
  adicionarBtn.setAttribute('aria-label', 'Adicionar à lista');
  adicionarBtn.addEventListener('click', () => onAdd());

  const glifo = document.createElement('span');
  glifo.className = 'numpad-adicionar-glifo';
  glifo.textContent = '+';
  glifo.setAttribute('aria-hidden', 'true');

  const bufferEl = document.createElement('span');
  bufferEl.className = 'numpad-adicionar-buffer';

  const legenda = document.createElement('span');
  legenda.className = 'numpad-adicionar-legenda';
  legenda.textContent = 'adicionar';

  adicionarBtn.append(glifo, bufferEl, legenda);
  element.append(adicionarBtn);

  return {
    element,
    setBuffer(text) {
      bufferEl.textContent = text;
    },
  };
}
