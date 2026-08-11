import { registerSW } from 'virtual:pwa-register';
// Self-hosted em vez de um <link> para o Google Fonts: o app é um PWA que
// precisa abrir offline, e uma fonte buscada da rede no primeiro paint cai
// para a fonte de sistema justamente no caso que mais importa. Só o subset
// latin — cobre todo o pt-BR (ã, ç, ê, õ) e evita baixar cirílico/grego.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './style.css';
import { renderHoje } from './ui/hoje';

registerSW({ immediate: true });

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  // Entry is pure DOM and must not wait on PGlite boot — the ~5s target in
  // SPEC.md §7 is from icon tap to saved value, and only Salvar touches the
  // database. getDb() is awaited lazily inside ui/hoje.ts and ui/lancar.ts.
  renderHoje(app);
}
