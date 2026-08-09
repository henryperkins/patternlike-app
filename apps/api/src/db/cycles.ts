import {
  CYCLE_POLICY_VERSION,
  cycleHash,
  cyclePassId,
  type NormalizedCycle,
} from "@patternlike/shared";
import type { Env } from "../env.js";

const PERSIST_BATCH_SIZE = 100;

/** What a generation command needs to pin one scanned cycle. */
export interface PersistedCycle {
  cycleId: string;
  /** Chronological, one per pass, index-aligned with `cycle.passes`. */
  passIds: string[];
  /** Full 64-character digest of the normalized cycle as scanned. */
  hash: string;
}

/**
 * Derive the ids and hash for one scanned cycle without touching the database.
 *
 * Separate from persistence because the executor needs the same values to
 * re-verify a frozen command against a fresh scan, and re-deriving them through
 * a write path would be both slower and a licence to write on a read.
 */
export async function deriveCycle(cycle: NormalizedCycle): Promise<PersistedCycle> {
  const passIds = await Promise.all(
    cycle.passes.map((pass) => cyclePassId(cycle.id, pass.pass_index)),
  );
  return { cycleId: cycle.id, passIds, hash: await cycleHash(cycle) };
}

export async function deriveCycles(cycles: NormalizedCycle[]): Promise<PersistedCycle[]> {
  return Promise.all(cycles.map(deriveCycle));
}

/**
 * Persist a scan result.
 *
 * `INSERT OR IGNORE` throughout, and that is the whole idempotency story: both
 * ids are content-addressed, so re-running the same scan writes nothing new and
 * two overlapping request windows that select the same encounter converge on one
 * row rather than two.
 *
 * Ignoring rather than upserting is deliberate. A `cyc_` id commits to the
 * physical encounter — branch, winding, policy, container, ephemeris — but not
 * to the envelope, so a refined rescan can legitimately return the same id with
 * a pass time moved by a fraction of a second. Overwriting would silently
 * rewrite the inputs a published reading was assembled from. Instead the first
 * row stands, and `generation-command.cyclePin.cycle_hash` is what notices a
 * changed envelope — by failing the claimed job closed, which is a state an
 * operator can see.
 *
 * Everything here is stored in clear on purpose: `cycle_instances` survives DEK
 * destruction, which the design records explicitly rather than claiming
 * otherwise.
 */
export async function persistCycles(
  env: Env,
  userId: string,
  chartId: string,
  cycles: NormalizedCycle[],
): Promise<PersistedCycle[]> {
  const derived = await deriveCycles(cycles);
  if (cycles.length === 0) return derived;

  const now = new Date().toISOString();
  const writes: D1PreparedStatement[] = [];

  cycles.forEach((cycle, index) => {
    writes.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO cycle_instances
           (id, chart_id, user_id, technique, phase, body, target, aspect,
            start_at, exact_at, end_at, orb_deg, importance_score, status,
            horizon_version, pass_count, cycle_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      ).bind(
        cycle.id,
        chartId,
        userId,
        cycle.technique,
        cycle.body,
        cycle.target,
        cycle.aspect,
        cycle.start_at,
        cycle.exact_at,
        cycle.end_at,
        cycle.orb_deg,
        cycle.importance_score ?? null,
        CYCLE_POLICY_VERSION,
        cycle.pass_count,
        JSON.stringify(cycle),
        now,
        now,
      ),
    );

    // `phase` stays NULL above. Phase is a function of the cycle AND the day it
    // is evaluated on, so a stored value is correct for exactly one date and
    // quietly wrong afterwards. The reading engine computes it per-day from the
    // envelope, which is the part that really is time-invariant.

    cycle.passes.forEach((pass, passIndex) => {
      writes.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO cycle_passes
             (id, cycle_id, user_id, pass_index, direction, exact_at,
              speed_deg_per_day, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          derived[index]!.passIds[passIndex]!,
          cycle.id,
          userId,
          pass.pass_index,
          pass.direction,
          pass.exact_at,
          pass.speed_deg_per_day,
          now,
        ),
      );
    });
  });

  // A scan response is not contract-bounded by cycle or pass count. Keep each D1
  // transaction bounded; partial progress is safe because every write is
  // content-addressed and idempotent, and the reading is reserved only after all
  // chunks succeed.
  for (let start = 0; start < writes.length; start += PERSIST_BATCH_SIZE) {
    await env.DB.batch(writes.slice(start, start + PERSIST_BATCH_SIZE));
  }
  return derived;
}
