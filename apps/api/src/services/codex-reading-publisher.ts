/**
 * The Daily publisher adapter for the durable Codex runner.
 *
 * It replaces a synchronous HTTP call with a durable coordinate, and that is
 * the only thing it changes. The request bytes are the same strict Responses
 * document `buildResponsesRequest` has always produced, so the prompt, the
 * schema, and the ceilings a frozen command promised are unaffected by how the
 * bytes reach the model.
 *
 * The adapter still decides nothing. It turns one closed request into a
 * candidate, a typed failure, or "still working"; consent, budget, retry class,
 * publication, and logging stay in the Worker. What it adds is that "still
 * working" is now a real answer, because the external call outlives the Queue
 * delivery that started it.
 *
 * Nothing that crosses to the runner names the reader. The invocation is three
 * fields — schema version, prompt, output schema — and the coordinate that
 * identifies the work is supplied by the executor and sealed into the artifact
 * envelope's AAD, never into the packet.
 */

import { canonicalJson, contentHash } from "@patternlike/shared";
import type { ReadingGenerationOutput, ReadingGenerationRequest } from "@patternlike/shared";

import type { Env } from "../env.js";
import {
  codexProviderJobId,
  enqueueCodexProviderJob,
} from "../db/codex-provider-jobs.js";
import {
  putCodexProviderArtifact,
  readCodexProviderArtifact,
} from "./codex-provider-artifacts.js";
import {
  CODEX_PROVIDER_TIMEOUT_MS,
  invocationFromResponsesRequest,
} from "./codex-provider-contract.js";
import { buildResponsesRequest } from "./reading-prompt.js";
import type {
  CodexProviderFailureCode,
  CodexProviderSafeDetailCode,
} from "../db/codex-provider-jobs.js";
import {
  READING_PUBLISHER_PROVIDER,
  type CodexPublisherResult,
  type CodexReadingPublisher,
  type PublishOptions,
} from "./reading-publisher.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});

/** The top-level keys the strict schema requires. Depth is the validator's job. */
const REQUIRED_CANDIDATE_KEYS = [
  "schema_version",
  "output_schema",
  "local_date",
  "locale",
  "headline",
  "lead",
  "paragraphs",
  "reflection_prompt",
  "uncertainty_note",
] as const;

function failure(
  code: CodexProviderFailureCode,
  safe_detail_code: CodexProviderSafeDetailCode,
): CodexPublisherResult {
  return { ok: false, code, safe_detail_code, retry_after_seconds: null };
}

/**
 * The class for "this Worker could not get the request as far as the runner".
 *
 * `publisher_unavailable` rather than `publisher_not_configured`: from the
 * reader's point of view a keyring that will not seal and an R2 that will not
 * accept a put are the same transient condition, and this is the class the
 * Daily retry policy is willing to try again on.
 */
function unavailable(): CodexPublisherResult {
  return failure("publisher_unavailable", "network_error");
}

