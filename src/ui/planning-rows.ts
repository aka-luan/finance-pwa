/**
 * Compact planning rows shared by the first-run wizard Fixos step and
 * the Planejamento screen. Amount + recurrence day stay inline; remove
 * lives behind •••.
 */

import { centsFirstMask } from './money-mask.mjs';
import { type FixedRow } from './wizard-planning-state';

export type MoneySign = 'plus' | 'minus' | 'none';

let dayPickerAbort: AbortController | null = null;

export function newFixedRow(): FixedRow {
  return { id: crypto.randomUUID(), name: 'Novo', cents: 0n, dayOfMonth: 1 };
}

export function sectionLabel(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'wizard-section';
  h.textContent = text;
  return h;
}

export function addFixedBtn(label: string, onClick: () => void): HTMLButtonElement {
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'wizard-add';
  add.textContent = label;
  add.addEventListener('click', onClick);
  return add;
}

export function moneyInput(
  cents: bigint,
  onCommit: (c: bigint) => void,
  sign: MoneySign = 'none',
): HTMLElement {
  const allowNegative = sign === 'none';
  const wrap = document.createElement('label');
  wrap.className = 'wizard-money';
  const prefix = document.createElement('span');
  prefix.textContent = sign === 'plus' ? '+R$' : sign === 'minus' ? '−R$' : 'R$';
  const input = document.createElement('input');
  input.inputMode = 'numeric';
  input.setAttribute('aria-label', 'Valor');
  input.placeholder = '0,00';
  const show = (value: bigint): void => {
    input.value = centsFirstMask(value === 0n ? '' : value.toString(), { allowNegative }).display;
  };
  show(cents);
  const read = (): bigint => {
    const masked = centsFirstMask(input.value, { allowNegative });
    input.value = masked.display;
    if (sign === 'none') return masked.cents;
    return masked.cents < 0n ? -masked.cents : masked.cents;
  };
  input.addEventListener('input', () => {
    read();
  });
  input.addEventListener('change', () => {
    onCommit(read());
  });
  wrap.append(prefix, input);
  return wrap;
}

export function withPreservedScroll(
  app: HTMLElement,
  selector: string,
  rebuild: () => void,
): void {
  const previous = app.querySelector(selector);
  const top = previous instanceof HTMLElement ? previous.scrollTop : 0;
  rebuild();
  const next = app.querySelector(selector);
  if (next instanceof HTMLElement) next.scrollTop = top;
}

export function closeFixedMenus(): void {
  document.querySelectorAll('.wizard-more-wrap').forEach((el) => {
    el.dispatchEvent(new Event('wizard-more-close'));
  });
}

export function moreMenu(onRemove: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wizard-more-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wizard-more';
  btn.textContent = '•••';
  btn.setAttribute('aria-label', 'Mais ações');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'wizard-more-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-destrutivo';
  remove.setAttribute('role', 'menuitem');
  remove.textContent = 'Remover';
  remove.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onRemove();
  });
  menu.append(remove);

  let onDoc: ((e: Event) => void) | null = null;
  let onKey: ((e: KeyboardEvent) => void) | null = null;

  const close = (): void => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (onDoc) document.removeEventListener('click', onDoc);
    if (onKey) document.removeEventListener('keydown', onKey);
    onDoc = null;
    onKey = null;
  };

  wrap.addEventListener('wizard-more-close', close);

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const willOpen = menu.hidden;
    closeFixedMenus();
    if (!willOpen) return;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    onDoc = (e: Event) => {
      if (wrap.contains(e.target as Node)) return;
      close();
    };
    onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    setTimeout(() => {
      if (onDoc) document.addEventListener('click', onDoc);
      if (onKey) document.addEventListener('keydown', onKey);
    }, 0);
  });

  wrap.append(btn, menu);
  return wrap;
}

export function openDayPicker(current: number, onPick: (day: number) => void): void {
  document.querySelector('.wizard-day-sheet-overlay')?.remove();
  dayPickerAbort?.abort();
  dayPickerAbort = new AbortController();
  const { signal } = dayPickerAbort;

  const overlay = document.createElement('div');
  overlay.className = 'wizard-day-sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'wizard-day-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Dia do mês');

  const title = document.createElement('p');
  title.className = 'wizard-day-sheet-title';
  title.textContent = 'Dia do mês';

  const grid = document.createElement('div');
  grid.className = 'wizard-day-sheet-grid';

  const close = (): void => {
    overlay.remove();
    dayPickerAbort?.abort();
    dayPickerAbort = null;
  };

  for (let d = 1; d <= 31; d++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.textContent = String(d);
    if (d === current) {
      cell.classList.add('is-selected');
      cell.setAttribute('aria-current', 'true');
    }
    cell.addEventListener('click', () => {
      close();
      onPick(d);
    });
    grid.append(cell);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') close();
    },
    { signal },
  );

  sheet.append(title, grid);
  overlay.append(sheet);
  document.body.append(overlay);
  sheet.querySelector<HTMLButtonElement>('.is-selected')?.focus();
}

export function compactRowList(
  rows: FixedRow[],
  onChange: (rows: FixedRow[]) => void,
  options: { sign?: MoneySign; withDay?: boolean } = {},
): HTMLElement {
  const sign = options.sign ?? 'none';
  const withDay = options.withDay ?? true;
  const list = document.createElement('div');
  list.className = 'wizard-list wizard-fixed-list';

  for (const rowData of rows) {
    const row = document.createElement('div');
    row.className = withDay ? 'wizard-fixed-card' : 'wizard-fixed-card wizard-fixed-card-noday';

    const name = document.createElement('input');
    name.className = 'wizard-name';
    name.value = rowData.name;
    name.setAttribute('aria-label', 'Nome');
    name.addEventListener('change', () => {
      onChange(
        rows.map((r) =>
          r.id === rowData.id ? { ...r, name: name.value.trim() || r.name } : r,
        ),
      );
    });

    const money = moneyInput(rowData.cents, (cents) => {
      onChange(rows.map((r) => (r.id === rowData.id ? { ...r, cents } : r)));
    }, sign);

    row.append(
      name,
      moreMenu(() => onChange(rows.filter((r) => r.id !== rowData.id))),
      money,
    );

    if (withDay) {
      const dayBtn = document.createElement('button');
      dayBtn.type = 'button';
      dayBtn.className = 'wizard-day-btn';
      dayBtn.textContent = `Dia ${rowData.dayOfMonth} ▾`;
      dayBtn.setAttribute('aria-label', `Dia do mês: ${rowData.dayOfMonth}`);
      dayBtn.setAttribute('aria-haspopup', 'dialog');
      dayBtn.addEventListener('click', () => {
        closeFixedMenus();
        openDayPicker(rowData.dayOfMonth, (dayOfMonth) => {
          onChange(rows.map((r) => (r.id === rowData.id ? { ...r, dayOfMonth } : r)));
        });
      });
      row.append(dayBtn);
    }

    list.append(row);
  }
  return list;
}

export function fixedRowList(
  rows: FixedRow[],
  onChange: (rows: FixedRow[]) => void,
  sign: MoneySign = 'none',
): HTMLElement {
  return compactRowList(rows, onChange, { sign, withDay: true });
}
