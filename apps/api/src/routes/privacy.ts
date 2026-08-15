import { Hono } from "hono";
import { requireIdempotencyKey } from "@patternlike/shared";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  loadOwnedExport,
  reserveAccountExport,
  type ExportStatusRow,
} from "../db/privacy-jobs.js";
import { M6_SCHEMA_VERSION, type ExportOptions } from "../services/account-export.js";
import {
  MAX_EXPORT_CIPHERTEXT_BYTES,
  MAX_EXPORT_PLAINTEXT_BYTES,
  exportObjectKey,
  openExport,
} from "../services/export-envelope.js";
import { dispatchPrivacy } from "../services/privacy-jobs.js";
import { expireExportArtifact } from "../services/privacy-maintenance.js";
import {
  DELETION_RECEIPT_TTL_SECONDS,
  loadDeletionByReceipt,
  reserveAccountDeletion,
  type DeleteRequest,
} from "../db/deletion-jobs.js";
import {
  mutateContextSource,
  loadContextSourcesDocument,
  type ContextSourcesDocument,
} from "../db/context-sources.js";
import {
  storeCheckIn,
  type CheckInLevel,
  type NormalizedCheckInRequest,
} from "../db/check-ins.js";

export const privacyRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

export const deletionStatusRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

export const DELETION_RECEIPT_COOKIE = "pl_deletion_receipt";

function errorBody(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

async function parseExportRequest(request: Request): Promise<ExportOptions | null> {
  const text = await request.text();
  if (text.trim() === "") {
    return { include_readings: true, include_journal: true, include_patterns: true };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) =>
        key !== "include_readings" && key !== "include_journal" && key !== "include_patterns",
    ) ||
    (body.include_readings !== undefined &&
      typeof body.include_readings !== "boolean") ||
    (body.include_journal !== undefined &&
      typeof body.include_journal !== "boolean") ||
    (body.include_patterns !== undefined &&
      typeof body.include_patterns !== "boolean")
  ) {
    return null;
  }
  return {
    include_readings: body.include_readings ?? true,
    include_journal: body.include_journal ?? true,
    include_patterns: body.include_patterns ?? true,
  } as ExportOptions;
}

privacyRoutes.post("/v1/exports", async (c) => {
  const requestId = c.get("requestId");
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(
      errorBody(
        requestId,
        "missing_idempotency_key",
        "Idempotency-Key header required (8-256 chars)",
      ),
      400,
    );
  }
  const request = await parseExportRequest(c.req.raw);
  if (!request) {
    return c.json(
      errorBody(requestId, "invalid_body", "Request must match ExportRequest"),
      400,
    );
  }
  if (!c.env.ARTIFACTS) {
    return c.json(
      errorBody(
        requestId,
        "object_storage_not_configured",
        "Account export storage is unavailable",
      ),
      503,
    );
  }

  const outcome = await reserveAccountExport(
    c.env,
    {
      userId: c.get("userId"),
      cryptoSubject: c.get("cryptoSubject"),
    },
    key,
    request,
  );
  if (outcome.kind === "conflict") {
    return c.json(
      errorBody(
        requestId,
        "idempotency_conflict",
        "Idempotency-Key was already used for a different export request",
      ),
      409,
    );
  }
  if (outcome.kind === "created") {
    await dispatchPrivacy(c.env, {
      kind: "privacy",
      job_id: outcome.response.job_id,
      job_type: "export_account",
    });
  }
  return c.json(
    outcome.kind === "duplicate"
      ? { ...outcome.response, status: "duplicate" as const }
      : outcome.response,
    202,
  );
});

function statusProjection(row: ExportStatusRow, now = new Date()) {
  const expired =
    row.status === "ready" &&
    row.expires_at !== null &&
    Date.parse(row.expires_at) <= now.getTime();
  const status = expired ? "expired" : row.status;
  return {
    schema_version: M6_SCHEMA_VERSION,
    export_request_id: row.id,
    status,
    requested_at: row.created_at,
    status_updated_at: expired ? row.expires_at : row.status_updated_at,
    completed_at: row.completed_at,
    expires_at: row.expires_at,
    download_available: status === "ready",
    error_class: row.error_class,
  };
}

