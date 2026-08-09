import { vi } from "vitest";

/**
 * The path-keyed fetch stub, shared by the App and component suites.
 *
 * Extracted rather than copied: both suites assert against the *same* API, and
 * two drifting copies of the recorder would let a header assertion pass in one
 * file while the other stopped sending it. `src/test/setup.ts` calls
 * `vi.unstubAllGlobals()` after every test, so nothing here needs teardown.
 */
export function jsonResponse(status: number, body: unknown): Response {
  // 204 is a null-body status; handing the Response constructor a body for one
  // throws. DELETE /v1/sessions/current answers 204.
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface MockResponse {
  status: number;
  body: unknown;
  /**
   * Held open until the test releases it. Asserting a transient state such as
   * "Submitting..." against a wall-clock delay is a coin flip on a loaded CI
   * box — the label is monotonic, so a missed poll can never recover.
   */
  gate?: Promise<void>;
  /** Reject the fetch itself, i.e. the non-ApiError transport failure path. */
  unreachable?: boolean;
}

export interface CapturedRequest {
  path: string;
  search: string;
  method: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null;
}

let captured: CapturedRequest[] = [];

export function capturedFor(path: string): CapturedRequest[] {
  return captured.filter((request) => request.path === path);
}

export function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Mirrors the shape apps/api/src/routes/stubs.ts actually returns. */
export function notImplemented(feature: string, requestId: string): MockResponse {
  return {
    status: 501,
    body: {
      error: {
        code: "not_implemented",
        message: `${feature} lands in a later milestone`,
        request_id: requestId,
      },
    },
  };
}

export const NOT_BUILT = "Not built yet. The API answered with a not-implemented response.";

export function mockApiResponses(responses: Record<string, MockResponse>) {
  captured = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      captured.push({
        path: url.pathname,
        search: url.search,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        signal: init?.signal ?? null,
      });

      const entry = responses[url.pathname];
      if (!entry) {
        return jsonResponse(500, {
          error: {
            code: "unexpected_path",
            message: `No stubbed response for ${url.pathname}`,
          },
        });
      }

      if (entry.gate) await entry.gate;
      if (entry.unreachable) throw new TypeError("Failed to fetch");
      return jsonResponse(entry.status, entry.body);
    }),
  );
}
