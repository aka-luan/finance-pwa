export type Paint = (app: HTMLDivElement) => void;

type NavDirection = 'forward' | 'back' | 'none';

let root: HTMLDivElement | null = null;
let current: Paint | null = null;
const stack: Paint[] = [];

// Empty stack + a leftover history entry is how a standalone PWA stays in
// the app on the iOS edge-swipe. Without it, the gesture leaves Termômetro
// the way Safari leaves a website.
export function mountNav(app: HTMLDivElement): void {
  root = app;
  history.scrollRestoration = 'manual';
  window.addEventListener('popstate', onPopState);
  // iOS only applies :active after a touchstart has fired on the document
  // (or the control). Without this, press styles never show and taps feel
  // like a webpage — especially once tap-highlight is turned off.
  document.addEventListener('touchstart', () => {}, { passive: true });
}

export function reset(paint: Paint): void {
  stack.length = 0;
  current = paint;
  history.pushState({ depth: 0 }, '');
  run(paint, 'none');
}

export function push(paint: Paint): void {
  if (current) stack.push(current);
  current = paint;
  history.pushState({ depth: stack.length }, '');
  run(paint, 'forward');
}

export function replace(paint: Paint): void {
  current = paint;
  run(paint, 'none');
}

export function back(): void {
  if (stack.length === 0) return;
  history.back();
}

function onPopState(): void {
  const prev = stack.pop();
  if (!prev) {
    history.pushState({ depth: 0 }, '');
    return;
  }
  current = prev;
  run(prev, 'back');
}

function run(paint: Paint, direction: NavDirection): void {
  const app = root;
  if (!app) return;

  const apply = (): void => {
    paint(app);
  };

  if (
    direction === 'none' ||
    typeof document.startViewTransition !== 'function' ||
    prefersReducedMotion()
  ) {
    apply();
    return;
  }

  document.documentElement.dataset.nav = direction;
  const transition = document.startViewTransition(apply);
  void transition.finished.finally(() => {
    delete document.documentElement.dataset.nav;
  });
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
