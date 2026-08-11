/**
 * PROTOTYPE entry for #15 — Definir a experiência do wizard de planejamento.
 * Open: /?prototype=wizard&variant=A  (also B, C)
 * Toggle mode: &mode=recalibrar | primeiro-uso
 */

import './prototype-wizard.css';
import { renderVariantA } from './prototype-wizard-a';
import { renderVariantB } from './prototype-wizard-b';
import { renderVariantC } from './prototype-wizard-c';
import {
  type WizardMode,
  type WizardState,
  seedState,
} from './prototype-wizard-state';
import {
  type VariantKey,
  currentVariant,
  mountPrototypeSwitcher,
} from './prototype-wizard-switcher';

function readMode(): WizardMode {
  const m = new URLSearchParams(location.search).get('mode');
  return m === 'recalibrar' ? 'recalibrar' : 'primeiro-uso';
}

export function renderPrototypeWizard(app: HTMLElement): void {
  let state: WizardState = seedState(readMode());
  let variant = currentVariant();

  const shell = document.createElement('div');
  shell.className = 'proto-shell';

  const toolbar = document.createElement('div');
  toolbar.className = 'proto-modebar';
  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'proto-mode-btn';
  const syncModeLabel = () => {
    modeBtn.textContent =
      state.mode === 'primeiro-uso'
        ? 'Modo: primeiro uso → (toque: recalibrar)'
        : 'Modo: recalibrar → (toque: primeiro uso)';
  };
  syncModeLabel();
  modeBtn.addEventListener('click', () => {
    const next: WizardMode = state.mode === 'primeiro-uso' ? 'recalibrar' : 'primeiro-uso';
    const url = new URL(location.href);
    url.searchParams.set('mode', next);
    history.replaceState(null, '', url);
    state = seedState(next);
    paint();
    syncModeLabel();
  });
  toolbar.append(modeBtn);

  const stage = document.createElement('div');
  stage.className = 'proto-stage';

  const setState = (next: WizardState) => {
    state = next;
    paint();
  };

  const paint = () => {
    stage.replaceChildren();
    if (variant === 'A') renderVariantA(stage, state, setState);
    else if (variant === 'B') renderVariantB(stage, state, setState);
    else renderVariantC(stage, state, setState);
  };

  const switcher = mountPrototypeSwitcher((key: VariantKey) => {
    variant = key;
    // Keep field values when flipping layout; reset step only for A.
    if (key === 'A') state = { ...state, step: 0 };
    paint();
  });

  shell.append(toolbar, stage);
  app.replaceChildren(shell, switcher);
  paint();
}
