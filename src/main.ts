import { registerSW } from 'virtual:pwa-register';
// Self-hosted em vez de um <link> para o Google Fonts: o app é um PWA que
// precisa abrir offline, e uma fonte buscada da rede no primeiro paint cai
// para a fonte de sistema justamente no caso que mais importa. Só o subset
// latin — cobre todo o pt-BR (ã, ç, ê, ó) e evita baixar cirílico/grego.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './style.css';
import { getDb } from './db';
import { needsFirstRun } from './db/queries.mjs';
import { renderHoje } from './ui/hoje';
import { mountNav, reset } from './ui/nav';
import { renderWizardPlanning } from './ui/wizard-planning';

registerSW({ immediate: true });

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  mountNav(app);
  // Shell paints immediately; gate resolves after PGlite boot (ADR 0003).
  // Never show a fake R$ 0,00 Hoje while waiting.
  app.className = 'screen screen-boot';
  app.textContent = '';

  void (async () => {
    try {
      const db = await getDb();
      if (await needsFirstRun(db)) {
        reset((el) => renderWizardPlanning(el, 'primeiro-uso'));
      } else {
        reset(renderHoje);
      }
    } catch (err) {
      app.className = 'screen screen-boot';
      app.textContent = `Falha ao iniciar: ${(err as Error).message}`;
    }
  })();
}
