/**
 * Editorial smoke-test fixture evaluation (D5).
 *
 * This is what lets POST /internal/content-releases stop returning
 * `accepted_pending_tests` for a fixture-bearing bundle. It is a pure call over
 * the same core as assembleReading, which is why it costs nothing extra.
 *
 * `content-release.schema.json` lets a bundle declare `{fixture_id, expect}`
 * with no payload — the ids name something the bundle does not carry. That is
 * inert only while nothing evaluates them. The moment an engine exists, an
 * unresolvable id must fail closed, or a compromised control plane activates a
 * release by naming fixtures nobody has.
 */

import { assembleReading } from "./assemble.js";
import type {
  AssemblyInput,
  AssemblyUncertaintyInput,
  BirthTimeAccuracy,
  LifeDomain,
  NormalizedContextSignal,
  NormalizedCycle,
  Rejection,
  VerifiedBundle,
} from "./types.js";

export type FixtureOutcome = "eligible" | "ineligible" | "fallback";

/** One catalogue entry: a complete engine input minus the release under test. */
export interface AssemblyFixture {
  schema_version: "0.3.0";
  fixture_id: string;
  expect: FixtureOutcome;
  locale: string;
  domain_preference: LifeDomain | null;
  local_date: string;
  target_timezone: string;
  day_start_at: string;
  day_end_at: string;
  chart: {
    fingerprint: string;
    effective_accuracy: BirthTimeAccuracy;
    uncertainty: AssemblyUncertaintyInput;
  };
  cycles: NormalizedCycle[];
  context: NormalizedContextSignal[];
}

export class UnknownFixtureError extends Error {
  readonly code = "fixtures_unknown";
  constructor(readonly fixtureId: string) {
    super(`No catalogue entry for fixture ${fixtureId}`);
    this.name = "UnknownFixtureError";
  }
}

/** Rejection codes that mean "a candidate existed and was ruled out". */
const RULED_OUT = /^(eligibility_|uncertainty_|no_editorial_)/;

export interface FixtureEvaluation {
  fixture_id: string;
  outcome: FixtureOutcome;
  expected: FixtureOutcome;
  passed: boolean;
  rejections: Rejection[];
}

export function evaluateFixture(
  bundle: VerifiedBundle,
  catalogue: ReadonlyMap<string, AssemblyFixture>,
  fixtureId: string,
): FixtureEvaluation {
  const fixture = catalogue.get(fixtureId);
  if (!fixture) throw new UnknownFixtureError(fixtureId);

  const input: AssemblyInput = {
    identity_profile: "patternlike.assembly-id.v1",
    schema_version: "0.3.0",
    output_schema: "daily-reading-v3",
    assembly_policy_id: "daily-reading-deterministic",
    // Fixtures are evaluated against the policy currently registered; a fixture
    // that only passes under an older policy is not evidence about this build.
    assembly_policy_version: "fixture-evaluation",
    reading_id: `fixture.${fixture.fixture_id}`,
    revision: 1,
    local_date: fixture.local_date,
    target_timezone: fixture.target_timezone,
    generation_anchor: fixture.day_start_at,
    day_start_at: fixture.day_start_at,
    day_end_at: fixture.day_end_at,
    chart: fixture.chart,
    cycles: fixture.cycles,
    release: bundle,
    context: fixture.context,
    locale: fixture.locale,
    domain_preference: fixture.domain_preference,
  };

  const outcome = assembleReading(input);

  // Three-way, because "nothing was offered" and "something was offered and
  // ruled out" are different editorial facts even though both publish the
  // reviewed fallback.
  let result: FixtureOutcome;
  if (!outcome.reading.fallback_used) {
    result = "eligible";
  } else if (outcome.rejections.some((r) => RULED_OUT.test(r.reason_code))) {
    result = "ineligible";
  } else {
    result = "fallback";
  }

  return {
    fixture_id: fixtureId,
    outcome: result,
    expected: fixture.expect,
    passed: result === fixture.expect,
    rejections: outcome.rejections,
  };
}

/** Evaluate every fixture a bundle declares. Any unknown id throws. */
export function evaluateDeclaredFixtures(
  bundle: VerifiedBundle,
  catalogue: ReadonlyMap<string, AssemblyFixture>,
  declared: ReadonlyArray<{ fixture_id: string; expect: FixtureOutcome }>,
): FixtureEvaluation[] {
  return declared.map((d) => {
    const evaluation = evaluateFixture(bundle, catalogue, d.fixture_id);
    // The bundle's own expectation wins over the catalogue's: the catalogue
    // says what the input is, the bundle says what this release claims about it.
    return {
      ...evaluation,
      expected: d.expect,
      passed: evaluation.outcome === d.expect,
    };
  });
}
