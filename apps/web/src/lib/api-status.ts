import { ApiError } from "./api-client.js";

/**
 * A stub route answers 501 with `not_implemented` until its milestone lands.
 * That is a statement about the roadmap, not a failure, so callers render it
 * differently from an error — and never offer a retry for it.
 */
export function isNotImplemented(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 501 &&
    error.code === "not_implemented"
  );
}

export const NOT_IMPLEMENTED_MESSAGE =
  "Not built yet. The API answered with a not-implemented response.";

export function withRequestId(message: string, requestId: string | null): string {
  return requestId ? `${message} (Request ${requestId})` : message;
}
