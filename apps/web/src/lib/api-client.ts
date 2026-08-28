import type {
  AccountProcessingConsentResponse as AccountProcessingConsentContract,
  AccountProcessingConsentUiSurface,
  BirthProfileRequest,
  BirthTimeAccuracy,
  ChartSnapshot,
  ErrorBody,
  GeocoderConsentResponse,
  GeocoderConsentUiSurface,
  LifeEvent,
  LifeEventRequest,
  PatternConsent,
  PatternGenerationAccepted,
  PatternGenerationStatus,
  PatternResponse,
  PatternResponseV7,
  PatternStateDocument,
  PlaceResolutionRequest,
  PlaceResolutionResponse,
  PlaceSearchRequest,
  PlaceSearchResponse,
  ReadingPublisherProvider,
  TimeTravelResponse,
  TimezoneLookupRequest,
  TimezoneLookupResponse,
  WorkflowAccepted,
} from "@patternlike/shared";

export interface ChartResponse extends Omit<ChartSnapshot, "birth"> {
  birth: {
    accuracy: BirthTimeAccuracy;
    utc_instant: null;
    timezone: null;
    place_label: null;
    latitude: null;
    longitude: null;
  };
}

export interface BirthWorkflowResponse extends WorkflowAccepted {
  chart?: {
    id: string;
    fingerprint: string;
    contract_id: string;
    uncertainty: ChartSnapshot["uncertainty"];
    status: "active";
  };
}

export type AccountProcessingConsentDocument =
  AccountProcessingConsentContract;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  /**
   * The envelope's optional `details`, retained for endpoints whose recovery
   * UI needs structured context that the browser cannot derive on its own.
   */
  readonly details: Record<string, unknown> | null;
  /**
   * Whether asking again can make progress, as the server says it.
   *
   * Only the v5 reading envelope sets it. A 503 is not uniformly retryable
   * there — an exhausted provider budget and a missing publisher configuration
   * both answer 503 and neither improves by pressing a button — so the screen
   * reads the flag instead of inferring an answer from the status. Absent means
   * absent: `null`, never a guessed `true`.
   */
  readonly retryable: boolean | null;

  constructor(status: number, body: ErrorBody) {
    const requestId = body.error.request_id ?? null;
    const message = body.error.code === "birth_calc_budget_exhausted"
      ? "Today's birth calculation limit has been reached. Try again tomorrow." +
        (requestId ? ` (Request ${requestId})` : "")
      : body.error.message;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error.code;
    this.requestId = requestId;
    this.details = body.error.details ?? null;
    const retryable = (body.error as { retryable?: unknown }).retryable;
    this.retryable = typeof retryable === "boolean" ? retryable : null;
  }
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

interface HeaderOptions {
  json?: boolean;
  /**
   * `Idempotency-Key` is `required: true` on every mutating operation in the
   * frozen OpenAPI contract, so any POST/DELETE that omits it is a 400 waiting
   * for the real handler to land.
   */
  idempotencyKey?: string;
  consentUiSurface?: AccountProcessingConsentUiSurface | GeocoderConsentUiSurface;
}

function requestHeaders({
  json = false,
  idempotencyKey,
  consentUiSurface,
}: HeaderOptions = {}): Headers {
  const headers = new Headers();
  if (json) headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  if (consentUiSurface) {
    headers.set("x-consent-ui-surface", consentUiSurface);
  }

  const devUserId =
    import.meta.env.VITE_DEV_USER_ID ??
    (import.meta.env.DEV ? "usr_local_dev_0001" : undefined);
  if (devUserId) headers.set("x-user-id", devUserId);

  return headers;
}

/**
 * Callers hold the key for the lifetime of one user intent so a retry after a
 * transient failure resumes the same workflow instead of starting a second
 * export — or a second deletion.
 */
export function newIdempotencyKey(prefix: string): string {
  const suffix =
    globalThis.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${suffix}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      // Chart correction polls GET /v1/chart for the replacement id. A cached
      // 200 of the superseded snapshot would look like success.
      cache: "no-store",
    });
  } catch {
    throw new Error("The Pattern/Like API could not be reached.");
  }

  if (!response.ok) {
    let body: ErrorBody;
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      body = {
        error: {
          code: "unexpected_response",
          message: `The API returned HTTP ${response.status}.`,
        },
      };
    }
    throw new ApiError(response.status, body);
  }

  try {
    return (await response.json()) as T;
  } catch {
    // A 200 that is not JSON means something other than the API answered —
    // an SPA fallback, a proxy, a captive portal. Surface that instead of
    // leaking a raw SyntaxError into the UI.
    //
    // On this origin that check earns its keep: the Worker serves the PWA and
    // the API together, and a path missing from `run_worker_first` is answered
    // by the static-asset handler with index.html and a 200.
    throw new Error("The API answered with something that is not JSON.");
  }
}

