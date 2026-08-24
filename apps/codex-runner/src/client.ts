import {
  CODEX_PROVIDER_MAX_CLAIM_BYTES,
  parseCodexProviderClaim,
  validCodexProviderCompletion,
  validCodexProviderFailure,
  validCodexProviderJobId,
  type CodexProviderClaim,
  type CodexProviderCompletion,
  type CodexProviderFailure,
} from "./protocol.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

export class CodexProviderClientError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "CodexProviderClientError";
  }
}

export interface CodexProviderClientOptions {
  apiOrigin: string;
  runnerToken: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

type ClaimOutcome =
  | { status: "empty" }
  | { status: "claimed"; claim: CodexProviderClaim };

async function readBoundedBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    Number.isSafeInteger(Number(declared)) &&
    Number(declared) > maximumBytes
  ) {
    throw new CodexProviderClientError("Codex provider response is too large", response.status);
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new CodexProviderClientError("Codex provider response is too large", response.status);
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseJson(bytes: Uint8Array, message: string): unknown {
  try {
    return JSON.parse(textDecoder.decode(bytes));
  } catch {
    throw new CodexProviderClientError(message);
  }
}

function validTerminalAcknowledgement(value: unknown): boolean {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    (value as Record<string, unknown>).schema_version === "codex-provider-terminal/v1" &&
    (value as Record<string, unknown>).status === "accepted";
}

export class CodexProviderClient {
  private readonly apiOrigin: string;
  private readonly runnerToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: CodexProviderClientOptions) {
    this.apiOrigin = options.apiOrigin.replace(/\/$/, "");
    this.runnerToken = options.runnerToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timer.unref();
    try {
      return await this.fetchImpl(`${this.apiOrigin}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.runnerToken}`,
          "content-type": "application/json",
          accept: "application/json",
          "cache-control": "no-store",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new CodexProviderClientError("Codex provider request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  async claim(): Promise<ClaimOutcome> {
    const response = await this.post("/codex-provider/v1/jobs/claim", {});
    if (response.status === 204) {
      const bytes = await readBoundedBytes(response, 1);
      if (bytes.byteLength !== 0) {
        throw new CodexProviderClientError("Invalid empty claim response", 204);
      }
      return { status: "empty" };
    }
    if (response.status !== 200) {
      throw new CodexProviderClientError("Codex provider claim failed", response.status);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      throw new CodexProviderClientError("Invalid claim response content type", 200);
    }
    const value = parseJson(
      await readBoundedBytes(response, CODEX_PROVIDER_MAX_CLAIM_BYTES),
      "Invalid claim response",
    );
    const claim = parseCodexProviderClaim(value);
    if (claim === null) throw new CodexProviderClientError("Invalid claim response");
    return { status: "claimed", claim };
  }

  async complete(jobId: string, completion: CodexProviderCompletion): Promise<void> {
    if (!validCodexProviderJobId(jobId) || !validCodexProviderCompletion(completion)) {
      throw new CodexProviderClientError("Invalid completion document");
    }
    await this.terminal(jobId, "complete", completion);
  }

  async fail(jobId: string, failure: CodexProviderFailure): Promise<void> {
    if (!validCodexProviderJobId(jobId) || !validCodexProviderFailure(failure)) {
      throw new CodexProviderClientError("Invalid failure document");
    }
    await this.terminal(jobId, "fail", failure);
  }

  private async terminal(
    jobId: string,
    operation: "complete" | "fail",
    document: CodexProviderCompletion | CodexProviderFailure,
  ): Promise<void> {
    const response = await this.post(
      `/codex-provider/v1/jobs/${jobId}/${operation}`,
      document,
    );
    if (response.status !== 200) {
      throw new CodexProviderClientError("Codex provider terminal write failed", response.status);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      throw new CodexProviderClientError("Invalid terminal response content type", 200);
    }
    const value = parseJson(await readBoundedBytes(response, 1024), "Invalid terminal response");
    if (!validTerminalAcknowledgement(value)) {
      throw new CodexProviderClientError("Invalid terminal response");
    }
  }
}
