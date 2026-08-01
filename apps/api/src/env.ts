export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  AUTH_STUB: string;
  CALC_SERVICE_URL: string;
  SCHEMA_VERSION: string;
  ROOT_KEK?: string;
  SERVICE_AUTH_TOKEN?: string;
  ARTIFACTS?: R2Bucket;
}
