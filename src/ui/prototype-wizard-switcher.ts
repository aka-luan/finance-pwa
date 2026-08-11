/**
 * PROTOTYPE switcher bar — not part of product UI.
 * Hidden when import.meta.env.PROD.
 */

const KEYS = ['A', 'B', 'C'] as const;
export type VariantKey = (typeof KEYS)[number];

export const VARIANT_NAMES: Record<VariantKey, string> = {
  A: 'Passos (um por tela)',
  B: 'Folha única + resumo fixo',
  C: 'Comparar → ajustar',
};

export function currentVariant(): VariantKey {
  const v = new URLSearchParams(location.search).get('variant')?.toUpperCase();
  return KEYS.includes(v as VariantKey) ? (v as VariantKey) : 'A';
}

export function setVariant(key: VariantKey): void {
  const url = new URL(location.href);
  url.searchParams.set('prototype', 'wizard');
  url.searchParams.set('variant', key);
  history.replaceState(null, '', url);
}

export function cycleVariant(delta: number): VariantKey {
  const i = KEYS.indexOf(currentVariant());
  const next = KEYS[(i + delta + KEYS.length) % KEYS.length]!;
  setVariant(next);
  return next;
}

export function mountPrototypeSwitcher(onChange: (key: VariantKey) => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'proto-switcher';
  bar.setAttribute('role', 'navigation');
  bar.setAttribute('aria-label', 'Trocar variante do protótipo');

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = '←';
  prev.className = 'proto-switcher-btn';

  const label = document.createElement('span');
  label.className = 'proto-switcher-label';

  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = '→';
  next.className = 'proto-switcher-btn';

  const sync = () => {
    const key = currentVariant();
    label.textContent = `${key} — ${VARIANT_NAMES[key]}`;
  };
  sync();

  prev.addEventListener('click', () => {
    onChange(cycleVariant(-1));
    sync();
  });
  next.addEventListener('click', () => {
    onChange(cycleVariant(1));
    sync();
  });

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(cycleVariant(-1));
      sync();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(cycleVariant(1));
      sync();
    }
  };
  window.addEventListener('keydown', onKey);

  bar.append(prev, label, next);
  (bar as HTMLElement & { disconnect?: () => void }).disconnect = () => {
    window.removeEventListener('keydown', onKey);
  };
  return bar;
}
