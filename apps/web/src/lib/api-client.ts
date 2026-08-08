import type {
  BirthProfileRequest,
  BirthTimeAccuracy,
  ChartSnapshot,
  ErrorBody,
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

function requestHeaders(withJson = false): Headers {
  const headers = new Headers();
  if (withJson) headers.set("content-type", "application/json");

  const devUserId =
    import.meta.env.VITE_DEV_USER_ID ??
    (import.meta.env.DEV ? "usr_local_dev_0001" : undefined);
  if (devUserId) headers.set("x-user-id", devUserId);

  return headers;
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
    throw new Error("The API answered with something that is not JSON.");
  }
}

export function getChart(signal?: AbortSignal): Promise<ChartResponse> {
  return request<ChartResponse>("/v1/chart", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function createBirthProfile(
  profile: BirthProfileRequest,
): Promise<BirthWorkflowResponse> {
  return request<BirthWorkflowResponse>("/v1/birth-profiles", {
    method: "POST",
    headers: (() => {
      const headers = requestHeaders(true);
      const suffix =
        globalThis.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      headers.set("idempotency-key", `web-birth-${suffix}`);
      return headers;
    })(),
    body: JSON.stringify(profile),
  });
}

export function requestAccountExport(signal?: AbortSignal): Promise<unknown> {
  return request<unknown>("/v1/exports", {
    method: "POST",
    headers: requestHeaders(),
    signal,
  });
}

export function deleteAccount(signal?: AbortSignal): Promise<unknown> {
  return request<unknown>("/v1/account", {
    method: "DELETE",
    headers: requestHeaders(),
    signal,
  });
}

export function getTodayReadings(signal?: AbortSignal): Promise<unknown> {
  return request<unknown>("/v1/readings/today", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function getTiming(signal?: AbortSignal): Promise<unknown> {
  return request<unknown>("/v1/timing", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function getTimeTravel(signal?: AbortSignal): Promise<unknown> {
  return request<unknown>("/v1/time-travel", {
    method: "GET",
    headers: requestHeaders(),
    signal,
  });
}

export function onboardingConsentId(): string {
  return import.meta.env.VITE_CONSENT_ID ?? "cns_local_web_0001";
}
