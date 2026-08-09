import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  EXCLUDED_BUT_NOT_NO_PREFIXED,
  INGESTIBLE_SOURCES,
  INGESTIBLE_SOURCE_COUNT,
  REGISTRY_ALLOWED_USE_VOCABULARY,
  REGISTRY_SOURCE_COUNT,
} from "./source-allowlist.generated.js";
import { contextRejection } from "./eligibility.js";
import type { NormalizedContextSignal } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../..");

const signal = (over: Partial<NormalizedContextSignal>): NormalizedContextSignal => ({
  signal_id: "sig_test",
  source_id: "USR-03",
  allowed_use: "life_domain_selection",
  evidence_lane: "user_and_context",
  permission_state: "active",
  freshness_status: "fresh",
  ...over,
});

test("the generated allowlist still matches the registry", () => {
  // Escalation §6's second half: nothing kept the enforcement in sync with the
  // registry — "it happens to be correct today, which is not the same as being
  // kept correct". A regenerate-and-diff is what makes it kept correct.
  const result = spawnSync(
    "python",
    [path.join(here, "../scripts/generate_source_allowlist.py"), "--check"],
    { encoding: "utf8" },
  );

  if (result.error) {
    // Not skipped. The repository requires Python 3.11+, and a silent skip here
    // would restore exactly the "correct today" posture this test exists to end.
    assert.fail(
      `could not run the allowlist generator (${result.error.message}). ` +
        "Python 3.11+ with pyyaml is required — see CLAUDE.md.",
    );
  }
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("exactly one excluded source would survive a NO-* prefix check", () => {
  // AMB-12, "Major news and world events", Category E: excluded by STATUS while
  // carrying an ingestible id prefix. The schema pattern and the three D1
  // CHECKs all use `NOT GLOB 'NO-*'`, so a signal citing it passes both gates.
  assert.deepEqual(EXCLUDED_BUT_NOT_NO_PREFIXED, ["AMB-12"]);
  assert.equal(INGESTIBLE_SOURCES.has("AMB-12"), false);
  assert.equal(
    contextRejection(signal({ source_id: "AMB-12", allowed_use: "theme_ranking" })),
    "context_source_not_in_registry_allowlist",
  );
});

test("no NO-* source is ingestible either", () => {
  for (const id of INGESTIBLE_SOURCES.keys()) {
    assert.ok(!id.startsWith("NO-"), `${id} must not be ingestible`);
  }
  assert.equal(
    contextRejection(signal({ source_id: "NO-01", allowed_use: "theme_ranking" })),
    "context_source_not_in_registry_allowlist",
  );
});

test("a source outside the registry entirely cannot enter assembly", () => {
  assert.equal(
    contextRejection(signal({ source_id: "ZZZ-99" })),
    "context_source_not_in_registry_allowlist",
  );
});

test("a registered source is gated per allowed_use, not per source", () => {
  assert.equal(contextRejection(signal({})), null);
  assert.equal(
    contextRejection(signal({ allowed_use: "ad_targeting" })),
    "context_use_not_permitted_for_source",
  );
});

test("the M0 allowedUse enum matches the registry vocabulary", () => {
  // Nothing in CI kept these in sync. They agree today; this is what keeps
  // them agreeing, and it is the check that catches a registry revision that
  // adds a use the frozen enum cannot express.
  const common = JSON.parse(
    readFileSync(path.join(REPO, "contracts/m0/common.schema.json"), "utf8"),
  );
  const enumerated: string[] = common.$defs.allowedUse.enum;
  assert.deepEqual(
    [...enumerated].sort(),
    [...REGISTRY_ALLOWED_USE_VOCABULARY].sort(),
    "contracts/m0/common.schema.json#/$defs/allowedUse has drifted from allowed_use_vocabulary",
  );
});

test("every allowed_use a source declares is in the shared vocabulary", () => {
  const vocabulary = new Set(REGISTRY_ALLOWED_USE_VOCABULARY);
  for (const [id, uses] of INGESTIBLE_SOURCES) {
    for (const use of uses) {
      assert.ok(vocabulary.has(use), `${id} declares unknown allowed_use ${use}`);
    }
  }
});

test("the allowlist is narrower than the registry, and non-trivially so", () => {
  assert.ok(INGESTIBLE_SOURCE_COUNT > 0);
  assert.ok(
    INGESTIBLE_SOURCE_COUNT < REGISTRY_SOURCE_COUNT,
    "an allowlist equal to the registry would be no gate at all",
  );
  assert.equal(INGESTIBLE_SOURCES.size, INGESTIBLE_SOURCE_COUNT);
});
