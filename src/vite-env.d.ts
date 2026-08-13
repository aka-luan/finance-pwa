/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ViewTransition {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
}

interface Document {
  startViewTransition?(update: () => void): ViewTransition;
}

declare module '*.sql?raw' {
  const content: string;
  export default content;
}
