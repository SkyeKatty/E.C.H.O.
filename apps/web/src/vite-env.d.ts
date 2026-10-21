/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTROLLER_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
