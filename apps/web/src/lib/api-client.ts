import type {
  BirthProfileRequest,
  BirthTimeAccuracy,
  ChartSnapshot,
  ErrorBody,
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

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(status: number, body: ErrorBody) {
    super(body.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error.code;
    this.requestId = body.error.request_id ?? null;
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
}

function requestHeaders({ json = false, idempotencyKey }: HeaderOptions = {}): Headers {
  const headers = new Headers();
  if (json) headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

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
    response = await fetch(`${apiBaseUrl}${path}`, { ...init, credentials: "include" });
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
): Promise<BirthWorkflowResponse> {
  return request<BirthWorkflowResponse>("/v1/birth-profiles", {
    method: "POST",
    headers: requestHeaders({
      json: true,
      idempotencyKey: newIdempotencyKey("web-birth"),
    }),
    body: JSON.stringify(profile),
  });
}

export interface AccountExportOptions {
  includeReadings?: boolean;
  includeJournal?: boolean;
}

export function requestAccountExport(
  idempotencyKey: string,
  options: AccountExportOptions = {},
): Promise<WorkflowAccepted> {
  return request<WorkflowAccepted>("/v1/exports", {
    method: "POST",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({
      include_readings: options.includeReadings ?? true,
      include_journal: options.includeJournal ?? true,
    }),
  });
}

/**
 * `confirm` is fixed at "DELETE" by the contract — it is the interlock that
 * makes an accidental deletion impossible to express, so the caller must have
 * collected that confirmation from the user before reaching here.
 */
export function deleteAccount(
  idempotencyKey: string,
  reason?: string | null,
): Promise<WorkflowAccepted> {
  return request<WorkflowAccepted>("/v1/account", {
    method: "DELETE",
    headers: requestHeaders({ json: true, idempotencyKey }),
    body: JSON.stringify({ confirm: "DELETE", reason: reason ?? null }),
  });
}

export function getTodayReadings(signal?: AbortSignal): Promise<unknown> {
  return request<unknown>("/v1/readings/today", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export interface TimingFilters {
  phase?: string;
  domain?: string;
  duration?: string;
}

export function getTiming(
  filters: TimingFilters = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  // `URLSearchParams.size` only landed in Safari 17; serialising is universal.
  const serialized = query.toString();
  const suffix = serialized ? `?${serialized}` : "";

  return request<unknown>(`/v1/timing${suffix}`, {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

/** `date` (ISO `YYYY-MM-DD`) is a required query parameter on this route. */
export function getTimeTravel(
  date: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const query = new URLSearchParams({ date });

  return request<unknown>(`/v1/time-travel?${query.toString()}`, {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function onboardingConsentId(): string {
  return import.meta.env.VITE_CONSENT_ID ?? "cns_local_web_0001";
}
