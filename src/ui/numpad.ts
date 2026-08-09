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
  // single value leave it out and the cell stays empty.
  onAdd?: () => void;
}

// Numpad próprio em HTML: `inputmode` nativo não entrega um `+` acessível
// e o teclado do sistema empurra o layout no iOS (SPEC.md §7).
export function createNumpad(handlers: NumpadHandlers): HTMLDivElement {
  const numpad = document.createElement('div');
  numpad.className = 'numpad';

  const addKey = (label: string, className: string, ariaLabel: string, onPress: () => void): void => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('click', onPress);
    numpad.append(btn);
  };

  for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    addKey(digit, 'numpad-key', digit, () => handlers.onDigit(digit));
  }
  addKey('⌫', 'numpad-key', 'Apagar', () => handlers.onBackspace());
  addKey('0', 'numpad-key', '0', () => handlers.onDigit('0'));
  if (handlers.onAdd) {
    const onAdd = handlers.onAdd;
    addKey('+', 'numpad-key numpad-add', 'Adicionar à lista', () => onAdd());
  }

  return numpad;
}