/**
 * Same error handling as `request`, for endpoints that answer 204.
 * Calling `response.json()` on an empty body throws, so the success path here
 * deliberately never reads it.
 */
async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new Error("The Pattern/Like API could not be reached.");
  }

  if (!response.ok) {
    let body: ErrorBody;
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      body = {
        error: {
          code: "unexpected_response",
          message: `The API returned HTTP ${response.status}.`,
        },
      };
    }
    throw new ApiError(response.status, body);
  }
}

export interface SessionResponse {
  token: string;
  expires_at: string;
}

/**
 * Exchange an OIDC id_token for a session.
 *
 * No `Idempotency-Key`: the session endpoints are not in the frozen M0 contract
 * (they arrived with the identity work), and the handler does not require one.
 * Minting a second session is harmless anyway — sessions are rows, and the
 * cookie only ever names the newest.
 *
 * The response body carries a bearer `token` for native clients. Browsers must
 * ignore it and let the httpOnly cookie do the work; holding the same value in
 * JavaScript is exactly the XSS exposure the cookie exists to prevent.
 */
export function createSession(idToken: string): Promise<SessionResponse> {
  return request<SessionResponse>("/v1/sessions", {
    method: "POST",
    headers: requestHeaders({ json: true }),
    body: JSON.stringify({ id_token: idToken }),
  });
}

/** Log out. Idempotent server-side: an already-invalid session still 204s. */
export function endSession(): Promise<void> {
  return requestNoContent("/v1/sessions/current", {
    method: "DELETE",
    headers: requestHeaders(),
  });
}

