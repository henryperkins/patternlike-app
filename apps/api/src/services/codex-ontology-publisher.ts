import { canonicalJson, contentHash } from "@patternlike/shared";

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
import type {
  OntologyEvaluatorPacket,
  OntologyGeneratorPacket,
} from "./ontology-packet.js";
import {
  buildOntologyEvaluatorResponsesRequest,
  buildOntologyGeneratorResponsesRequest,
  isOntologyGenerationChunk,
  isOntologyRuleVerdict,
} from "./ontology-prompt.js";
import type {
  OntologyGenerationChunk,
  OntologyPassOptions,
  OntologyPassOutcome,
  OntologyProviderPass,
  OntologyPublisher,
  OntologyRuleVerdict,
} from "./ontology-publisher.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});

function unavailable<T>(): OntologyPassOutcome<T> {
  return {
    ok: false,
    code: "publisher_unavailable",
    safe_detail_code: "network_error",
    retry_after_seconds: null,
    origin_layer: "none",
  };
}

function invalid<T>(): OntologyPassOutcome<T> {
  return {
    ok: false,
    code: "publisher_output_invalid",
    safe_detail_code: "schema_mismatch",
    retry_after_seconds: null,
    origin_layer: "none",
  };
}

export function createCodexOntologyPublisher(
  env: Pick<Env, "DB" | "ARTIFACTS" | "CODEX_PROVIDER_ARTIFACT_KEYRING">,
): OntologyPublisher {
  async function run<T>(input: {
    pass: OntologyProviderPass;
    body: unknown;
    options: OntologyPassOptions;
    guard: (value: unknown) => value is T;
    expectedRuleId?: string;
  }): Promise<OntologyPassOutcome<T>> {
    const coordinate = input.options.codexJob;
    if (!coordinate || input.options.timeoutMs !== CODEX_PROVIDER_TIMEOUT_MS) {
      return unavailable<T>();
    }
    const requestBody = canonicalJson(input.body);
    if (
      input.options.requestBody !== undefined &&
      input.options.requestBody !== requestBody
    ) {
      return invalid<T>();
    }
    const model = input.pass === "generator"
      ? input.options.configuration.generator_model
      : input.options.configuration.evaluator_model;
    const promptVersion = input.pass === "generator"
      ? input.options.configuration.generator_prompt_version
      : input.options.configuration.evaluator_prompt_version;
    const invocation = invocationFromResponsesRequest(input.body, {
      model,
      reasoningEffort: "high",
    });
    if (!invocation.ok) return unavailable<T>();
    const serialized = canonicalJson(invocation.value);
    const plaintextHash = await contentHash(serialized);
    const jobId = await codexProviderJobId({
      pipeline: "ontology",
      ownerId: coordinate.ownerId,
      pass: input.pass,
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
          pipeline: "ontology",
          ownerId: coordinate.ownerId,
          pass: input.pass,
          stageGeneration: coordinate.stageGeneration,
          stageAttempt: coordinate.stageAttempt,
          role: "request",
        },
        textEncoder.encode(serialized),
      );
      job = (await enqueueCodexProviderJob(
        env,
        {
          pipeline: "ontology",
          ownerId: coordinate.ownerId,
          userId: null,
          pass: input.pass,
          stageGeneration: coordinate.stageGeneration,
          stageAttempt: coordinate.stageAttempt,
          request: request.artifact,
          model,
          reasoningEffort: "high",
          promptVersion,
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
    if (job.status !== "completed" || !job.response) return unavailable<T>();

    let raw: string;
    let parsed: unknown;
    try {
      raw = textDecoder.decode(await readCodexProviderArtifact(
        env,
        {
          jobId: job.id,
          pipeline: "ontology",
          ownerId: coordinate.ownerId,
          pass: input.pass,
          stageGeneration: coordinate.stageGeneration,
          stageAttempt: coordinate.stageAttempt,
          role: "response",
        },
        job.response,
      ));
      parsed = JSON.parse(raw);
    } catch {
      return invalid<T>();
    }
    if (
      !input.guard(parsed) ||
      (input.expectedRuleId !== undefined &&
        (parsed as OntologyRuleVerdict).rule_id !== input.expectedRuleId) ||
      !job.providerRequestId ||
      job.inputTokens === null ||
      job.outputTokens === null
    ) {
      return invalid<T>();
    }
    return {
      ok: true,
      value: parsed,
      raw,
      metadata: {
        provider: "codex",
        pass: input.pass,
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
    generate(packet: OntologyGeneratorPacket, options: OntologyPassOptions) {
      return run<OntologyGenerationChunk>({
        pass: "generator",
        body: buildOntologyGeneratorResponsesRequest(
          packet.serialized,
          options.configuration,
        ),
        options,
        guard: isOntologyGenerationChunk,
      });
    },
    evaluate(packet: OntologyEvaluatorPacket, options: OntologyPassOptions) {
      return run<OntologyRuleVerdict>({
        pass: "evaluator",
        body: buildOntologyEvaluatorResponsesRequest(
          packet.serialized,
          options.configuration,
        ),
        options,
        guard: isOntologyRuleVerdict,
        expectedRuleId: packet.document.rule.id,
      });
    },
  };
}
