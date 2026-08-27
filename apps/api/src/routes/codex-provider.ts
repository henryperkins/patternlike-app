import { Hono, type Context } from "hono";

import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { canonicalJson, contentHash } from "@patternlike/shared";
import {
  authorizeCodexProviderTerminalWrite,
  cancelCodexProviderJob,
  claimCodexProviderJob,
  completeCodexProviderJob,
  failCodexProviderJob,
  releaseCodexProviderJobLease,
  reserveCodexProviderResponseUpload,
  type CodexProviderJob,
} from "../db/codex-provider-jobs.js";
import {
  consumePatternProviderCallBudget,
  utcDateFor,
} from "../db/pattern-provider-usage.js";
import {
  consumeOntologyProviderCallBudget,
  utcDateForOntologyProviderUsage,
} from "../db/ontology-provider-usage.js";
import {
  consumeProviderCallBudget as consumeReadingProviderCallBudget,
  utcDateFor as utcDateForReadingProviderUsage,
} from "../db/provider-usage.js";
import {
  putCodexProviderArtifact,
  readCodexProviderArtifact,
} from "../services/codex-provider-artifacts.js";
import {
  CODEX_PROVIDER_MAX_RESPONSE_BYTES,
  parseCodexProviderCompletion,
  parseCodexProviderFailure,
  parseCodexProviderInvocation,
} from "../services/codex-provider-contract.js";
import {
  codexProviderOwnerIsCurrent,
  nudgeCodexProviderOwner,
} from "../services/codex-provider-domain.js";
import { safeLog } from "../services/safe-log.js";

export const codexProviderRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

const textDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});
const textEncoder = new TextEncoder();
type CodexProviderContext = Context<{
  Bindings: Env;
  Variables: AppVariables;
}>;

function requestId(c: CodexProviderContext): string {
  return c.get("requestId");
}

function routeError(
  c: CodexProviderContext,
  status: 400 | 409 | 413 | 503,
  code:
    | "invalid_request"
    | "codex_provider_conflict"
    | "payload_too_large"
    | "codex_provider_unavailable",
  message: string,
) {
  return c.json(
    { error: { code, message, request_id: requestId(c) } },
    status,
  );
}

type BoundedJson =
  | { status: "ok"; value: unknown }
  | { status: "invalid" | "too_large" };

async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<BoundedJson> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number.isSafeInteger(Number(declaredLength)) &&
    Number(declaredLength) > maximumBytes
  ) {
    return { status: "too_large" };
  }
  if (!request.body) return { status: "invalid" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    byteLength += next.value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel();
      return { status: "too_large" };
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { status: "ok", value: JSON.parse(textDecoder.decode(bytes)) };
  } catch {
    return { status: "invalid" };
  }
}

async function hasExactEmptyBody(request: Request): Promise<boolean> {
  const parsed = await readBoundedJson(request, 32);
  return parsed.status === "ok" &&
    parsed.value !== null &&
    typeof parsed.value === "object" &&
    !Array.isArray(parsed.value) &&
    Object.keys(parsed.value).length === 0;
}

function validJobId(id: string): boolean {
  return /^cpjob_[a-f0-9]{32}$/.test(id);
}

function artifactCoordinate(job: CodexProviderJob, role: "request" | "response") {
  return {
    jobId: job.id,
    pipeline: job.pipeline,
    ownerId: job.ownerId,
    pass: job.pass,
    stageGeneration: job.stageGeneration,
    stageAttempt: job.stageAttempt,
    role,
  } as const;
}

function terminalAccepted(c: CodexProviderContext) {
  return c.json({
    schema_version: "codex-provider-terminal/v1",
    status: "accepted",
  });
}

function invalidDocument(c: CodexProviderContext) {
  return routeError(c, 400, "invalid_request", "Invalid terminal document");
}

function terminalConflict(c: CodexProviderContext) {
  return routeError(
    c,
    409,
    "codex_provider_conflict",
    "Codex provider lease or result conflict",
  );
}

function tooLarge(c: CodexProviderContext) {
  return routeError(c, 413, "payload_too_large", "Terminal document too large");
}

function completionOutputIsTooLarge(value: unknown): boolean {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).output === "string" &&
    textEncoder.encode((value as Record<string, string>).output).byteLength >
      CODEX_PROVIDER_MAX_RESPONSE_BYTES;
}

