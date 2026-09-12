/**
 * One Daily evaluation plan per process, shared by the prompt function, the
 * test generator, and the hard-gate assertion.
 *
 * The plan is not built here. It comes from the repository's own fresh
 * evaluation harness, so promptfoo sends exactly the claims that harness
 * sends: the same six synthetic profiles, the same compiled pin, the same
 * `buildResponsesRequest` body converted through the same Codex contract.
 * A second definition of the claim would be a second definition of what the
 * product sends, and the copy that drifted would be the one nobody ran.
 *
 * Loading the harness imports the API services and the runner through tsx,
 * which is why the repository root's `npm ci` must have run first.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareFreshReadingEvaluation } from "../../../scripts/pattern-release/fresh-reading-evaluation.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Content-free source identity for test metadata: commit plus a dirty flag. */
export function sourceIdentity() {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" }).trim().length > 0;
    return { sha, dirty };
  } catch {
    return { sha: null, dirty: null };
  }
}

let planPromise;

/**
 * @returns {Promise<{
 *   pin: Record<string, unknown>,
 *   corpus_version: string,
 *   cases: Map<string, { id: string, shape: string, prepared: unknown, claim: Record<string, unknown> }>,
 *   source: { sha: string | null, dirty: boolean | null },
 * }>}
 */
export function loadDailyPlan() {
  planPromise ??= (async () => {
    const plan = await prepareFreshReadingEvaluation();
    return {
      pin: plan.pin,
      corpus_version: plan.corpus_version,
      cases: new Map(plan.cases.map((entry) => [entry.id, entry])),
      source: sourceIdentity(),
    };
  })();
  return planPromise;
}
