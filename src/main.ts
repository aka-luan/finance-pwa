import { registerSW } from 'virtual:pwa-register';
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