async function nudgeAndObserve(
  env: Env,
  job: CodexProviderJob,
  now: Date,
): Promise<void> {
  if (await nudgeCodexProviderOwner(env, job, now) === "send_failed") {
    safeLog({
      event: "codex_provider_dispatch_failed",
      job_id: job.id,
      pipeline: job.pipeline,
    });
  }
}

function logTerminalFailure(
  job: CodexProviderJob,
  failureCode: NonNullable<CodexProviderJob["failureCode"]>,
  safeDetailCode: NonNullable<CodexProviderJob["safeDetailCode"]>,
): void {
  safeLog({
    event: "codex_provider_job_failed",
    job_id: job.id,
    pipeline: job.pipeline,
    pass: job.pass,
    model: job.model,
    failure_code: failureCode,
    safe_detail_code: safeDetailCode,
  });
}

/**
 * Charge the ledger that owns this pipeline, or refuse.
 *
 * Every branch is explicit and the fallthrough is a refusal. A pipeline with no
 * ledger wired to it must not borrow another pipeline's allowance: the ceiling
 * an operator approved for ontology work is not an approval to spend it on a
 * reader's daily reading, and a silent cross-charge is invisible in exactly the
 * dashboard that exists to make spend visible.
 */
async function consumeBudget(
  env: Env,
  job: CodexProviderJob,
  now: Date,
): Promise<boolean> {
  if (job.pipeline === "pattern") {
    if (
      job.pass !== "planner" && job.pass !== "writer" && job.pass !== "verifier"
    ) {
      return false;
    }
    return (await consumePatternProviderCallBudget(
      env,
      utcDateFor(now),
      job.dailyCallLimit,
      job.pass,
    )).ok;
  }
  if (job.pipeline === "reading") {
    // Charged HERE and nowhere else. This is the moment the runner is handed a
    // plaintext invocation, which is the only moment a model call becomes
    // possible; creating, adopting, polling, completing, and publishing are all
    // free. A reclaimed lease charges again on purpose: the previous holder may
    // have invoked before it died, and the ceiling bounds spend rather than
    // successes.
    return (await consumeReadingProviderCallBudget(
      env,
      utcDateForReadingProviderUsage(now),
      job.dailyCallLimit,
    )).ok;
  }
  if (job.pipeline === "ontology") {
    if (job.pass === "publisher") return false;
    const stage =
      job.pass === "generator" || job.pass === "evaluator"
        ? job.pass
        : "regression";
    return (await consumeOntologyProviderCallBudget(
      env,
      utcDateForOntologyProviderUsage(now),
      job.dailyCallLimit,
      stage,
    )).ok;
  }
  return false;
}