privacyRoutes.get("/v1/exports/:id", async (c) => {
  const row = await loadOwnedExport(c.env, c.get("userId"), c.req.param("id"));
  if (!row) {
    return c.json(
      errorBody(c.get("requestId"), "not_found", "Export request not found"),
      404,
    );
  }
  if (
    row.status === "ready" &&
    row.expires_at !== null &&
    Date.parse(row.expires_at) <= Date.now()
  ) {
    await expireExportArtifact(c.env, row.id);
  }
  return c.json(statusProjection(row), 200);
});

privacyRoutes.get("/v1/exports/:id/download", async (c) => {
  const requestId = c.get("requestId");
  const row = await loadOwnedExport(c.env, c.get("userId"), c.req.param("id"));
  if (!row) {
    return c.json(errorBody(requestId, "not_found", "Export request not found"), 404);
  }
  if (
    row.status === "expired" ||
    (row.status === "ready" &&
      row.expires_at !== null &&
      Date.parse(row.expires_at) <= Date.now())
  ) {
    if (row.status === "ready") {
      await expireExportArtifact(c.env, row.id);
    }
    return c.json(
      errorBody(requestId, "export_expired", "This export has expired"),
      410,
    );
  }
  if (row.status !== "ready") {
    return c.json(
      errorBody(requestId, "export_not_ready", "This export is not ready"),
      409,
    );
  }
  if (
    !c.env.ARTIFACTS ||
    row.wrapped_export_key === null ||
    row.export_key_nonce === null ||
    row.export_kek_version === null ||
    row.artifact_nonce === null
  ) {
    return c.json(
      errorBody(requestId, "artifact_unreadable", "Export artifact is unavailable"),
      500,
    );
  }

  const object = await c.env.ARTIFACTS.get(exportObjectKey(row.id));
  if (
    !object ||
    object.size > MAX_EXPORT_CIPHERTEXT_BYTES ||
    row.object_size_bytes === null ||
    object.size !== row.object_size_bytes
  ) {
    return c.json(
      errorBody(requestId, "artifact_unreadable", "Export artifact is unavailable"),
      500,
    );
  }
  try {
    const ciphertext = await object.arrayBuffer();
    const plaintext = await openExport(c.env, row.id, row.created_at, {
      ciphertext,
      artifactNonce: row.artifact_nonce,
      wrappedExportKey: row.wrapped_export_key,
      exportKeyNonce: row.export_key_nonce,
      exportKekVersion: row.export_kek_version,
    });
    if (plaintext.byteLength > MAX_EXPORT_PLAINTEXT_BYTES) {
      throw new Error("export plaintext exceeds its bound");
    }
    return new Response(plaintext, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="patternlike-${row.id}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return c.json(
      errorBody(requestId, "artifact_unreadable", "Export artifact is unreadable"),
      500,
    );
  }
});

async function parseDeleteRequest(request: Request): Promise<DeleteRequest | null> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => key !== "confirm" && key !== "reason") ||
    body.confirm !== "DELETE" ||
    (body.reason !== undefined &&
      body.reason !== null &&
      typeof body.reason !== "string")
  ) {
    return null;
  }
  return { confirm: "DELETE", reason: (body.reason as string | null) ?? null };
}

