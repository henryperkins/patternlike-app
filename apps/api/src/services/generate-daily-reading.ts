import {
  ASSEMBLY_POLICY_ID,
  ASSEMBLY_POLICY_VERSION,
  assembleReading,
  finalizeReading,
  renderAssemblyId,
  type ParagraphEvidence,
} from "@patternlike/reading-engine";
import {
  canonicalJson,
  contentHash,
  cycleHash,
  newId,
  sha256Hex,
  type NormalizedCycle,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import { asCryptoSubject } from "../crypto.js";
import { encryptPayload, type UserIdentity } from "../db/users.js";
import {
  completeReading,
  failReading,
  type Claim,
  type EvidenceRow,
} from "../db/generation.js";
import { loadReleaseBundle } from "./release-bundle.js";
import {
  buildAssemblyInput,
  type GenerateDailyReadingCommandV1,
} from "./generation-command.js";
import { isCommandV2 } from "./generation-command-v2.js";
import type { StoredReadingV3 } from "./stored-reading.js";

/**
 * Execute exactly the frozen reservation.
 *
 * Every dependency is dereferenced by the version the command pinned, never by
 * "active" or "latest". A release activation, a newer chart, a changed timezone,
 * a midnight rollover, or a fresh cycle scan cannot change a claimed job — and a
 * missing or hash-mismatched dependency fails closed rather than substituting
 * whatever is current.
 */

/**
 * What is stored inside `daily_readings.reading_enc` for a v3 reading.
 *
 * The prose plus every output-derived value capable of identifying the
 * deterministic result. M0 kept `content_hash`, the selected cycle ids, and the
 * validation detail in clear columns, where they were a dictionary oracle over
 * the day's facts: a digest of the day plus the two cycles that produced it is a
 * reconstruction path that survives DEK destruction. 0002 dropped those columns
 * and they live here instead.
 *
 * The declaration moved to `stored-reading.ts` when M5 made the stored envelope
 * a union; this alias keeps the v3 execution path reading the way it always did.
 */
export type { StoredReadingV3 as StoredReading };

export type ExecutionOutcome =
  | { ok: true; readingId: string; fallbackUsed: boolean }
  /** Another claim already committed this reading. Ack and move on. */
  | { ok: false; reason: "duplicate"; detail: string }
  /** Retryable: the dependency was down, not wrong. */
  | { ok: false; reason: "calc_unavailable" | "release_unreadable"; detail: string }
  /** Terminal: the frozen inputs no longer describe a reading we may publish. */
  | { ok: false; reason: ExecutionFailure; detail: string };

export type ExecutionFailure =
  | "policy_unsupported"
  | "chart_missing"
  | "release_hash_mismatch"
  | "cycle_missing"
  | "cycle_hash_mismatch"
  | "consent_revoked"
  | "assembly_id_mismatch"
  | "assembly_failed"
  | "publication_failed";

interface ChartRow {
  id: string;
  fingerprint: string;
  uncertainty_json: string;
}

/**
 * Old policy implementations are retained for at least the maximum job and lease
 * retry horizon. Until a second version exists this is a single-entry list, and
 * an unsupported frozen version fails closed rather than running the current one
 * — which would publish prose under an identity that promises different prose.
 */
const SUPPORTED_POLICIES = new Set([`${ASSEMBLY_POLICY_ID}@${ASSEMBLY_POLICY_VERSION}`]);

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
}

/** Load the exact cycles the command pinned, and prove each is the one scanned. */
async function loadPinnedCycles(
  env: Env,
  userId: string,
  command: GenerateDailyReadingCommandV1,
): Promise<
  { ok: true; cycles: NormalizedCycle[] } | { ok: false; reason: ExecutionFailure; detail: string }