export function getChart(signal?: AbortSignal): Promise<ChartResponse> {
  return request<ChartResponse>("/v1/chart", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

/**
 * Ask the API which timezone a birthplace was actually on at the birth date.
 *
 * Same resolution `POST /v1/birth-profiles` runs, so what onboarding shows is
 * what the chart gets calculated in. POST because the birth date and time are
 * in the body rather than a logged query string; it stores nothing and needs no
 * idempotency key.
 */
export function lookupTimezone(
  lookup: TimezoneLookupRequest,
  signal?: AbortSignal,
): Promise<TimezoneLookupResponse> {
  return request<TimezoneLookupResponse>("/v1/timezone-lookup", {
    method: "POST",
    headers: requestHeaders({ json: true }),
    body: JSON.stringify(lookup),
    signal,
  });
}

export function createBirthProfile(
  profile: BirthProfileRequest,
  idempotencyKey: string,
): Promise<BirthWorkflowResponse> {
  return request<BirthWorkflowResponse>("/v1/birth-profiles", {
    method: "POST",
    headers: requestHeaders({
      json: true,
      idempotencyKey,
    }),
    body: JSON.stringify(profile),
  });
}

export interface AccountExportOptions {
  includeReadings?: boolean;
  includeJournal?: boolean;
}

export interface PrivacyWorkflowAccepted extends Omit<WorkflowAccepted, "job_id" | "resource_id"> {
  job_id: string;
  resource_id: string;
}

export interface AccountExportStatus {
  schema_version: "0.6.0";
  export_request_id: string;
  status: "queued" | "running" | "ready" | "failed" | "expired";
  requested_at: string;
  status_updated_at: string;
  completed_at: string | null;
  expires_at: string | null;
  download_available: boolean;
  error_class: string | null;
}

export function requestAccountExport(
  idempotencyKey: string,
  options: AccountExportOptions = {},
): Promise<PrivacyWorkflowAccepted> {
  return request<PrivacyWorkflowAccepted>("/v1/exports", {
    method: "POST",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({
      include_readings: options.includeReadings ?? true,
      include_journal: options.includeJournal ?? true,
    }),
  });
}

export function getAccountExportStatus(
  exportId: string,
  signal?: AbortSignal,
): Promise<AccountExportStatus> {
  return request<AccountExportStatus>(
    `/v1/exports/${encodeURIComponent(exportId)}`,
    { method: "GET", headers: requestHeaders(), signal },
  );
}

/**
 * `confirm` is fixed at "DELETE" by the contract — it is the interlock that
 * makes an accidental deletion impossible to express, so the caller must have
 * collected that confirmation from the user before reaching here.
 */
export function deleteAccount(
  idempotencyKey: string,
  reason?: string | null,
): Promise<PrivacyWorkflowAccepted> {
  return request<PrivacyWorkflowAccepted>("/v1/account", {
    method: "DELETE",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({ confirm: "DELETE", reason: reason ?? null }),
  });
}

export interface AccountDeletionStatus {
  schema_version: "0.6.0";
  deletion_request_id: string;
  status: "queued" | "running" | "completed" | "failed";
  requested_at: string;
  status_updated_at: string;
  completed_at: string | null;
  error_class: string | null;
}

export function getAccountDeletionStatus(
  signal?: AbortSignal,
): Promise<AccountDeletionStatus> {
  return request<AccountDeletionStatus>("/v1/account/deletion-status", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export type ContextSourceState =
  | "active"
  | "paused"
  | "revoked"
  | "expired"
  | "never_granted";

/**
 * The registry sources this client knows how to render.
 *
 * USR-06 is the Daily check-in grant; USR-09 is the Life-event timeline that
 * Time Travel reads. They are separate consents by design — enabling one must
 * never be a way to enable the other — so the client never treats them as
 * interchangeable and never infers one from the other's state.
 */
export type ContextSourceId = "USR-06" | "USR-09";

export interface ContextSourceProjection {
  schema_version: "0.2.0";
  user_id: string;
  source_id: ContextSourceId;
  enabled: boolean;
  permission_state: ContextSourceState;
  allowed_uses: string[];
  permission_tier: 1;
  consent_id: string | null;
  freshness: null;
  last_signal_id: string | null;
  scopes: string[];
  connector_status: "not_applicable";
  updated_at: string;
}

/**
 * `sources` is a list, not a one-tuple.
 *
 * GET returns every source in canonical order. Indexing position 0 to find one
 * of them was correct only while a single source existed; it now silently reads
 * or writes the wrong grant. Callers locate a source by `source_id`.
 */
export interface ContextSourcesDocument {
  schema_version: "0.2.0";
  user_id: string;
  sources: ContextSourceProjection[];
  updated_at: string;
}

export function findContextSource(
  document: ContextSourcesDocument,
  sourceId: ContextSourceId,
): ContextSourceProjection | null {
  return document.sources.find((source) => source.source_id === sourceId) ?? null;
}

export function getContextSources(
  signal?: AbortSignal,
): Promise<ContextSourcesDocument> {
  return request<ContextSourcesDocument>("/v1/context-sources", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

/**
 * Compare-and-set one source inside the document shape.
 *
 * The request carries exactly one source object; an omitted source is left
 * untouched rather than disabled. Both the document's `updated_at` and the
 * included source's `updated_at` are preconditions, so a page that has drifted
 * is refused instead of overwriting a change made elsewhere. The response is
 * the full document again — retain it, or the other source's state goes stale.
 */
export function updateContextSource(
  document: ContextSourcesDocument,
  source: ContextSourceProjection,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ContextSourcesDocument> {
  return request<ContextSourcesDocument>("/v1/context-sources", {
    method: "PUT",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({ ...document, sources: [source] }),
    signal,
  });
}

export type CheckInLevel = "low" | "medium" | "high";

export interface CheckInRequest {
  energy: CheckInLevel;
  pressure?: CheckInLevel;
  clarity?: CheckInLevel;
  connection?: CheckInLevel;
  focus_domain?: string;
  note?: string | null;
  expires_in_seconds: 86400;
}

export interface CheckInSignal {
  schema_version: "0.2.0";
  id: string;
  user_id: string;
  source_id: "USR-06";
  source_window: string;
  evidence_lane: "user_and_context";
  allowed_uses: string[];
  permission_state: "active";
  conflict_status: "none";
  freshness: {
    status: "fresh";
    observed_at: string;
    ingested_at: string;
    expires_at: string;
    max_age_seconds: number;
    age_seconds: 0;
  };
  value: {
    encoding: "structured";
    structured: {
      energy: CheckInLevel;
      pressure: CheckInLevel | null;
      clarity: CheckInLevel | null;
      connection: CheckInLevel | null;
      focus_domain: string | null;
      note: string | null;
    };
  };
  supersedes_signal_id: string | null;
  normalized_hash: string;
}

export function saveDailyCheckIn(
  checkIn: CheckInRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<CheckInSignal> {
  return request<CheckInSignal>("/v1/check-ins", {
    method: "POST",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify(checkIn),
    signal,
  });
}

export type ParagraphRole =
  | "primary_theme"
  | "supporting_theme"
  | "phase_context"
  | "timing"
  | "reflection"
  | "uncertainty_notice"
  | "context_label"
  | "safety_fallback";

/**
 * The roles a v5 candidate may carry.
 *
 * `safety_fallback` and `context_label` are absent because v5 has no reviewed
 * copy to fall back to and no separate context paragraph; `collective_context`
 * is new, and marking it is the whole point — a fact true for everyone must not
 * read as a private discovery.
 */
export type ParagraphRoleV5 =
  | "primary_theme"
  | "supporting_theme"
  | "phase_context"
  | "timing"
  | "collective_context"
  | "reflection"
  | "uncertainty_notice";

export interface ReadingParagraph {
  paragraph_id: string;
  role: ParagraphRole;
  /** 1-based, contiguous, strictly increasing. Sorted on before render anyway. */
  order: number;
  text: string;
}

export interface ReadingParagraphV5 {
  paragraph_id: string;
  role: ParagraphRoleV5;
  order: number;
  text: string;
}

export interface DailyReadingV3 {
  schema_version: string;
  output_schema: "daily-reading-v3";
  reading_id: string;
  /**
   * A bare calendar date in the reader's *scheduling* zone, not an instant.
   * Never hand it to `new Date()`: that parses as UTC midnight and then renders
   * in the browser's zone, which is a day early for everyone west of UTC.
   * `formatLocalDate` in lib/reading-format.ts is the only correct reader.
   */
  local_date: string;
  generated_at: string;
  assembly_mode: "deterministic";
  revision: number;
  locale: string;
  domain_preference?: string | null;
  paragraphs: ReadingParagraph[];
  fallback_used: boolean;
}

/**
 * The v5 artifact.
 *
 * No `fallback_used` and no `release_version`. `headline` and `disclosure` are
 * both required: the headline is the quiet kicker the lead sits under, and the
 * disclosure is the sentence that says a model wrote the prose — a reader
 * cannot consent to model synthesis and then not be told when it happened.
 */
export interface DailyReadingV5 {
  schema_version: string;
  output_schema: "daily-reading-v5";
  reading_id: string;
  /** Same rule as the v3 field: a bare calendar date, never `new Date()`. */
  local_date: string;
  generated_at: string;
  assembly_mode: "constrained_model";
  revision: number;
  locale: string;
  domain_preference?: string | null;
  headline: string;
  disclosure: string;
  paragraphs: ReadingParagraphV5[];
}

export type DailyReading = DailyReadingV3 | DailyReadingV5;

export interface DailyReadingResponseV3 {
  schema_version: string;
  reading: DailyReadingV3;
  /**
   * Optional *and* nullable in the contract. Its presence is the only signal
   * that there is provenance to show.
   */
  evidence_url?: string | null;
}

/** `evidence_url` is required here: every v5 reading has a provenance graph. */
export interface DailyReadingResponseV5 {
  schema_version: string;
  reading: DailyReadingV5;
  evidence_url: string;
}

export type DailyReadingResponse = DailyReadingResponseV3 | DailyReadingResponseV5;

/**
 * Which publisher wrote this reading.
 *
 * Keyed on `output_schema` rather than `schema_version`: it is a `const` in both
 * frozen schemas and names the artifact rather than the package it shipped in,
 * so a later package version that still emits a v5 reading still renders.
 */
export function isDailyReadingV5(
  response: DailyReadingResponse,
): response is DailyReadingResponseV5 {
  return response.reading.output_schema === "daily-reading-v5";
}

export interface DailyReadingPreparation {
  schema_version: string;
  status: "preparing";
  local_date: string;
}

export type EnsureTodayReadingResponse =
  | DailyReadingResponse
  | DailyReadingPreparation;

export function ensureTodayReading(
  signal?: AbortSignal,
): Promise<EnsureTodayReadingResponse> {
  return request<EnsureTodayReadingResponse>("/v1/readings/today", {
    method: "PUT",
    headers: requestHeaders(),
    signal,
  });
}

export function getTodayReading(signal?: AbortSignal): Promise<DailyReadingResponse> {
  return request<DailyReadingResponse>("/v1/readings/today", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

/**
 * The evidence graph, narrowed to what the "Why this?" drawer renders.
 *
 * Deliberately not the full graph: the wire projection is itself
 * `additionalProperties: true` with untyped paragraph items, so a complete
 * client type would assert more than the contract promises. The enum-valued
 * fields are typed `string` on purpose — the drawer renders each through a label
 * lookup that falls back to the raw value, so a member added in a later release
 * degrades to showing its code instead of rendering `undefined`.
 */
export interface EvidenceFactRef {
  id: string;
  fact_type: string;
  phase?: string | null;
  orb_deg?: number | null;
  technique?: string | null;
  pass_index?: number | null;
}

export interface EvidenceContentRef {
  fragment_id: string;
  content_version: string;
  release_version: string;
  content_type?: string | null;
}

export interface EvidenceContextRef {
  signal_id: string;
  source_id: string;
  allowed_use: string;
  evidence_lane: string;
  label?: string | null;
}

export interface EvidenceRankingFactor {
  factor: string;
  weight?: number | null;
  reason: string;
}

export interface ParagraphEvidence {
  paragraph_id: string;
  /** Typed, unlike its neighbours: the drawer joins on it to follow the prose. */
  role: ParagraphRole;
  evidence_lane: string;
  facts: EvidenceFactRef[];
  content: EvidenceContentRef[];
  context_signals: EvidenceContextRef[];
  ranking_factors?: EvidenceRankingFactor[];
}

export interface ReadingEvidenceV3 {
  schema_version: string;
  reading_id: string;
  revision: number;
  revision_reason?: string;
  assembly_id: string;
  release_version?: string;
  created_at?: string;
  paragraphs: ParagraphEvidence[];
}

/**
 * The v5 provenance graph: what was calculated, which categories of private
 * context were permitted where, and exactly which model wrote the prose.
 *
 * `fact_refs` carries a readable `label` because the drawer must be able to say
 * what a fact *is* without printing an opaque handle at a reader. `context_refs`
 * deliberately carries no value — the reader already has their own journal; what
 * they cannot otherwise see is which lane it was allowed to influence.
 */
export interface EvidenceFactRefV5 {
  fact_id: string;
  fact_class: string;
  label: string;
  scope: "personalized" | "collective";
}

export interface EvidenceContextRefV5 {
  private_ref: string;
  category: string;
  allowed_use: string;
}

export interface ParagraphEvidenceV5 {
  paragraph_id: string;
  role: ParagraphRoleV5;
  order: number;
  fact_refs: EvidenceFactRefV5[];
  context_refs: EvidenceContextRefV5[];
}

export interface EvidenceCalculationRecordV5 {
  chart_contract_id: string;
  cycle_policy_version: string;
  daily_sky_policy_version: string;
  ephemeris_data_version: string;
  container_digest: string;
  tzdb_version: string;
  local_day_resolution_policy_version: string;
}

export interface EvidenceModelRecordV5 {
  /**
   * The shared closed vocabulary, not an open string.
   *
   * The drawer renders this value verbatim, so it is the one place a reader
   * learns which service wrote their prose. Typing it as the union is what
   * stops a future surface from relabelling a historical `openai` record as
   * whatever is currently configured.
   */
  provider: ReadingPublisherProvider;
  model: string;
  prompt_version: string;
  selection_policy_version: string;
  validation_policy_version: string;
  provider_request_id: string;
  input_tokens: number;
  output_tokens: number;
}

export interface ReadingEvidenceV5 {
  schema_version: string;
  reading_id: string;
  revision: number;
  revision_reason: string;
  generated_at: string;
  generation_input_id: string;
  input_manifest_hash: string;
  content_hash: string;
  provider_response_hash: string;
  calculation: EvidenceCalculationRecordV5;
  model: EvidenceModelRecordV5;
  paragraphs: ParagraphEvidenceV5[];
  validation: {
    status: string;
    policy_version: string;
    checks: Array<{ code: string; passed: boolean }>;
  };
}

export type ReadingEvidence = ReadingEvidenceV3 | ReadingEvidenceV5;

/**
 * Keyed on the model record rather than on `schema_version`.
 *
 * The record is required in v5 and has no v3 counterpart, so it is the field
 * that actually separates the two graphs — and it is the field the drawer needs
 * in order to render the v5 layer at all. A graph it can render as v5, it does.
 */
export function isReadingEvidenceV5(
  evidence: ReadingEvidence,
): evidence is ReadingEvidenceV5 {
  return "model" in evidence && evidence.model !== null;
}

/**
 * Takes the reading id, not the response's `evidence_url`.
 *
 * Interpolating a server-supplied string into a fetch URL is a trust edge with
 * nothing to buy it, and `request()` prefixes `apiBaseUrl` — so a relative path
 * from the server would only work by coincidence of format. `evidence_url` is
 * used purely as the flag "there is evidence to show".
 */
export function getReadingEvidence(
  readingId: string,
  signal?: AbortSignal,
): Promise<ReadingEvidence> {
  return request<ReadingEvidence>(
    `/v1/readings/${encodeURIComponent(readingId)}/evidence`,
    { method: "GET", headers: requestHeaders(), signal },
  );
}

/**
 * The account-level AI-synthesis consent.
 *
 * Every field except `status` and `granted_at` is server-owned: the provider,
 * the purpose, the policy version, and the exact category list belong to the
 * policy the reader is being shown, and a client that supplied its own would be
 * asking for agreement to something the server never described. `PUT` echoes
 * back the version it was shown, which is how a stale page is refused rather
 * than silently granted under a policy the reader never read.
 */
export interface AiSynthesisConsent {
  kind: "ai_synthesis";
  status: "granted" | "not_granted";
  provider: string;
  purpose: string;
  policy_version: string;
  enabled_categories: string[];
  granted_at: string | null;
}

export function getAiSynthesisConsent(
  signal?: AbortSignal,
): Promise<AiSynthesisConsent> {
  return request<AiSynthesisConsent>("/v1/consents/ai-synthesis", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function grantAiSynthesisConsent(
  policyVersion: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AiSynthesisConsent> {
  return request<AiSynthesisConsent>("/v1/consents/ai-synthesis", {
    method: "PUT",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({ policy_version: policyVersion }),
    signal,
  });
}

/** No body: the route rejects one, and the server owns what is being revoked. */
export function revokeAiSynthesisConsent(
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AiSynthesisConsent> {
  return request<AiSynthesisConsent>("/v1/consents/ai-synthesis", {
    method: "DELETE",
    headers: requestHeaders({ idempotencyKey }),
    signal,
  });
}

export function getAccountProcessingConsent(
  signal?: AbortSignal,
): Promise<AccountProcessingConsentDocument> {
  return request<AccountProcessingConsentDocument>(
    "/v1/consents/account-processing",
    { method: "GET", headers: requestHeaders(), signal },
  );
}

export function grantAccountProcessingConsent(
  policyVersion: AccountProcessingConsentContract["policy_version"],
  idempotencyKey: string,
  consentUiSurface: AccountProcessingConsentUiSurface,
  signal?: AbortSignal,
): Promise<AccountProcessingConsentDocument> {
  return request<AccountProcessingConsentDocument>(
    "/v1/consents/account-processing",
    {
      method: "PUT",
      headers: requestHeaders({
        json: true,
        idempotencyKey,
        consentUiSurface,
      }),
      body: JSON.stringify({ policy_version: policyVersion }),
      signal,
    },
  );
}

/** Empty body by contract; the privacy-center header supplies the UI surface. */
export function revokeAccountProcessingConsent(
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AccountProcessingConsentDocument> {
  return request<AccountProcessingConsentDocument>(
    "/v1/consents/account-processing",
    {
      method: "DELETE",
      headers: requestHeaders({
        idempotencyKey,
        consentUiSurface: "privacy_center",
      }),
      signal,
    },
  );
}

export function searchPlaces(
  placeRequest: PlaceSearchRequest,
  signal?: AbortSignal,
): Promise<PlaceSearchResponse> {
  return request<PlaceSearchResponse>("/v1/places/search", {
    method: "POST",
    headers: requestHeaders({ json: true }),
    body: JSON.stringify(placeRequest),
    signal,
  });
}

export function resolvePlace(
  placeRequest: PlaceResolutionRequest,
  signal?: AbortSignal,
): Promise<PlaceResolutionResponse> {
  return request<PlaceResolutionResponse>("/v1/places/resolve", {
    method: "POST",
    headers: requestHeaders({ json: true }),
    body: JSON.stringify(placeRequest),
    signal,
  });
}

export function getGeocoderConsent(
  signal?: AbortSignal,
): Promise<GeocoderConsentResponse> {
  return request<GeocoderConsentResponse>("/v1/consents/geocoder", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function grantGeocoderConsent(
  policyVersion: string,
  uiSurface: GeocoderConsentUiSurface,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<GeocoderConsentResponse> {
  return request<GeocoderConsentResponse>("/v1/consents/geocoder", {
    method: "PUT",
    headers: requestHeaders({
      json: true,
      idempotencyKey,
      consentUiSurface: uiSurface,
    }),
    body: JSON.stringify({ policy_version: policyVersion }),
    signal,
  });
}

export function revokeGeocoderConsent(
  uiSurface: GeocoderConsentUiSurface,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<GeocoderConsentResponse> {
  return request<GeocoderConsentResponse>("/v1/consents/geocoder", {
    method: "DELETE",
    headers: requestHeaders({ idempotencyKey, consentUiSurface: uiSurface }),
    signal,
  });
}

export type PreferenceWriteSource = "user_confirmed" | "device_derived";
export type PreferenceSource = PreferenceWriteSource | "default_unconfirmed";

export interface TimezonePreferenceResponse {
  schema_version: string;
  timezone: string;
  source: PreferenceSource;
  timezone_revision: number;
  updated_at: string;
}

export interface LocalePreferenceResponse {
  schema_version: string;
  locale: string;
  source: PreferenceSource;
  updated_at: string;
}

/**
 * The zone that decides which local day a reading is generated for.
 *
 * Not the birthplace zone: `birth_profiles.timezone` says where the reader was
 * born, and substituting it here would schedule a reader's day in a place they
 * may not have lived for decades.
 */
export function setSchedulingTimezone(
  timezone: string,
  source: PreferenceWriteSource,
  idempotencyKey: string,
): Promise<TimezonePreferenceResponse> {
  return request<TimezonePreferenceResponse>("/v1/preferences/timezone", {
    method: "PUT",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({ timezone, source }),
  });
}

export function setContentLocale(
  locale: string,
  source: PreferenceWriteSource,
  idempotencyKey: string,
): Promise<LocalePreferenceResponse> {
  return request<LocalePreferenceResponse>("/v1/preferences/locale", {
    method: "PUT",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({ locale, source }),
  });
}

export type FeedbackResonance = "helpful" | "neutral" | "not_helpful" | "off";

export interface ReadingFeedbackRecord {
  id: string;
  reading_id: string;
  resonance: FeedbackResonance;
  relevance_labels: string[];
  created_at: string;
}

export interface TopicExclusionsResponse {
  schema_version: string;
  excluded_topics: string[];
  updated_at: string | null;
}

export function getReadingFeedback(
  readingId: string,
  signal?: AbortSignal,
): Promise<ReadingFeedbackRecord> {
  return request<ReadingFeedbackRecord>(`/v1/readings/${readingId}/feedback`, {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function submitReadingFeedback(
  readingId: string,
  body: {
    resonance: FeedbackResonance;
    relevance_labels?: string[];
    note?: string | null;
  },
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Pick<ReadingFeedbackRecord, "id" | "reading_id" | "created_at">> {
  return request(`/v1/readings/${readingId}/feedback`, {
    method: "POST",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify(body),
    signal,
  });
}

export function getTopicExclusions(
  signal?: AbortSignal,
): Promise<TopicExclusionsResponse> {
  return request<TopicExclusionsResponse>("/v1/preferences/topic-exclusions", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function setTopicExclusions(
  excludedTopics: string[],
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<TopicExclusionsResponse> {
  return request<TopicExclusionsResponse>("/v1/preferences/topic-exclusions", {
    method: "PUT",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({ excluded_topics: excludedTopics }),
    signal,
  });
}

export type TimingPhase =
  | "emerging"
  | "building"
  | "peak"
  | "reconsidering"
  | "integrating";
export type TimingPhaseFilter = TimingPhase | "upcoming";
export type TimingDurationFilter = "short" | "medium" | "long";
export type TimingBody =
  | "sun"
  | "moon"
  | "mercury"
  | "venus"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "pluto"
  | "true_node"
  | "ascendant"
  | "midheaven";
export type TimingAspect =
  | "conjunction"
  | "sextile"
  | "square"
  | "trine"
  | "opposition";

export interface TimingFilters {
  phase?: TimingPhaseFilter;
  duration?: TimingDurationFilter;
}

export interface TimingPass {
  pass_index: number;
  direction: "direct" | "retrograde";
  exact_at: string;
}

export interface TimingCycle {
  cycle_id: string;
  technique: "transit";
  body: TimingBody;
  target: string;
  aspect: TimingAspect;
  status: "active" | "upcoming";
  phase: TimingPhase | null;
  start_at: string;
  exact_at: string;
  end_at: string;
  duration_days: number;
  orb_deg: number;
  passes: TimingPass[];
}

export interface TimingResponse {
  schema_version: "0.3.0";
  as_of: string;
  calculation_status: {
    mode: "persisted_daily_reading_scan";
    state: "current" | "stale" | "not_scanned";
    last_refresh_at: string | null;
    last_refresh_local_date: string | null;
  };
  applied_filters: {
    phase: TimingPhaseFilter | null;
    duration: TimingDurationFilter | null;
  };
  unreadable_cycle_count: number;
  cycles: TimingCycle[];
}

export function getTiming(
  filters: TimingFilters = {},
  signal?: AbortSignal,
): Promise<TimingResponse> {
  const query = new URLSearchParams();
  if (filters.phase) query.set("phase", filters.phase);
  if (filters.duration) query.set("duration", filters.duration);
  // `URLSearchParams.size` only landed in Safari 17; serialising is universal.
  const serialized = query.toString();
  const suffix = serialized ? `?${serialized}` : "";

  return request<TimingResponse>(`/v1/timing${suffix}`, {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

/** `date` (ISO `YYYY-MM-DD`) is a required query parameter on this route. */
export function getTimeTravel(
  date: string,
  signal?: AbortSignal,
): Promise<TimeTravelResponse> {
  const query = new URLSearchParams({ date });

  return request<TimeTravelResponse>(`/v1/time-travel?${query.toString()}`, {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export interface PatternPageQuery {
  cursor?: string | null;
  limit?: number;
}

/**
 * One page of eligible Pattern chapters.
 *
 * The route accepts only `cursor` and `limit`; anything else is a 400, so the
 * query is built here rather than passed through. Callers follow `next_cursor`
 * until it is null — the page size is a transport bound, not a personalisation
 * cap, and stopping early would hide chapters the reader is eligible for.
 */
export function getPattern(
  query: PatternPageQuery = {},
  signal?: AbortSignal,
): Promise<PatternResponse> {
  const params = new URLSearchParams();
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const serialized = params.toString();

  return request<PatternResponse>(`/v1/pattern${serialized ? `?${serialized}` : ""}`, {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function getPatternState(signal?: AbortSignal): Promise<PatternStateDocument> {
  return request<PatternStateDocument>("/v1/pattern-state", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function getGeneratedPattern(signal?: AbortSignal): Promise<PatternResponseV7> {
  return request<PatternResponseV7>("/v1/pattern", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function getPatternGenerationConsent(signal?: AbortSignal): Promise<PatternConsent> {
  return request<PatternConsent>("/v1/consents/pattern-generation", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function revokePatternGenerationConsent(
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<{ consent: PatternConsent; existing_pattern_retained: boolean }> {
  return request<{ consent: PatternConsent; existing_pattern_retained: boolean }>(
    "/v1/consents/pattern-generation",
    {
      method: "DELETE",
      headers: requestHeaders({ idempotencyKey }),
      signal,
    },
  );
}

export function startPatternGeneration(
  consentPolicyVersion: string,
  reason: "first_open" | "first_open_retry" | "failed_attempt_retry",
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PatternGenerationAccepted> {
  return request<PatternGenerationAccepted>("/v1/pattern-generations", {
    method: "POST",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({
      schema_version: "0.7.0",
      consent_policy_version: consentPolicyVersion,
      confirm: "GENERATE MY PATTERN",
      reason,
    }),
    signal,
  });
}

export function getPatternGeneration(
  generationId: string,
  signal?: AbortSignal,
): Promise<PatternGenerationStatus> {
  return request<PatternGenerationStatus>(
    `/v1/pattern-generations/${encodeURIComponent(generationId)}`,
    { method: "GET", headers: requestHeaders(), signal },
  );
}

export function deleteGeneratedPattern(
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<void> {
  return requestNoContent("/v1/pattern", {
    method: "DELETE",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({ confirm: "DELETE PATTERN" }),
    signal,
  });
}

export interface LifeEventListResponse {
  schema_version: "0.4.0";
  items: LifeEvent[];
}

/** Accepts no query parameters: the account cap bounds the list instead. */
export function listLifeEvents(signal?: AbortSignal): Promise<LifeEventListResponse> {
  return request<LifeEventListResponse>("/v1/life-events", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function createLifeEvent(
  event: LifeEventRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<LifeEvent> {
  return request<LifeEvent>("/v1/life-events", {
    method: "POST",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify(event),
    signal,
  });
}

/**
 * Writes a new immutable revision; it does not edit the stored one.
 *
 * The key is held for one user intent so a retry after a transient failure
 * resumes that revision rather than stacking a second one.
 */
export function updateLifeEvent(
  eventId: string,
  event: LifeEventRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<LifeEvent> {
  return request<LifeEvent>(`/v1/life-events/${encodeURIComponent(eventId)}`, {
    method: "PUT",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify(event),
    signal,
  });
}

/** 204, so it uses the no-content reader. Removes every retained revision. */
export function deleteLifeEvent(
  eventId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<void> {
  return requestNoContent(`/v1/life-events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: requestHeaders({ idempotencyKey }),
    signal,
  });
}
