/**
 * promptfoo provider that executes a prepared codex-provider claim through
 * the runner's isolated Codex JSON transport: `runCodexInvocation` in
 * `apps/codex-runner/src/codex-cli.ts`.
 *
 * That transport is the production path. It requires a ChatGPT login, refuses
 * a host with nonempty Codex instruction files, verifies that every inherited
 * MCP server is disabled and that the tool and feature state is the isolated
 * one, starts a fresh process per call, enforces the output schema, and owns
 * its own 900-second timeout. None of that is reimplemented or relaxed here.
 *
 * promptfoo's abort signal (its evaluation timeout, or an interrupted run) is
 * forwarded as the transport's `signal`, which terminates the Codex process
 * instead of letting an xhigh turn run on after promptfoo stopped waiting for
 * it. An aborted call reports `aborted` rather than the transport's failure
 * code, which would otherwise read as an output defect.
 *
 * The prompt this provider receives is the serialized claim built by
 * `prompts/daily-claim.mjs`. It is not a template and contains no vars.
 *
 * Configuration: `config.codexBin`, else the `CODEX_BIN` environment
 * variable, else `codex` on PATH. Run with `-j 1`: the runner executes one
 * claim at a time against one login.
 */
import { tsImport } from "tsx/esm/api";

const CLAIM_SCHEMA_VERSION = "codex-provider-claim/v1";

let runnerPromise;
const loadRunner = () => {
  runnerPromise ??= tsImport("../../../apps/codex-runner/src/codex-cli.ts", import.meta.url);
  return runnerPromise;
};

export default class CodexIsolatedProvider {
  constructor(options = {}) {
    this.providerId = options.id ?? "codex-isolated";
    this.config = options.config ?? {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, _context, options = {}) {
    let claim;
    try {
      claim = JSON.parse(prompt);
    } catch {
      return { error: "prompt_not_a_claim" };
    }
    if (claim?.schema_version !== CLAIM_SCHEMA_VERSION) return { error: "prompt_not_a_claim" };

    const pins = {
      transport: "codex-isolated",
      model: claim.model,
      reasoning_effort: claim.reasoning_effort,
      prompt_version: claim.prompt_version,
    };
    const signal = options?.abortSignal;
    if (signal?.aborted) return { error: "aborted", metadata: { ...pins, aborted: true } };

    const codexBin = this.config.codexBin ?? process.env.CODEX_BIN ?? "codex";
    const runner = await loadRunner();
    const result = await runner.runCodexInvocation({ claim, codexBin, signal });
    if (!result.ok) {
      // The transport reports an abort as an ordinary failure code; name it instead.
      if (signal?.aborted) return { error: "aborted", metadata: { ...pins, aborted: true } };
      // Closed safe codes only; the transport never returns raw provider text on failure.
      return { error: `${result.code}/${result.safeDetailCode}`, metadata: { ...pins, fatal: result.fatal === true } };
    }
    return {
      output: result.output,
      tokenUsage: {
        prompt: result.inputTokens,
        completion: result.outputTokens,
        total: result.inputTokens + result.outputTokens,
      },
      metadata: { ...pins, provider_request_id: result.providerRequestId },
    };
  }
}
