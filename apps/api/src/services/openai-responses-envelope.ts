/** Safe, content-free facts read from an OpenAI Responses envelope. */

export type OpenAiIncompleteReason = "max_output_tokens" | "content_filter" | "unknown";

export interface OpenAiResponseUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Read the provider's stop reason before anyone tries to parse partial output.
 *
 * `null` means the envelope is not marked incomplete. An unrecognized reason
 * remains closed as `unknown`; provider prose never crosses this boundary.
 */
export function readOpenAiIncompleteReason(body: unknown): OpenAiIncompleteReason | null {
  const envelope = body as {
    status?: unknown;
    incomplete_details?: { reason?: unknown } | null;
  };
  if (envelope?.status !== "incomplete") return null;

  const reason = envelope.incomplete_details?.reason;
  if (reason === "max_output_tokens" || reason === "content_filter") return reason;
  return "unknown";
}

/** Output tokens include reasoning; the nested count makes that split visible. */
export function readOpenAiResponseUsage(body: unknown): OpenAiResponseUsage {
  const usage = (body as {
    usage?: {
      input_tokens?: unknown;
      output_tokens?: unknown;
      output_tokens_details?: { reasoning_tokens?: unknown } | null;
    } | null;
  })?.usage;

  return {
    input_tokens: tokenCount(usage?.input_tokens),
    output_tokens: tokenCount(usage?.output_tokens),
    reasoning_tokens: tokenCount(usage?.output_tokens_details?.reasoning_tokens),
  };
}