export function createCodexReadingPublisher(
  env: Pick<Env, "DB" | "ARTIFACTS" | "CODEX_PROVIDER_ARTIFACT_KEYRING">,
): CodexReadingPublisher {
  return {
    async publish(
      request: ReadingGenerationRequest,
      options: PublishOptions,
    ): Promise<CodexPublisherResult> {
      const coordinate = options.codexJob;
      // The deadline is the Codex contract's, and the reasoning pin is the one
      // the runner's own claim schema accepts. A command frozen under either
      // of the old values names an execution this path cannot perform, so it
      // is refused rather than silently executed under different ones.
      if (
        !coordinate ||
        coordinate.pipeline !== "reading" ||
        options.timeoutMs !== CODEX_PROVIDER_TIMEOUT_MS ||
        options.configuration.reasoning_effort !== "high"
      ) {
        return unavailable();
      }

      const body = buildResponsesRequest(request, options.configuration);
      const converted = invocationFromResponsesRequest(body, {
        model: options.configuration.model,
        reasoningEffort: "high",
      });
      // The conversion also enforces the 256KB prompt-plus-schema ceiling, so
      // an oversize packet fails here rather than at the runner, where it would
      // be an opaque claim rejection.
      if (!converted.ok) return unavailable();

      const serialized = canonicalJson(converted.value);
      const requestHash = await contentHash(serialized);
      const jobId = await codexProviderJobId({
        pipeline: "reading",
        ownerId: coordinate.ownerId,
        pass: "publisher",
        stageGeneration: coordinate.stageGeneration,
        stageAttempt: coordinate.stageAttempt,
        requestHash,
      });

      let job;
      try {
        // The encrypted request lands before the control row, so a crash
        // between them leaves an object with no job rather than a job whose
        // request cannot be read. The put is create-only and the enqueue is
        // INSERT OR IGNORE, so the whole sequence is idempotent: a duplicate
        // Queue delivery in the same attempt adopts and spends nothing.
        const artifact = await putCodexProviderArtifact(
          env,
          {
            jobId,
            pipeline: "reading",
            ownerId: coordinate.ownerId,
            pass: "publisher",
            stageGeneration: coordinate.stageGeneration,
            stageAttempt: coordinate.stageAttempt,
            role: "request",
          },
          textEncoder.encode(serialized),
        );
        job = (await enqueueCodexProviderJob(
          env,
          {
            pipeline: "reading",
            ownerId: coordinate.ownerId,
            userId: coordinate.userId,
            pass: "publisher",
            stageGeneration: coordinate.stageGeneration,
            stageAttempt: coordinate.stageAttempt,
            request: artifact.artifact,
            model: options.configuration.model,
            reasoningEffort: "high",
            promptVersion: options.configuration.prompt_version,
            timeoutMs: CODEX_PROVIDER_TIMEOUT_MS,
            dailyCallLimit: coordinate.dailyCallLimit,
          },
          new Date(),
        )).job;
      } catch {
        return unavailable();
      }

      if (job.status === "pending" || job.status === "leased") {
        return { ok: false, code: "publisher_pending", job_id: job.id };
      }
      if (job.status === "failed") {
        // The runner already classified this into the closed vocabulary the
        // Daily retry policy reads. Re-deriving it here would be a second
        // opinion about an event this Worker did not observe.
        if (!job.failureCode || !job.safeDetailCode) return unavailable();
        return failure(job.failureCode, job.safeDetailCode);
      }
      if (job.status !== "completed" || !job.response) {
        // `cancelled` lands here: the owner check refused the work while the
        // runner held it, and there is nothing to adopt.
        return unavailable();
      }

      let candidate: unknown;
      try {
        const plaintext = await readCodexProviderArtifact(
          env,
          {
            jobId: job.id,
            pipeline: "reading",
            ownerId: coordinate.ownerId,
            pass: "publisher",
            stageGeneration: coordinate.stageGeneration,
            stageAttempt: coordinate.stageAttempt,
            role: "response",
          },
          job.response,
        );
        // Strict UTF-8: a lone surrogate or a stray byte is a malformed
        // response, not something to repair into plausible prose.
        candidate = JSON.parse(textDecoder.decode(plaintext));
      } catch {
        return failure("publisher_output_invalid", "invalid_json");
      }
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        Array.isArray(candidate)
      ) {
        return failure("publisher_output_invalid", "schema_mismatch");
      }
      const keys = new Set(Object.keys(candidate as Record<string, unknown>));
      if (!REQUIRED_CANDIDATE_KEYS.every((key) => keys.has(key))) {
        return failure("publisher_output_invalid", "schema_mismatch");
      }
      if (
        !job.providerRequestId ||
        job.inputTokens === null ||
        job.outputTokens === null
      ) {
        return unavailable();
      }

      return {
        ok: true,
        // Returned exactly as the runner reported it. An adapter that repaired
        // an echoed date would hide the defect the validator exists to catch.
        candidate: candidate as ReadingGenerationOutput,
        metadata: {
          provider: READING_PUBLISHER_PROVIDER,
          model: job.model,
          // The provider-side thread/request handle the runner reported. NOT
          // the Codex control-job id: that is an internal coordinate, and
          // published evidence must not become a way to enumerate one.
          provider_request_id: job.providerRequestId,
          input_tokens: job.inputTokens,
          output_tokens: job.outputTokens,
          provider_response_hash: job.response.plaintextHash,
        },
      };
    },
  };
}
