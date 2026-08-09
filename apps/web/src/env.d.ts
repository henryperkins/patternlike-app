/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_DEV_USER_ID?: string;
  readonly VITE_CONSENT_ID?: string;
  /** Override the Auth0 tenant. Must match OIDC_ISSUER in apps/api/wrangler.toml. */
  readonly VITE_AUTH0_DOMAIN?: string;
  /** Override the SPA client id. Must match OIDC_AUDIENCE in apps/api/wrangler.toml. */
  readonly VITE_AUTH0_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
