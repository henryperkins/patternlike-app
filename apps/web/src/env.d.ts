/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_DEV_USER_ID?: string;
  readonly VITE_CONSENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