> {
  const cycles: NormalizedCycle[] = [];
  for (const pin of command.cycle_scan.cycles) {
    const row = await env.DB.prepare(
      `SELECT cycle_json FROM cycle_instances WHERE id = ? AND user_id = ?`,
    )
      .bind(pin.cycle_id, userId)
      .first<{ cycle_json: string }>();
    if (!row) {
      return {
        ok: false,
        reason: "cycle_missing",
        detail: `pinned cycle ${pin.cycle_id} is not persisted`,
      };
    }
    let cycle: NormalizedCycle;
    try {
      cycle = JSON.parse(row.cycle_json) as NormalizedCycle;
      // A rescan that would change the envelope or the pass list fails the
      // claimed job closed rather than substituting the newer row.
      if ((await cycleHash(cycle)) !== pin.cycle_hash) {
        return {
          ok: false,
          reason: "cycle_hash_mismatch",
          detail: `pinned cycle ${pin.cycle_id} no longer hashes to the frozen value`,
        };
      }
    } catch {
      return {
        ok: false,
        reason: "cycle_hash_mismatch",
        detail: `pinned cycle ${pin.cycle_id} is not a valid normalized cycle`,
      };
    }
    cycles.push(cycle);
  }
  return { ok: true, cycles };
}

/**
 * Consent or permission revoked after enqueue cancels the job.
 *
 * It may NOT silently drop the frozen signal and assemble without it: the signal
 * is part of the assembly identity, so removing one would produce different
 * prose under an id that claims to be the same reading. A later
 * context-minimized reading uses the explicit next-generation replacement path.
 */
