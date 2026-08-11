/**
 * The live corpus gate: send the synthetic profiles to the real provider and
 * score whatever comes back.
 *
 * A production gate, not a test. The rollout runbook requires a passing report
 * before initial internal enablement and again before every later model,
 * prompt, selection-policy, or validation-policy change; the single synthetic
 * canary does not substitute for it. Running it against a real key is
 * separately authorized — the file is written, typechecked, and never invoked
 * by CI.
 *
 *   OPENAI_API_KEY=sk-... npm run publisher:eval:live -w @patternlike/api
 *
 * It reads the checked-in synthetic corpus and nothing else: no D1, no account,
 * no birth data, no production configuration. The profiles are invented people,
 * which is what makes pointing this at a real key safe.
 *
 * It prints ids, verdicts, counts, and failure CODES. It never prints the
 * prompt, the candidate prose, the context, or the key — the same rule the
 * Worker's own logs follow, and the reason the output can be pasted into a
 * rollout record.
 *
 * Exit codes: 0 all profiles produced a publishable candidate; 1 at least one
 * did not, or a qualitative threshold regressed; 2 the lane could not run.
 */

import process from "node:process";

import { validateReadingCandidate } from "@patternlike/reading-engine";
import type { ReadingGenerationOutput } from "@patternlike/shared";

import {
  EVALUATION_POLICY_VERSION,
  loadEvaluationCorpus,
  prepareProfile,
  qualitativeFindings,
  type EvaluationCorpus,
} from "../src/services/reading-evaluation.js";
import { buildResponsesRequest, READING_PROMPT_VERSION } from "../src/services/reading-prompt.js";
import {
  OPENAI_READING_MAX_OUTPUT_TOKENS,
  OPENAI_READING_MODEL,
  OPENAI_READING_REASONING,
  OPENAI_READING_TIMEOUT_MS,
  OPENAI_RESPONSES_URL,
  READING_CONTEXT_MAX_BYTES,
  READING_PUBLISHER_PROVIDER,
} from "../src/services/reading-publisher.js";

/**
 * Every synthetic profile must publish. One refusal fails the gate.
 *
 * Deliberately 100%, and the runbook's stop condition says the same. The corpus
 * is six profiles, each chosen to be publishable: a refusal is not the model
 * being nondeterministic at the margin, it is one of the six shapes this
 * deployment cannot serve — found immediately before enabling paid autonomous
 * generation, which is the one moment it is cheap to find.
 */
const MIN_PUBLISHABLE_RATE = 1;

/** Qualitative findings tolerated across the whole corpus before the gate fails. */
const MAX_QUALITATIVE_FINDINGS = 2;

interface ProfileOutcome {
  profile: string;
  published: boolean;
  codes: string[];
  qualitative: string[];
  input_tokens: number;
  output_tokens: number;
}

function extractCandidate(body: unknown): ReadingGenerationOutput | null {
  // The Responses API returns the structured object as text on the first
  // message content part. Parsed here rather than in the adapter because the
  // adapter belongs to the Worker and this lane must not import a Worker-only
  // module graph.
  const output = (body as { output?: unknown })?.output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text !== "string") continue;
      try {
        return JSON.parse(text) as ReadingGenerationOutput;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function usage(body: unknown, key: "input_tokens" | "output_tokens"): number {
  const value = (body as { usage?: Record<string, unknown> })?.usage?.[key];
  return typeof value === "number" ? value : 0;
}

async function runProfile(
  corpus: EvaluationCorpus,
  profileId: string,
  apiKey: string,
): Promise<ProfileOutcome> {
  const prepared = prepareProfile(corpus, profileId);
  // The same pin the Worker would freeze into a command, built from the same
  // deployed constants. A pin invented here would evaluate a configuration
  // nothing ships.
  const request = buildResponsesRequest(prepared.request, {
    provider: READING_PUBLISHER_PROVIDER,
    model: OPENAI_READING_MODEL,
    reasoning_effort: OPENAI_READING_REASONING,
    prompt_version: READING_PROMPT_VERSION,
    output_schema: "daily-reading-v5",
    selection_policy_version: corpus.gates.selection_policy_version,
    validation_policy_version: corpus.gates.validation_policy_version,
    max_output_tokens: OPENAI_READING_MAX_OUTPUT_TOKENS,
    context_max_bytes: READING_CONTEXT_MAX_BYTES,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_READING_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        profile: profileId,
        published: false,
        // The status only. A provider error body can quote the request back.
        codes: [`transport.http_${response.status}`],
        qualitative: [],
        input_tokens: 0,
        output_tokens: 0,
      };
    }
    body = await response.json();
  } catch {
    return {
      profile: profileId,
      published: false,
      codes: ["transport.unreachable"],
      qualitative: [],
      input_tokens: 0,
      output_tokens: 0,
    };
  } finally {
    clearTimeout(timer);
  }

  const candidate = extractCandidate(body);
  if (!candidate) {
    return {
      profile: profileId,
      published: false,
      codes: ["schema_shape.unparseable"],
      qualitative: [],
      input_tokens: usage(body, "input_tokens"),
      output_tokens: usage(body, "output_tokens"),
    };
  }

  const validation = validateReadingCandidate(candidate, prepared);
  return {
    profile: profileId,
    published: validation.ok,
    codes: validation.ok
      ? []
      : validation.failures.map((failure) => `${failure.code}.${failure.detail_code}`),
    qualitative: qualitativeFindings(prepared, candidate),
    input_tokens: usage(body, "input_tokens"),
    output_tokens: usage(body, "output_tokens"),
  };
}

