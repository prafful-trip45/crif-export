/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Vidyasetu backend that runs auth + the version gate. */
  readonly VITE_LICENSE_SERVER_URL?: string;
  /** App version, injected from package.json by vite.config.ts (browser-dev fallback). */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
