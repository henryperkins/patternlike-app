import type {
  DailyUncertaintyDisclosure,
  DailyUncertaintyDisclosurePlan,
  DailyUncertaintyInput,
  DailyUncertaintyQualification,
  UncertaintyReport,
} from "@patternlike/shared";

const SUPPRESSED_LABELS = {
  houses: "Houses",
  angles: "Angles",
  angle_transits: "Angle transits",
  moon_time_sensitive: "Time-sensitive Moon details",
} as const;

const QUALIFICATIONS: ReadonlyArray<DailyUncertaintyQualification & { statement: string }> = [
  { feature_id: "birth_instant", qualification: "technique_specific",
    statement: "The time-zone mapping of your local birth time needs confirmation." },
  { feature_id: "birthplace", qualification: "technique_specific",
    statement: "Your birthplace needs confirmation." },
  { feature_id: "houses", qualification: "approximate_only", statement: "House details are approximate." },
  { feature_id: "moon", qualification: "low_confidence_moon", statement: "Time-sensitive Moon details have low confidence." },
];

/**
 * Reject unsupported stored reasons before casting them to the Daily contract.
 * The M0 report deliberately has open strings; the frozen M3 type is narrower
 * than the calculation service's location vocabulary and is not this boundary.
 */
export function normalizeDailyUncertainty(
  input: Pick<UncertaintyReport, "accuracy" | "suppressed_features" | "qualified_features"> & {
    window_plus_minus_minutes: number | null;
  },
): DailyUncertaintyInput {
  if (!["exact", "approximate", "unknown"].includes(input.accuracy)) {
    throw new Error("unsupported uncertainty accuracy");
  }
  if (input.window_plus_minus_minutes !== null &&
    (!Number.isInteger(input.window_plus_minus_minutes) || input.window_plus_minus_minutes < 0 ||
      input.window_plus_minus_minutes > 1440)) {
    throw new Error("unsupported uncertainty window");
  }
  const suppressed: DailyUncertaintyInput["suppressed_features"] = [];
  for (const feature of input.suppressed_features) {
    if (!Object.hasOwn(SUPPRESSED_LABELS, feature.feature_class) ||
      !["unknown_birth_time", "birthplace_unavailable"].includes(feature.reason) ||
      (feature.reason === "unknown_birth_time" && input.accuracy !== "unknown")) {
      throw new Error("unsupported uncertainty suppression");
    }
    if (suppressed.some((entry) => entry.feature_class === feature.feature_class && entry.reason !== feature.reason)) {
      throw new Error("unsupported uncertainty suppression conflict");
    }
    suppressed.push({
      feature_class: feature.feature_class,
      feature_id: feature.feature_id ?? null,
      reason: feature.reason as DailyUncertaintyInput["suppressed_features"][number]["reason"],
    });
  }
  const qualified: DailyUncertaintyQualification[] = [];
  for (const feature of input.qualified_features) {
    const supported = QUALIFICATIONS.find((entry) => entry.feature_id === feature.feature_id &&
      entry.qualification === feature.qualification);
    if (!supported || ((feature.feature_id === "moon" || feature.feature_id === "houses") && input.accuracy !== "approximate")) {
      throw new Error("unsupported uncertainty qualification");
    }
    qualified.push({ feature_id: supported.feature_id, qualification: supported.qualification } as DailyUncertaintyQualification);
  }
  return {
    accuracy: input.accuracy,
    window_plus_minus_minutes: input.window_plus_minus_minutes,
    suppressed_features: suppressed.sort((a, b) => compare(a.feature_class, b.feature_class) ||
      compare(a.feature_id ?? "", b.feature_id ?? "") || compare(a.reason, b.reason)),
    qualified_features: qualified.sort((a, b) => compare(a.feature_id, b.feature_id) || compare(a.qualification, b.qualification)),
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One deterministic, reason-specific plan shared by the packet and validator. */
export function buildUncertaintyDisclosurePlan(input: DailyUncertaintyInput): DailyUncertaintyDisclosurePlan {
  const disclosures: DailyUncertaintyDisclosure[] = [];
  if (input.accuracy !== "exact") {
    disclosures.push({ kind: "birth_time", reason: input.accuracy === "unknown" ? "unknown_birth_time" : "approximate_birth_time",
      statement: `Your birth time is ${input.accuracy}.` });
  }
  for (const feature of input.suppressed_features) {
    const cause = feature.reason === "unknown_birth_time" ? "your birth time is unknown" : "your birthplace is unavailable";
    disclosures.push({ kind: "suppression", feature_class: feature.feature_class, reason: feature.reason,
      statement: `${SUPPRESSED_LABELS[feature.feature_class]} are omitted because ${cause}.` });
  }
  for (const feature of input.qualified_features) {
    const supported = QUALIFICATIONS.find((entry) => entry.feature_id === feature.feature_id &&
      entry.qualification === feature.qualification)!;
    disclosures.push({ kind: "qualification", ...feature, statement: supported.statement });
  }
  // Feature IDs can be more granular than their disclosure class. Preserve the
  // complete stored report in the identity, but require each class/reason once.
  return { policy_version: "1.0.0", disclosures: disclosures.filter((entry, index) =>
    disclosures.findIndex((other) => other.statement === entry.statement) === index) };
}

function normalizedSentences(text: string): string[] {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase()
    .split(/[.!?](?:["']+)?(?=\s|$)|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
}

/** No generic disclaimer, invented reason, repeated reason, or omitted reason. */
export function uncertaintyDisclosureFailure(text: string, plan: DailyUncertaintyDisclosurePlan): string | null {
  const expected = plan.disclosures.map((entry) => normalizedSentences(entry.statement)[0]!);
  const actual = normalizedSentences(text);
  if (actual.some((sentence) => !expected.includes(sentence))) return "unsupported_uncertainty_disclosure";
  if (new Set(actual).size !== actual.length) return "duplicate_uncertainty_disclosure";
  if (expected.some((sentence) => !actual.includes(sentence))) return "incomplete_uncertainty_disclosure";
  return null;
}