async function main(): Promise<number> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("FAIL  OPENAI_API_KEY is not set");
    return 2;
  }

  const corpus = loadEvaluationCorpus();
  if (corpus.gates.model !== OPENAI_READING_MODEL) {
    console.error(
      `FAIL  corpus gates name ${corpus.gates.model}; this deployment is configured for ${OPENAI_READING_MODEL}`,
    );
    console.error("      Re-run the corpus, increment corpus_version, and update its gates.");
    return 2;
  }
  if (
    corpus.gates.prompt_version !== READING_PROMPT_VERSION ||
    corpus.gates.evaluation_policy_version !== EVALUATION_POLICY_VERSION
  ) {
    console.error("FAIL  corpus gates do not match the deployed prompt/evaluation versions");
    return 2;
  }

  const profileIds = Object.keys(corpus.profiles);
  console.log(`corpus ${corpus.corpus_version}  model ${corpus.gates.model}`);
  console.log(`prompt ${corpus.gates.prompt_version}  profiles ${profileIds.length}`);

  const outcomes: ProfileOutcome[] = [];
  for (const profileId of profileIds) {
    // Sequential on purpose: this lane exists to answer a quality question, not
    // to load-test the account, and one profile at a time keeps a rate-limit
    // response from being mistaken for a quality regression.
    const outcome = await runProfile(corpus, profileId, apiKey);
    outcomes.push(outcome);
    console.log(
      `  ${outcome.published ? "PASS" : "FAIL"}  ${outcome.profile}` +
        `  in=${outcome.input_tokens} out=${outcome.output_tokens}` +
        (outcome.codes.length ? `  ${outcome.codes.join(",")}` : "") +
        (outcome.qualitative.length ? `  ~${outcome.qualitative.join(",")}` : ""),
    );
  }

  const published = outcomes.filter((outcome) => outcome.published).length;
  const rate = published / outcomes.length;
  const qualitativeTotal = outcomes.reduce(
    (total, outcome) => total + outcome.qualitative.length,
    0,
  );
  const inputTokens = outcomes.reduce((total, outcome) => total + outcome.input_tokens, 0);
  const outputTokens = outcomes.reduce((total, outcome) => total + outcome.output_tokens, 0);

  console.log("");
  console.log(`published ${published}/${outcomes.length}  qualitative findings ${qualitativeTotal}`);
  console.log(`tokens in=${inputTokens} out=${outputTokens}`);

  if (rate < MIN_PUBLISHABLE_RATE) {
    console.error(`FAIL  publishable rate ${rate.toFixed(2)} below ${MIN_PUBLISHABLE_RATE}`);
    return 1;
  }
  if (qualitativeTotal > MAX_QUALITATIVE_FINDINGS) {
    console.error(
      `FAIL  ${qualitativeTotal} qualitative findings exceeds the ${MAX_QUALITATIVE_FINDINGS} allowed`,
    );
    return 1;
  }

  console.log("PASS  corpus gate satisfied");
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    // No error object printed: a thrown provider error can carry the request.
    console.error("FAIL  the evaluation lane did not complete");
    process.exitCode = 2;
  },
);
