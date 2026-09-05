/**
 * Who a Daily Codex provider job still belongs to — decided read-only.
 *
 * The Codex runner lives outside this Worker and asks about work whose owner
 * may have moved on: the reader may have revoked AI-synthesis consent, deleted
 * their account, had their chart recalculated, or simply had the command
 * replaced by a later generation. Every one of those has to be able to stop a
 * provider call, and none of them may be answered by consuming a Daily attempt
 * to find out.
 *
 * So this module reads and compares. It takes no lease, writes no column, and
 * copies nothing out of the encrypted command: the consent id, the pinned
 * context, and the frozen calculation digests stay inside the envelope, and the
 * comparison happens against values already in memory.
 */

import type { Env } from "../env.js";
import type { CodexProviderJob } from "../db/codex-provider-jobs.js";
import { loadDailyJobSnapshot } from "../db/generation.js";
import { loadAiSynthesisGrant } from "../db/consents.js";
import {
  isCommandV2,
  type GenerateDailyReadingCommandV2,
} from "./generation-command-v2.js";
import { resolvePublisherConfiguration } from "./reading-publisher.js";
import { isCodexProviderReasoningEffort } from "./codex-provider-contract.js";

export interface CurrentDailyOwner {
  jobId: string;
  userId: string;
  readingId: string;
  attempts: number;
  command: GenerateDailyReadingCommandV2;
}

/**
 * The live AI-synthesis grant, compared field by field to what the command
 * froze.
 *
 * Extracted so execution and provider admission cannot disagree. A grant that
 * was revoked and re-granted is a DIFFERENT consent id, and a command frozen
 * under the old one must not run: the reader agreed again, but they agreed to
 * the policy in front of them at that moment, and the frozen command records
 * which one that was.
 *
 * Category order is compared, not just membership. The consent screen lists
 * them in a fixed display order, and a grant that reordered them is not the
 * grant the reader read.
 */
export async function currentAiConsentMatches(
  env: Env,
  userId: string,
  command: GenerateDailyReadingCommandV2,
): Promise<boolean> {
  const grant = await loadAiSynthesisGrant(env, userId);
  return (
    grant !== null &&
    grant.consentId === command.ai_consent.consent_id &&
    grant.policyVersion === command.ai_consent.policy_version &&
    grant.categories.length === command.ai_consent.categories.length &&
    grant.categories.every(
      (category, index) => category === command.ai_consent.categories[index],
    )
  );
}

/**
 * The generic Daily job, its reservation, and its frozen V2 command — or null.
 *
 * Null means "not a current owner", never "something went wrong". A missing
 * job, a terminal one, a reading that is no longer pending, an inactive
 * account, an undecryptable payload, and a V1 command are all the same answer
 * to the only question a provider caller is allowed to ask.
 */
export async function loadCurrentDailyOwner(
  env: Env,
  jobId: string,
): Promise<CurrentDailyOwner | null> {
  const snapshot = await loadDailyJobSnapshot(env, jobId);
  if (!snapshot || !isCommandV2(snapshot.command)) return null;
  return {
    jobId: snapshot.jobId,
    userId: snapshot.userId,
    readingId: snapshot.readingId,
    attempts: snapshot.attempts,
    command: snapshot.command,
  };
}

/**
 * Whether this deployment can still execute the frozen publisher pin.
 * Legacy high reasoning stays executable at its original effort when new
 * commands move to xhigh; the provider job must match that frozen effort.
 *
 * The whole pin, not just the model string. A command that named the right
 * model under a different prompt version, a different selection or validation
 * policy, a different output ceiling, or a different context ceiling describes
 * prose this deployment no longer produces, and executing it would publish
 * under an identity that promises something else.
 */
function publisherPinIsCurrent(
  env: Env,
  job: CodexProviderJob,
  command: GenerateDailyReadingCommandV2,
): boolean {
  const resolved = resolvePublisherConfiguration(env);
  // `config` is null exactly when the rollout is off, which is the kill switch
  // doing its job: no provider work may proceed under it.
  if (!resolved.ok || !resolved.config) return false;
  const pin = resolved.config.pin;
  const frozen = command.publisher;
  return (
    frozen.provider === pin.provider &&
    frozen.model === pin.model &&
    isCodexProviderReasoningEffort(frozen.reasoning_effort) &&
    frozen.prompt_version === pin.prompt_version &&
    frozen.output_schema === pin.output_schema &&
    frozen.selection_policy_version === pin.selection_policy_version &&
    frozen.validation_policy_version === pin.validation_policy_version &&
    frozen.max_output_tokens === pin.max_output_tokens &&
    frozen.context_max_bytes === pin.context_max_bytes &&
    // The provider job's own copy of the pin has to agree too. It is what the
    // runner was handed, and a job whose model or deadline drifted from the
    // command is not executing the command it claims to.
    job.model === frozen.model &&
    job.promptVersion === frozen.prompt_version &&
    job.reasoningEffort === frozen.reasoning_effort &&
    job.timeoutMs === resolved.config.timeoutMs &&
    job.dailyCallLimit === resolved.config.dailyCallLimit
  );
}

/**
 * Whether a `reading`/`publisher` provider job still has a live Daily owner.
 *
 * `stageAttempt === attempts - 1` is the load-bearing equality. `jobs.attempts`
 * counts actual Daily attempts starting at 1; the provider coordinate is
 * zero-based. A duplicate Queue delivery that reacquires the same pending job
 * therefore lands on the same provider coordinate and adopts, while a genuine
 * retry increments `attempts` and creates the next one. Comparing anything
 * looser would let a stale runner lease publish into a newer attempt.
 */
export async function readingProviderOwnerIsCurrent(
  env: Env,
  job: CodexProviderJob,
  // Accepted for signature parity with the Pattern and ontology predicates the
  // shared dispatcher calls. Nothing here is time-dependent: the Daily grant is
  // an append-only chain whose latest row is the answer, and the provider
  // lease's own expiry is the D1 layer's business.
  _now: Date = new Date(),
): Promise<boolean> {
  if (job.pipeline !== "reading" || job.pass !== "publisher") return false;
  const owner = await loadCurrentDailyOwner(env, job.ownerId);
  if (
    !owner ||
    job.ownerId !== owner.jobId ||
    job.userId !== owner.userId ||
    job.stageGeneration !== owner.command.command_generation ||
    job.stageAttempt !== owner.attempts - 1 ||
    // A frozen OpenAI command must never be executed through Codex: doing so
    // would publish prose whose own pin says a different service wrote it.
    owner.command.publisher.provider !== "codex" ||
    !publisherPinIsCurrent(env, job, owner.command)
  ) {
    return false;
  }
  return await currentAiConsentMatches(env, owner.userId, owner.command);
}
