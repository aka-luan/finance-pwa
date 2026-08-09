/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.sql?raw' {
  const content: string;
  export default content;
}