privacyRoutes.delete("/v1/account", async (c) => {
  const requestId = c.get("requestId");
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(
      errorBody(
        requestId,
        "missing_idempotency_key",
        "Idempotency-Key header required (8-256 chars)",
      ),
      400,
    );
  }
  const request = await parseDeleteRequest(c.req.raw);
  if (!request) {
    return c.json(
      errorBody(
        requestId,
        "invalid_body",
        'Request must contain {"confirm":"DELETE"}',
      ),
      400,
    );
  }
  if (!c.env.ARTIFACTS) {
    return c.json(
      errorBody(
        requestId,
        "object_storage_not_configured",
        "Account deletion storage is unavailable",
      ),
      503,
    );
  }

  const outcome = await reserveAccountDeletion(
    c.env,
    {
      userId: c.get("userId"),
      cryptoSubject: c.get("cryptoSubject"),
    },
    key,
    request,
  );
  if (outcome.kind === "conflict") {
    return c.json(
      errorBody(
        requestId,
        "idempotency_conflict",
        "Idempotency-Key was already used for a different deletion request",
      ),
      409,
    );
  }
  if (outcome.kind === "created") {
    setCookie(c, DELETION_RECEIPT_COOKIE, outcome.receipt, {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/v1/account/deletion-status",
      maxAge: DELETION_RECEIPT_TTL_SECONDS,
    });
    await dispatchPrivacy(c.env, {
      kind: "privacy",
      job_id: outcome.response.job_id,
      job_type: "delete_account",
    });
  }
  return c.json(
    outcome.kind === "duplicate"
      ? { ...outcome.response, status: "duplicate" as const }
      : outcome.response,
    202,
  );
});

deletionStatusRoutes.get("/v1/account/deletion-status", async (c) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  const receipt = getCookie(c, DELETION_RECEIPT_COOKIE);
  const request = receipt
    ? await loadDeletionByReceipt(c.env, receipt)
    : null;
  if (!request) {
    return c.json(
      errorBody(requestId, "unauthorized", "Deletion status is unavailable"),
      401,
    );
  }
  if (request.status === "completed") {
    setCookie(c, DELETION_RECEIPT_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/v1/account/deletion-status",
      maxAge: 0,
    });
  }
  return c.json(
    {
      schema_version: M6_SCHEMA_VERSION,
      deletion_request_id: request.id,
      status: request.status,
      requested_at: request.created_at,
      status_updated_at: request.status_updated_at,
      completed_at: request.completed_at,
      error_class: request.error_class,
    },
    200,
  );
});

const DOCUMENT_KEYS = new Set([
  "schema_version",
  "user_id",
  "sources",
  "updated_at",
]);
const SOURCE_KEYS = new Set([
  "schema_version",
  "user_id",
  "source_id",
  "enabled",
  "permission_state",
  "allowed_uses",
  "permission_tier",
  "consent_id",
  "freshness",
  "last_signal_id",
  "scopes",
  "connector_status",
  "updated_at",
]);

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return (
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

function parseContextSourcesDocument(value: unknown): ContextSourcesDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  if (
    !hasExactKeys(document, DOCUMENT_KEYS) ||
    document.schema_version !== "0.2.0" ||
    typeof document.user_id !== "string" ||
    typeof document.updated_at !== "string" ||
    !Array.isArray(document.sources) ||
    document.sources.length !== 1
  ) {
    return null;
  }
  const raw = document.sources[0];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const states = ["active", "paused", "revoked", "expired", "never_granted"];
  if (
    !hasExactKeys(source, SOURCE_KEYS) ||
    source.schema_version !== "0.2.0" ||
    source.user_id !== document.user_id ||
    (source.source_id !== "USR-06" && source.source_id !== "USR-09") ||
    typeof source.enabled !== "boolean" ||
    !states.includes(source.permission_state as string) ||
    !Array.isArray(source.allowed_uses) ||
    source.allowed_uses.some((use) => typeof use !== "string") ||
    source.permission_tier !== 1 ||
    (source.consent_id !== null && typeof source.consent_id !== "string") ||
    source.freshness !== null ||
    (source.last_signal_id !== null && typeof source.last_signal_id !== "string") ||
    !Array.isArray(source.scopes) ||
    source.scopes.some((scope) => typeof scope !== "string") ||
    source.connector_status !== "not_applicable" ||
    typeof source.updated_at !== "string"
  ) {
    return null;
  }
  return value as ContextSourcesDocument;
}

privacyRoutes.get("/v1/context-sources", async (c) => {
  return c.json(await loadContextSourcesDocument(c.env, c.get("userId")), 200);
});