codexProviderRoutes.post("/v1/jobs/claim", async (c) => {
  if (!await hasExactEmptyBody(c.req.raw.clone())) {
    return routeError(c, 400, "invalid_request", "Invalid claim document");
  }
  const now = new Date();
  const claimed = await claimCodexProviderJob(c.env, now);
  if (claimed.status === "empty") return c.body(null, 204);
  if (!await codexProviderOwnerIsCurrent(c.env, claimed.job, now)) {
    await cancelCodexProviderJob(
      c.env,
      { jobId: claimed.job.id, leaseToken: claimed.leaseToken },
      now,
    );
    safeLog({
      event: "codex_provider_job_conflict",
      job_id: claimed.job.id,
      operation: "claim",
    });
    return c.body(null, 204);
  }

  let plaintext: Uint8Array;
  try {
    plaintext = await readCodexProviderArtifact(
      c.env,
      {
        jobId: claimed.job.id,
        pipeline: claimed.job.pipeline,
        ownerId: claimed.job.ownerId,
        pass: claimed.job.pass,
        stageGeneration: claimed.job.stageGeneration,
        stageAttempt: claimed.job.stageAttempt,
        role: "request",
      },
      claimed.job.request,
    );
  } catch {
    await releaseCodexProviderJobLease(
      c.env,
      {
        jobId: claimed.job.id,
        leaseToken: claimed.leaseToken,
        availableAt: new Date(now.getTime() + 30_000),
      },
      now,
    );
    return routeError(
      c,
      503,
      "codex_provider_unavailable",
      "Codex provider work is unavailable",
    );
  }
  let serialized: string;
  let parsed: unknown;
  try {
    serialized = textDecoder.decode(plaintext);
    parsed = JSON.parse(serialized);
  } catch {
    await failCodexProviderJob(
      c.env,
      {
        jobId: claimed.job.id,
        leaseToken: claimed.leaseToken,
        code: "publisher_output_invalid",
        safeDetailCode: "schema_mismatch",
      },
      now,
    );
    logTerminalFailure(
      claimed.job,
      "publisher_output_invalid",
      "schema_mismatch",
    );
    await nudgeAndObserve(c.env, claimed.job, now);
    return routeError(
      c,
      503,
      "codex_provider_unavailable",
      "Codex provider work is unavailable",
    );
  }
  const invocation = parseCodexProviderInvocation(parsed);
  if (!invocation.ok || canonicalJson(invocation.value) !== serialized) {
    await failCodexProviderJob(
      c.env,
      {
        jobId: claimed.job.id,
        leaseToken: claimed.leaseToken,
        code: "publisher_output_invalid",
        safeDetailCode: "schema_mismatch",
      },
      now,
    );
    logTerminalFailure(
      claimed.job,
      "publisher_output_invalid",
      "schema_mismatch",
    );
    await nudgeAndObserve(c.env, claimed.job, now);
    return routeError(
      c,
      503,
      "codex_provider_unavailable",
      "Codex provider work is unavailable",
    );
  }
  if (!await consumeBudget(c.env, claimed.job, now)) {
    await failCodexProviderJob(
      c.env,
      {
        jobId: claimed.job.id,
        leaseToken: claimed.leaseToken,
        code: "publisher_budget_exhausted",
        safeDetailCode: "daily_call_limit_reached",
      },
      now,
    );
    logTerminalFailure(
      claimed.job,
      "publisher_budget_exhausted",
      "daily_call_limit_reached",
    );
    await nudgeAndObserve(c.env, claimed.job, now);
    return c.body(null, 204);
  }

  safeLog({
    event: "codex_provider_job_claimed",
    job_id: claimed.job.id,
    pipeline: claimed.job.pipeline,
    pass: claimed.job.pass,
    model: claimed.job.model,
  });
  return c.json({
    schema_version: "codex-provider-claim/v1",
    job_id: claimed.job.id,
    lease_token: claimed.leaseToken,
    model: claimed.job.model,
    reasoning_effort: claimed.job.reasoningEffort,
    prompt_version: claimed.job.promptVersion,
    timeout_ms: claimed.job.timeoutMs,
    invocation: invocation.value,
  });
});

