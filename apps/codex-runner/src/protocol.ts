export const CODEX_PROVIDER_MAX_REQUEST_BYTES = 256 * 1024;
export const CODEX_PROVIDER_MAX_RESPONSE_BYTES = 1024 * 1024;
export const CODEX_PROVIDER_MAX_CLAIM_BYTES = CODEX_PROVIDER_MAX_REQUEST_BYTES + 16 * 1024;

const textEncoder = new TextEncoder();
const JOB_ID = /^cpjob_[a-f0-9]{32}$/;
const LEASE_TOKEN = /^[A-Za-z0-9._-]{32,256}$/;
const PIN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,199}$/;
const PROVIDER_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export interface CodexProviderInvocation {
  schema_version: "codex-provider-invocation/v1";
  prompt: string;
  output_schema: Record<string, unknown>;
}

export interface CodexProviderClaim {
  schema_version: "codex-provider-claim/v1";
  job_id: string;
  lease_token: string;
  model: string;
  reasoning_effort: "high" | "xhigh";
  prompt_version: string;
  timeout_ms: number;
  invocation: CodexProviderInvocation;
}

export interface CodexProviderCompletion {
  lease_token: string;
  output: string;
  provider_request_id: string;
  input_tokens: number;
  output_tokens: number;
}

export type CodexProviderFailureCode =
  | "publisher_unavailable"
  | "publisher_output_invalid"
  | "publisher_refused"
  | "publisher_auth_failed"
  | "publisher_model_unavailable";

export type CodexProviderSafeDetailCode =
  | "request_timeout"
  | "network_error"
  | "rate_limited"
  | "provider_5xx"
  | "max_output_tokens_exhausted"
  | "missing_output_text"
  | "multiple_output_text"
  | "invalid_json"
  | "schema_mismatch"
  | "provider_refusal"
  | "authentication_failed"
  | "model_not_available";

export interface CodexProviderFailure {
  lease_token: string;
  code: CodexProviderFailureCode;
  safe_detail_code: CodexProviderSafeDetailCode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function encodedLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function parseCodexProviderClaim(value: unknown): CodexProviderClaim | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "job_id",
      "lease_token",
      "model",
      "reasoning_effort",
      "prompt_version",
      "timeout_ms",
      "invocation",
    ]) ||
    value.schema_version !== "codex-provider-claim/v1" ||
    typeof value.job_id !== "string" ||
    !JOB_ID.test(value.job_id) ||
    typeof value.lease_token !== "string" ||
    !LEASE_TOKEN.test(value.lease_token) ||
    typeof value.model !== "string" ||
    !PIN.test(value.model) ||
    (value.reasoning_effort !== "high" && value.reasoning_effort !== "xhigh") ||
    typeof value.prompt_version !== "string" ||
    !PIN.test(value.prompt_version) ||
    !Number.isSafeInteger(value.timeout_ms) ||
    (value.timeout_ms as number) < 1 ||
    (value.timeout_ms as number) > 900_000 ||
    !isRecord(value.invocation) ||
    !hasExactKeys(value.invocation, ["schema_version", "prompt", "output_schema"]) ||
    value.invocation.schema_version !== "codex-provider-invocation/v1" ||
    typeof value.invocation.prompt !== "string" ||
    value.invocation.prompt.length === 0 ||
    !isRecord(value.invocation.output_schema)
  ) {
    return null;
  }
  let schema: string;
  try {
    schema = JSON.stringify(value.invocation.output_schema);
  } catch {
    return null;
  }
  if (
    encodedLength(value.invocation.prompt) + encodedLength(schema) >
      CODEX_PROVIDER_MAX_REQUEST_BYTES
  ) {
    return null;
  }
  return value as unknown as CodexProviderClaim;
}

export function validCodexProviderCompletion(value: CodexProviderCompletion): boolean {
  return LEASE_TOKEN.test(value.lease_token) &&
    encodedLength(value.output) <= CODEX_PROVIDER_MAX_RESPONSE_BYTES &&
    PROVIDER_REQUEST_ID.test(value.provider_request_id) &&
    isNonNegativeInteger(value.input_tokens) &&
    isNonNegativeInteger(value.output_tokens);
}

const FAILURE_DETAILS: Readonly<Record<CodexProviderFailureCode, ReadonlySet<string>>> = {
  publisher_unavailable: new Set([
    "request_timeout",
    "network_error",
    "rate_limited",
    "provider_5xx",
  ]),
  publisher_output_invalid: new Set([
    "max_output_tokens_exhausted",
    "missing_output_text",
    "multiple_output_text",
    "invalid_json",
    "schema_mismatch",
  ]),
  publisher_refused: new Set(["provider_refusal"]),
  publisher_auth_failed: new Set(["authentication_failed"]),
  publisher_model_unavailable: new Set(["model_not_available"]),
};

export function validCodexProviderFailure(value: CodexProviderFailure): boolean {
  return LEASE_TOKEN.test(value.lease_token) &&
    Object.hasOwn(FAILURE_DETAILS, value.code) &&
    FAILURE_DETAILS[value.code].has(value.safe_detail_code);
}

export function validCodexProviderJobId(value: string): boolean {
  return JOB_ID.test(value);
}
