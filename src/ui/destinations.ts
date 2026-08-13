import type { Paint } from './nav';
import { push, replace, reset } from './nav';

/**
 * The three informational surfaces of the forecast. Termômetro is home;
 * Previsão and Planejamento are siblings reached from it (push) or from
 * each other (replace), so they don't stack. Lançar stays a transactional
 * action on Termômetro, not a fourth analytics destination.
 */
export type ForecastSurface = 'termometro' | 'previsao' | 'planejamento';

const SURFACES: { id: ForecastSurface; label: string }[] = [
  { id: 'termometro', label: 'Termômetro' },
  { id: 'previsao', label: 'Previsão' },
  { id: 'planejamento', label: 'Planejamento' },
];

export function goToForecastSurface(from: ForecastSurface, to: ForecastSurface): void {
  if (from === to) return;
  if (to === 'termometro') {
    void import('./hoje').then(({ renderHoje }) => reset(renderHoje));
    return;
  }
  const apply = (paint: Paint): void => {
    if (from === 'termometro') push(paint);
    else replace(paint);
  };
  if (to === 'previsao') {
    void import('./previsao').then(({ renderPrevisao }) => apply(renderPrevisao));
    return;
  }
  void import('./planejamento').then(({ renderPlanejamento }) => apply(renderPlanejamento));
}

export function renderForecastNav(
  from: ForecastSurface,
  extra?: { label: string; onClick: () => void }[],
): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = from === 'termometro' ? 'hoje-secundario' : 'forecast-nav';
  nav.setAttribute('aria-label', 'Previsão');

  for (const item of SURFACES) {
    if (item.id === from) continue;
    nav.append(textLink(item.label, () => goToForecastSurface(from, item.id)));
  }
  for (const item of extra ?? []) {
    nav.append(textLink(item.label, item.onClick));
  }
  return nav;
}

function textLink(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-config';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