codexProviderRoutes.post("/v1/jobs/:jobId/complete", async (c) => {
  const jobId = c.req.param("jobId");
  if (!validJobId(jobId)) return invalidDocument(c);
  const document = await readBoundedJson(
    c.req.raw,
    CODEX_PROVIDER_MAX_RESPONSE_BYTES * 2 + 4096,
  );
  if (document.status === "too_large") return tooLarge(c);
  if (document.status !== "ok") return invalidDocument(c);
  const completion = parseCodexProviderCompletion(document.value);
  if (!completion.ok) {
    return completionOutputIsTooLarge(document.value)
      ? tooLarge(c)
      : invalidDocument(c);
  }

  const now = new Date();
  const job = await authorizeCodexProviderTerminalWrite(
    c.env,
    {
      jobId,
      leaseToken: completion.value.lease_token,
      terminalStatus: "completed",
    },
    now,
  );
  if (!job) return terminalConflict(c);
  if (job.status === "completed") {
    if (
      !job.response ||
      await contentHash(completion.value.output) !==
        job.response.plaintextHash
    ) {
      return terminalConflict(c);
    }
    const replay = await completeCodexProviderJob(
      c.env,
      {
        jobId,
        leaseToken: completion.value.lease_token,
        response: job.response,
        providerRequestId: completion.value.provider_request_id,
        inputTokens: completion.value.input_tokens,
        outputTokens: completion.value.output_tokens,
      },
      now,
    );
    return replay.status === "adopted"
      ? terminalAccepted(c)
      : terminalConflict(c);
  }
  if (
    !await codexProviderOwnerIsCurrent(c.env, job, now)
  ) {
    await cancelCodexProviderJob(
      c.env,
      { jobId, leaseToken: completion.value.lease_token },
      now,
    );
    return terminalConflict(c);
  }

  const upload = await reserveCodexProviderResponseUpload(
    c.env,
    { jobId, leaseToken: completion.value.lease_token },
    now,
  );
  if (upload.status === "conflict") return terminalConflict(c);
  if (!await codexProviderOwnerIsCurrent(c.env, job, now)) {
    await cancelCodexProviderJob(
      c.env,
      { jobId, leaseToken: completion.value.lease_token },
      now,
    );
    return terminalConflict(c);
  }
  const leaseHash = await contentHash(completion.value.lease_token);

  let response;
  try {
    response = await putCodexProviderArtifact(
      c.env,
      {
        ...artifactCoordinate(job, "response"),
        storageDiscriminator: leaseHash.slice("sha256:".length),
      },
      textEncoder.encode(completion.value.output),
    );
  } catch {
    safeLog({
      event: "codex_provider_job_conflict",
      job_id: job.id,
      operation: "complete",
    });
    return terminalConflict(c);
  }
  if (response.artifact.objectKey !== upload.objectKey) {
    return terminalConflict(c);
  }
  const commitNow = new Date();
  if (!await codexProviderOwnerIsCurrent(c.env, job, commitNow)) {
    await cancelCodexProviderJob(
      c.env,
      { jobId, leaseToken: completion.value.lease_token },
      commitNow,
    );
    return terminalConflict(c);
  }
  const committed = await completeCodexProviderJob(
    c.env,
    {
      jobId,
      leaseToken: completion.value.lease_token,
      response: response.artifact,
      providerRequestId: completion.value.provider_request_id,
      inputTokens: completion.value.input_tokens,
      outputTokens: completion.value.output_tokens,
    },
    commitNow,
  );
  if (committed.status === "conflict" || committed.status === "stale") {
    await cancelCodexProviderJob(
      c.env,
      { jobId, leaseToken: completion.value.lease_token },
      commitNow,
    );
    safeLog({
      event: "codex_provider_job_conflict",
      job_id: job.id,
      operation: "complete",
    });
    return terminalConflict(c);
  }
  safeLog({
    event: "codex_provider_job_completed",
    job_id: job.id,
    pipeline: job.pipeline,
    pass: job.pass,
    model: job.model,
    input_tokens: completion.value.input_tokens,
    output_tokens: completion.value.output_tokens,
    response_hash: response.artifact.plaintextHash,
  });
  await nudgeAndObserve(c.env, job, commitNow);
  return terminalAccepted(c);
});

codexProviderRoutes.post("/v1/jobs/:jobId/fail", async (c) => {
  const jobId = c.req.param("jobId");
  if (!validJobId(jobId)) return invalidDocument(c);
  const document = await readBoundedJson(c.req.raw, 4096);
  if (document.status === "too_large") return tooLarge(c);
  if (document.status !== "ok") return invalidDocument(c);
  const failure = parseCodexProviderFailure(document.value);
  if (!failure.ok) return invalidDocument(c);

  const now = new Date();
  const job = await authorizeCodexProviderTerminalWrite(
    c.env,
    {
      jobId,
      leaseToken: failure.value.lease_token,
      terminalStatus: "failed",
    },
    now,
  );
  if (!job) return terminalConflict(c);
  if (
    job.status === "leased" &&
    !await codexProviderOwnerIsCurrent(c.env, job, now)
  ) {
    await cancelCodexProviderJob(
      c.env,
      { jobId, leaseToken: failure.value.lease_token },
      now,
    );
    return terminalConflict(c);
  }
  const committed = await failCodexProviderJob(
    c.env,
    {
      jobId,
      leaseToken: failure.value.lease_token,
      code: failure.value.code,
      safeDetailCode: failure.value.safe_detail_code,
    },
    now,
  );
  if (committed.status === "conflict" || committed.status === "stale") {
    safeLog({
      event: "codex_provider_job_conflict",
      job_id: job.id,
      operation: "fail",
    });
    return terminalConflict(c);
  }
  logTerminalFailure(
    job,
    failure.value.code,
    failure.value.safe_detail_code,
  );
  await nudgeAndObserve(c.env, job, now);
  return terminalAccepted(c);
});