privacyRoutes.put("/v1/context-sources", async (c) => {
  const requestId = c.get("requestId");
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(
      errorBody(
        requestId,
        "missing_idempotency_key",
        "Idempotency-Key header required (8-256 chars)",
      ),
      400,
    );
  }
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    value = null;
  }
  const request = parseContextSourcesDocument(value);
  if (!request || request.user_id !== c.get("userId")) {
    return c.json(
      errorBody(
        requestId,
        "invalid_body",
        "Request must contain one current owner-scoped context source",
      ),
      400,
    );
  }
  const result = await mutateContextSource(
    c.env,
    {
      userId: c.get("userId"),
      cryptoSubject: c.get("cryptoSubject"),
    },
    key,
    request,
  );
  if (!result.ok) {
    return c.json(
      errorBody(
        requestId,
        result.reason,
        result.reason === "idempotency_conflict"
          ? "Idempotency-Key was already used for a different source document"
          : "The context-source state changed or the transition is not allowed",
      ),
      409,
    );
  }
  return c.json(result.response, 200);
});

const CHECK_IN_KEYS = new Set([
  "energy",
  "pressure",
  "clarity",
  "connection",
  "focus_domain",
  "note",
  "expires_in_seconds",
]);
const CHECK_IN_LEVELS = new Set(["low", "medium", "high"]);

function optionalLevel(value: unknown): value is CheckInLevel | undefined {
  return value === undefined || CHECK_IN_LEVELS.has(value as string);
}

function parseCheckIn(value: unknown): NormalizedCheckInRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => !CHECK_IN_KEYS.has(key)) ||
    !CHECK_IN_LEVELS.has(body.energy as string) ||
    !optionalLevel(body.pressure) ||
    !optionalLevel(body.clarity) ||
    !optionalLevel(body.connection) ||
    (body.focus_domain !== undefined && typeof body.focus_domain !== "string") ||
    (body.note !== undefined && body.note !== null && typeof body.note !== "string") ||
    (typeof body.note === "string" && body.note.length > 1000) ||
    (body.expires_in_seconds !== undefined &&
      (!Number.isInteger(body.expires_in_seconds) ||
        (body.expires_in_seconds as number) < 300 ||
        (body.expires_in_seconds as number) > 604800))
  ) {
    return null;
  }
  return {
    energy: body.energy as CheckInLevel,
    pressure: (body.pressure as CheckInLevel | undefined) ?? null,
    clarity: (body.clarity as CheckInLevel | undefined) ?? null,
    connection: (body.connection as CheckInLevel | undefined) ?? null,
    focus_domain: (body.focus_domain as string | undefined) ?? null,
    note: (body.note as string | null | undefined) ?? null,
    expires_in_seconds: (body.expires_in_seconds as number | undefined) ?? 86400,
  };
}

privacyRoutes.post("/v1/check-ins", async (c) => {
  const requestId = c.get("requestId");
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(
      errorBody(
        requestId,
        "missing_idempotency_key",
        "Idempotency-Key header required (8-256 chars)",
      ),
      400,
    );
  }
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    value = null;
  }
  const request = parseCheckIn(value);
  if (!request) {
    return c.json(
      errorBody(requestId, "invalid_body", "Request must match CheckInRequest"),
      400,
    );
  }

  const result = await storeCheckIn(
    c.env,
    {
      userId: c.get("userId"),
      cryptoSubject: c.get("cryptoSubject"),
    },
    key,
    request,
  );
  if (!result.ok) {
    return c.json(
      errorBody(
        requestId,
        result.reason,
        result.reason === "idempotency_conflict"
          ? "Idempotency-Key was already used for a different check-in"
          : result.reason === "context_source_inactive"
            ? "Enable Daily check-in in Privacy before saving"
            : result.reason === "timezone_confirmation_required"
              ? "Confirm your time zone before saving a daily check-in"
              : "The check-in state changed concurrently; retry the request",
      ),
      409,
    );
  }
  return c.json(result.response, 201);
});
