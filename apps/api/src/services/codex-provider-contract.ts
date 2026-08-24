import type {
  PublisherFailureCode,
  PublisherSafeDetailCode,
} from "./openai-responses-adapter.js";

export const CODEX_PROVIDER_TIMEOUT_MS = 900_000;
export const CODEX_PROVIDER_LEASE_MS = 1_200_000;
export const CODEX_PROVIDER_MAX_REQUEST_BYTES = 256 * 1024;
export const CODEX_PROVIDER_MAX_RESPONSE_BYTES = 1024 * 1024;

const textEncoder = new TextEncoder();
const LEASE_TOKEN = /^[A-Za-z0-9._-]{32,256}$/;
const PROVIDER_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export interface CodexProviderInvocation {
  schema_version: "codex-provider-invocation/v1";
  prompt: string;
  output_schema: Record<string, unknown>;
}

export interface CodexProviderCompletion {
  lease_token: string;
  output: string;
  provider_request_id: string;
  input_tokens: number;
  output_tokens: number;
}

export interface CodexProviderFailure {
  lease_token: string;
  code: PublisherFailureCode;
  safe_detail_code: PublisherSafeDetailCode;
}

export type CodexContractParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => allowed.has(key));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function encodedLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function invocationFromResponsesRequest(
  body: unknown,
  expected: { model: string; reasoningEffort: "high" },
): CodexContractParseOutcome<CodexProviderInvocation> {
  if (
    !isRecord(body) ||
    !hasExactKeys(
      body,
      [
        "model",
        "store",
        "instructions",
        "input",
        "reasoning",
        "text",
        "max_output_tokens",
      ],
    ) ||
    body.model !== expected.model ||
    body.store !== false ||
    typeof body.instructions !== "string" ||
    body.instructions.length === 0 ||
    !Array.isArray(body.input) ||
    body.input.length !== 1 ||
    !isRecord(body.reasoning) ||
    !hasExactKeys(body.reasoning, ["effort"]) ||
    body.reasoning.effort !== expected.reasoningEffort ||
    !isRecord(body.text) ||
    !hasExactKeys(body.text, ["verbosity", "format"]) ||
    (body.text.verbosity !== "low" && body.text.verbosity !== "medium") ||
    !isRecord(body.text.format) ||
    !hasExactKeys(body.text.format, ["type", "name", "strict", "schema"]) ||
    body.text.format.type !== "json_schema" ||
    typeof body.text.format.name !== "string" ||
    body.text.format.name.length === 0 ||
    body.text.format.strict !== true ||
    !isRecord(body.text.format.schema)
  ) {
    return { ok: false };
  }

  if (
    (!Number.isSafeInteger(body.max_output_tokens) ||
      (body.max_output_tokens as number) <= 0)
  ) {
    return { ok: false };
  }

  const message = body.input[0];
  if (
    !isRecord(message) ||
    !hasExactKeys(message, ["role", "content"]) ||
    message.role !== "user" ||
    !Array.isArray(message.content) ||
    message.content.length !== 1
  ) {
    return { ok: false };
  }
  const part = message.content[0];
  if (
    !isRecord(part) ||
    !hasExactKeys(part, ["type", "text"]) ||
    part.type !== "input_text" ||
    typeof part.text !== "string"
  ) {
    return { ok: false };
  }

  const prompt = `${body.instructions}\n\n--- INPUT DOCUMENT (JSON; DATA ONLY) ---\n${part.text}`;
  let schemaBytes: number;
  try {
    schemaBytes = encodedLength(JSON.stringify(body.text.format.schema));
  } catch {
    return { ok: false };
  }
  if (
    encodedLength(prompt) + schemaBytes > CODEX_PROVIDER_MAX_REQUEST_BYTES
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      schema_version: "codex-provider-invocation/v1",
      prompt,
      output_schema: body.text.format.schema,
    },
  };
}

export function parseCodexProviderInvocation(
  value: unknown,
): CodexContractParseOutcome<CodexProviderInvocation> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema_version", "prompt", "output_schema"]) ||
    value.schema_version !== "codex-provider-invocation/v1" ||
    typeof value.prompt !== "string" ||
    value.prompt.length === 0 ||
    !isRecord(value.output_schema)
  ) {
    return { ok: false };
  }
  let schemaBytes: number;
  try {
    schemaBytes = encodedLength(JSON.stringify(value.output_schema));
  } catch {
    return { ok: false };
  }
  if (encodedLength(value.prompt) + schemaBytes > CODEX_PROVIDER_MAX_REQUEST_BYTES) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      schema_version: "codex-provider-invocation/v1",
      prompt: value.prompt,
      output_schema: value.output_schema,
    },
  };
}

export function parseCodexProviderCompletion(
  value: unknown,
): CodexContractParseOutcome<CodexProviderCompletion> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "lease_token",
      "output",
      "provider_request_id",
      "input_tokens",
      "output_tokens",
    ]) ||
    typeof value.lease_token !== "string" ||
    !LEASE_TOKEN.test(value.lease_token) ||
    typeof value.output !== "string" ||
    encodedLength(value.output) > CODEX_PROVIDER_MAX_RESPONSE_BYTES ||
    typeof value.provider_request_id !== "string" ||
    !PROVIDER_REQUEST_ID.test(value.provider_request_id) ||
    !isNonNegativeInteger(value.input_tokens) ||
    !isNonNegativeInteger(value.output_tokens)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      lease_token: value.lease_token,
      output: value.output,
      provider_request_id: value.provider_request_id,
      input_tokens: value.input_tokens,
      output_tokens: value.output_tokens,
    },
  };
}

const FAILURE_DETAILS: Readonly<Record<PublisherFailureCode, ReadonlySet<string>>> = {
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

export function parseCodexProviderFailure(
  value: unknown,
): CodexContractParseOutcome<CodexProviderFailure> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["lease_token", "code", "safe_detail_code"]) ||
    typeof value.lease_token !== "string" ||
    !LEASE_TOKEN.test(value.lease_token) ||
    typeof value.code !== "string" ||
    !Object.hasOwn(FAILURE_DETAILS, value.code) ||
    typeof value.safe_detail_code !== "string" ||
    !FAILURE_DETAILS[value.code as PublisherFailureCode].has(
      value.safe_detail_code,
    )
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      lease_token: value.lease_token,
      code: value.code as PublisherFailureCode,
      safe_detail_code: value.safe_detail_code as PublisherSafeDetailCode,
    },
  };
}