async function pinnedContextStillEligible(
  env: Env,
  userId: string,
  command: GenerateDailyReadingCommandV1,
): Promise<boolean> {
  for (const pin of command.context) {
    const row = await env.DB.prepare(
      `SELECT s.source_id, s.evidence_lane, s.allowed_uses_json,
              s.permission_state, s.conflict_status, s.freshness_status,
              s.normalized_hash, s.consent_id, c.status AS consent_status,
              c.version AS consent_version, c.source_id AS consent_source_id,
              c.allowed_uses_json AS consent_allowed_uses_json
       FROM context_signals s
       JOIN consents c ON c.id = s.consent_id AND c.user_id = s.user_id
       WHERE s.id = ? AND s.user_id = ?`,
    )
      .bind(pin.signal_id, userId)
      .first<{
        source_id: string;
        evidence_lane: string;
        allowed_uses_json: string;
        permission_state: string;
        conflict_status: string;
        freshness_status: string;
        normalized_hash: string;
        consent_id: string;
        consent_status: string;
        consent_version: number;
        consent_source_id: string | null;
        consent_allowed_uses_json: string;
      }>();
    let allowedUses: unknown = null;
    let consentAllowedUses: unknown = null;
    if (row) {
      try {
        allowedUses = JSON.parse(row.allowed_uses_json);
        consentAllowedUses = JSON.parse(row.consent_allowed_uses_json);
      } catch {
        return false;
      }
    }
    if (
      !row ||
      row.source_id !== pin.source_id ||
      row.evidence_lane !== pin.evidence_lane ||
      row.permission_state !== pin.permission_state ||
      row.conflict_status !== "none" ||
      row.freshness_status !== pin.freshness_status ||
      row.normalized_hash !== pin.normalized_hash ||
      row.consent_id !== pin.consent_id ||
      row.consent_status !== "granted" ||
      row.consent_version !== pin.consent_version ||
      row.consent_source_id !== pin.source_id ||
      !Array.isArray(allowedUses) ||
      !allowedUses.includes(pin.allowed_use) ||
      !Array.isArray(consentAllowedUses) ||
      !consentAllowedUses.includes(pin.allowed_use)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Route a claimed job to the executor its frozen command names.
 *
 * The discriminant is the command, never the current configuration: a claim
 * frozen as V1 executes as V1 forever, whatever the rollout says today. A
 * command version this deployment does not implement fails `policy_unsupported`
 * rather than running the executor it happens to have, which would publish prose
 * under an identity promising different prose.
 */
export async function dispatchGeneration(
  env: Env,
  claim: Claim,
): Promise<ExecutionOutcome> {
  if (isCommandV2(claim.command)) {
    return {
      ok: false,
      reason: "policy_unsupported",
      detail: "no registered implementation for command_version v2",
    };
  }
  return generateDailyReading(env, claim as Claim & { command: GenerateDailyReadingCommandV1 });
}

export async function generateDailyReading(
  env: Env,
  claim: Claim & { command: GenerateDailyReadingCommandV1 },
): Promise<ExecutionOutcome> {
  const { command, jobId, claimToken, userId } = claim;

  const subjectRow = await env.DB.prepare(
    `SELECT crypto_subject FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{ crypto_subject: string }>();
  if (!subjectRow) {
    return { ok: false, reason: "chart_missing", detail: "user no longer exists" };
  }
  const identity: UserIdentity = {
    userId,
    cryptoSubject: asCryptoSubject(subjectRow.crypto_subject),
  };

  const fail = async (
    reason: ExecutionFailure | "calc_unavailable" | "release_unreadable",
    detail: string,
  ): Promise<ExecutionOutcome> => {
    const failed = await failReading(
      env,
      identity,
      command.reading_id,
      jobId,
      claimToken,
      reason,
    );
    if (!failed.ok) {
      if (failed.reason === "stale_claim") {
        return { ok: false, reason: "duplicate", detail: failed.detail };
      }
      throw new Error(`failure transition did not commit: ${failed.detail}`);
    }
    return { ok: false, reason, detail } as ExecutionOutcome;
  };

  if (
    !SUPPORTED_POLICIES.has(
      `${command.assembly_policy_id}@${command.assembly_policy_version}`,
    )
  ) {
    return fail(
      "policy_unsupported",
      `no registered implementation for ${command.assembly_policy_id}@${command.assembly_policy_version}`,
    );
  }

  const chart = await env.DB.prepare(
    `SELECT id, fingerprint, uncertainty_json FROM chart_snapshots
     WHERE id = ? AND user_id = ?`,
  )
    .bind(command.chart.snapshot_id, userId)
    .first<ChartRow>();
  if (!chart || chart.fingerprint !== command.chart.fingerprint) {
    return fail(
      "chart_missing",
      `pinned chart ${command.chart.snapshot_id} is missing or its fingerprint moved`,
    );
  }

  const release = await loadReleaseBundle(
    env,
    command.release_version,
    command.release_bundle_hash,
  );
  if (!release.ok) {
    // `release_unreadable` is infrastructural and re-freezable; a hash mismatch
    // means the bytes are there and are not the bytes that were approved.
    return release.reason === "release_unreadable"
      ? { ok: false, reason: "release_unreadable", detail: release.detail }
      : fail("release_hash_mismatch", release.detail);
  }

  const pinned = await loadPinnedCycles(env, userId, command);
  if (!pinned.ok) return fail(pinned.reason, pinned.detail);

  if (!(await pinnedContextStillEligible(env, userId, command))) {
    return fail(
      "consent_revoked",
      "a pinned context signal is no longer eligible under the state it was frozen with",
    );
  }

  // Rebuilt through the same constructor the enqueuer used. A second copy of
  // this shape would be a second definition of what a reading is.
  const input = buildAssemblyInput({
    readingId: command.reading_id,
    revision: command.revision,
    localDate: command.target_local_date,
    targetTimezone: command.target_timezone,
    generationAnchor: command.generation_anchor,
    dayStartAt: command.day_start_at,
    dayEndAt: command.day_end_at,
    fingerprint: command.chart.fingerprint,
    effectiveAccuracy: command.chart.effective_accuracy,
    // The command's frozen projection, not the row's. The chart row is consulted
    // only to prove the pinned snapshot still exists; an uncertainty report
    // edited after enqueue must not change what a claimed job assembles.
    uncertainty: command.chart.uncertainty,
    cycles: pinned.cycles,
    release: release.verified,
    context: command.context.map((pin) => ({
      signal_id: pin.signal_id,
      source_id: pin.source_id,
      allowed_use: pin.allowed_use,
      evidence_lane: pin.evidence_lane as "celestial_facts" | "user_and_context" | "operational",
      normalized_hash: pin.normalized_hash,
      permission_state: pin.permission_state as "active",
      freshness_status: pin.freshness_status as "fresh",
    })),
    locale: command.locale,
    domainPreference: command.domain_preference as null,
  });

  let outcome: ReturnType<typeof assembleReading>;
  try {
    outcome = assembleReading(input);
  } catch (err) {
    return fail("assembly_failed", err instanceof Error ? err.message : "assembly threw");
  }

  const assemblyId = renderAssemblyId(await sha256Hex(outcome.identity_canonical));
  if (assemblyId !== command.assembly_id) {
    // A mismatch is a defect, not a new reading: the pure assembler is supposed
    // to receive the same values on every retry.
    return fail(
      "assembly_id_mismatch",
      `assembly reproduced ${assemblyId}, command froze ${command.assembly_id}`,
    );
  }

  const paragraphTextHashes: Record<string, string> = {};
  for (const paragraph of outcome.reading.paragraphs) {
    paragraphTextHashes[paragraph.paragraph_id] = await contentHash(paragraph.text);
  }
  const evidence = finalizeReading(outcome, {
    assembly_id: assemblyId,
    paragraph_text_hashes: paragraphTextHashes,
  });

  const { paragraphs, ...evidenceHeader } = evidence;
  const stored: StoredReadingV3 = {
    reading: outcome.reading,
    assembly_id: assemblyId,
    content_hash: await contentHash(canonicalJson(outcome.reading)),
    primary_cycle_id: evidence.primary_theme?.cycle_id ?? null,
    supporting_cycle_id: evidence.supporting_theme?.cycle_id ?? null,
    validation: evidence.validation,
    evidence_header: evidenceHeader,
  };

  const sealedReading = await encryptPayload(env, identity, stored, {
    subject: identity.cryptoSubject,
    field: "daily_readings.reading_enc",
    recordId: command.reading_id,
  });

  const evidenceRows: EvidenceRow[] = [];
  for (const paragraph of paragraphs as ParagraphEvidence[]) {
    const rowId = newId("rsc");
    const sealed = await encryptPayload(env, identity, paragraph, {
      subject: identity.cryptoSubject,
      field: "reading_sources.evidence_enc",
      recordId: rowId,
    });
    evidenceRows.push({
      id: rowId,
      paragraphId: paragraph.paragraph_id,
      paragraphOrder: paragraph.order,
      ciphertext: bytes(sealed.ciphertext),
      keyVersion: sealed.keyVersion,
      nonce: sealed.nonce,
    });
  }

  const published = await completeReading(env, {
    identity,
    readingId: command.reading_id,
    jobId,
    claimToken,
    commandGeneration: command.command_generation,
    // V1 has one predecessor rule: an ordinary reissue leaves the live reading
    // published until its successor commits. The invalidation path is a v5
    // concept and cannot reach this executor.
    predecessor: command.supersedes_reading_id
      ? { kind: "supersede_published", readingId: command.supersedes_reading_id }
      : { kind: "none" },
    reading: {
      ciphertext: bytes(sealedReading.ciphertext),
      keyVersion: sealedReading.keyVersion,
      nonce: sealedReading.nonce,
    },
    evidence: evidenceRows,
  });

  if (!published.ok) {
    if (published.reason === "stale_claim") {
      // A loser in a completion race. Another claim already committed; do not
      // touch the reservation, which is no longer this attempt's to move.
      return { ok: false, reason: "duplicate", detail: published.detail };
    }
    return fail("publication_failed", published.detail);
  }

  return {
    ok: true,
    readingId: command.reading_id,
    fallbackUsed: outcome.reading.fallback_used,
  };
}
