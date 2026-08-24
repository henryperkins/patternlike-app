import { canonicalJson } from "@patternlike/shared";

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
import { buildPatternResponsesRequest } from "./pattern-prompt.js";
import {
  PATTERN_PUBLISHER_CODEX,
  type PatternPassOptions,
  type PatternPassOutcome,
  type PatternPublisher,
  type PatternStageClass,
} from "./pattern-publisher.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});

function unavailable<T>(): PatternPassOutcome<T> {
  return {
    ok: false,
    code: "publisher_unavailable",
    safe_detail_code: "network_error",
    retry_after_seconds: null,
    origin_layer: "none",
  };
}

export function createCodexPatternPublisher(
  env: Pick<Env, "DB" | "ARTIFACTS" | "CODEX_PROVIDER_ARTIFACT_KEYRING">,
): PatternPublisher {
  async function run<T>(
    pass: PatternStageClass,
    input: unknown,
    options: PatternPassOptions,
    correction = false,
  ): Promise<PatternPassOutcome<T>> {
    const coordinate = options.codexJob;
    if (!coordinate || options.timeoutMs !== CODEX_PROVIDER_TIMEOUT_MS) {
      return unavailable<T>();
    }
    const body = buildPatternResponsesRequest(
      pass,
      input,
      options.pin,
      { correction },
    );
    const converted = invocationFromResponsesRequest(body, {
      model: options.pin[`${pass}_model`],
      reasoningEffort: "high",
    });
    if (!converted.ok) return unavailable<T>();
    const serialized = canonicalJson(converted.value);
    const requestHash = await crypto.subtle.digest(
      "SHA-256",
      textEncoder.encode(serialized),
    );
    const requestHashHex = [...new Uint8Array(requestHash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const plaintextHash = `sha256:${requestHashHex}`;
    const jobId = await codexProviderJobId({
      pipeline: coordinate.pipeline,
      ownerId: coordinate.ownerId,
      pass,
      stageGeneration: coordinate.stageGeneration,
      stageAttempt: coordinate.stageAttempt,
      requestHash: plaintextHash,
    });

    let job;
    try {
      const request = await putCodexProviderArtifact(
        env,
        {
          jobId,
          pipeline: coordinate.pipeline,
          ownerId: coordinate.ownerId,
          pass,
          stageGeneration: coordinate.stageGeneration,
          stageAttempt: coordinate.stageAttempt,
          role: "request",
        },
        textEncoder.encode(serialized),
      );
      job = (await enqueueCodexProviderJob(
        env,
        {
          pipeline: coordinate.pipeline,
          ownerId: coordinate.ownerId,
          userId: coordinate.userId,
          pass,
          stageGeneration: coordinate.stageGeneration,
          stageAttempt: coordinate.stageAttempt,
          request: request.artifact,
          model: options.pin[`${pass}_model`],
          reasoningEffort: "high",
          promptVersion: options.pin[`${pass}_prompt_version`],
          timeoutMs: CODEX_PROVIDER_TIMEOUT_MS,
          dailyCallLimit: coordinate.dailyCallLimit,
        },
        new Date(),
      )).job;
    } catch {
      return unavailable<T>();
    }

    if (job.status === "pending" || job.status === "leased") {
      return { ok: false, code: "publisher_pending", job_id: job.id };
    }
    if (job.status === "failed") {
      if (!job.failureCode || !job.safeDetailCode) return unavailable<T>();
      return {
        ok: false,
        code: job.failureCode,
        safe_detail_code: job.safeDetailCode,
        retry_after_seconds: null,
        origin_layer: "none",
      };
    }
    if (job.status !== "completed" || !job.response) {
      return unavailable<T>();
    }

    let raw: string;
    let parsed: unknown;
    try {
      raw = textDecoder.decode(await readCodexProviderArtifact(
        env,
        {
          jobId: job.id,
          pipeline: coordinate.pipeline,
          ownerId: coordinate.ownerId,
          pass,
          stageGeneration: coordinate.stageGeneration,
          stageAttempt: coordinate.stageAttempt,
          role: "response",
        },
        job.response,
      ));
      parsed = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        code: "publisher_output_invalid",
        safe_detail_code: "invalid_json",
        retry_after_seconds: null,
        origin_layer: "none",
      };
    }
    if (
      !job.providerRequestId ||
      job.inputTokens === null ||
      job.outputTokens === null
    ) {
      return unavailable<T>();
    }
    return {
      ok: true,
      value: parsed as T,
      raw,
      metadata: {
        provider: PATTERN_PUBLISHER_CODEX,
        pass,
        model: job.model,
        prompt_version: job.promptVersion,
        provider_request_id: job.providerRequestId,
        input_tokens: job.inputTokens,
        output_tokens: job.outputTokens,
        provider_response_hash: job.response.plaintextHash,
      },
    };
  }

  return {
    plan: (input, options) => run("planner", input, options),
    write: (input, options) => run(
      "writer",
      input,
      options,
      !!input && typeof input === "object" && !Array.isArray(input) &&
        "correction" in input,
    ),
    verify: (input, options) => run("verifier", input, options),
  };
}
