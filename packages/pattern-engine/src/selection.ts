import {
  M7_SCHEMA_VERSION,
  type NatalFeature,
  type PatternFactPacket,
  type PatternFactPacketCluster,
  type PatternFactPacketFeature,
  type PatternFeatureAccounting,
  type PatternOntologyRecord,
  type PatternPacketCoverage,
  type PatternSelectionManifest,
} from "@patternlike/shared";
import { ontologyRecordMatchesFeature } from "./ontology.js";
import {
  ADDITIONAL_SIGNATURES_MAX,
  CORE_CHAPTERS_MAX,
  CORE_CHAPTERS_MIN,
  MAX_CLUSTER_SIZE,
  MAX_ELIGIBLE_ALIASES,
  MAX_MANDATORY_ALIASES,
  PATTERN_SELECTION_POLICY_ID,
  PATTERN_SELECTION_POLICY_VERSION,
  SPARSE_CHAPTERS,
} from "./policy.js";
import type { PatternSelectionResult, SelectionInput } from "./types.js";

export class SelectionCapacityError extends Error {
  readonly code = "pattern_selection_capacity_exceeded";
  constructor(message: string) {
    super(message);
    this.name = "SelectionCapacityError";
  }
}

const CLASS_RANK: Record<NatalFeature["feature_class"], number> = {
  uncertainty: 0,
  position: 1,
  aspect: 2,
  pattern: 3,
  angle: 4,
  house_cusp: 5,
};

const ASPECT_RANK: Record<string, number> = {
  conjunction: 0,
  opposition: 1,
  square: 2,
  trine: 3,
  sextile: 4,
};

function fnv1aHex8(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function aliasFor(index: number): string {
  return `f${String(index + 1).padStart(3, "0")}`;
}

function featureFact(feature: NatalFeature): Record<string, unknown> {
  switch (feature.feature_class) {
    case "position":
      return { body: feature.body, longitude: feature.longitude, sign: feature.sign, house: feature.house };
    case "aspect":
      return { body_a: feature.body_a, body_b: feature.body_b, aspect: feature.aspect, orb: feature.orb };
    case "pattern":
      return { pattern: feature.pattern, member_bodies: feature.member_bodies };
    case "angle":
      return { angle: feature.angle, longitude: feature.longitude, sign: feature.sign };
    case "house_cusp":
      return { house: feature.house, longitude: feature.longitude, sign: feature.sign };
    case "uncertainty":
      return { accuracy: feature.accuracy, suppressed_features: feature.suppressed_features };
  }
}

function matchingRecords(
  feature: NatalFeature,
  ontology: readonly PatternOntologyRecord[],
): PatternOntologyRecord[] {
  return ontology.filter((record) => ontologyRecordMatchesFeature(record, feature));
}

function coverageFor(feature: NatalFeature, matched: readonly PatternOntologyRecord[]): PatternPacketCoverage | "ontology_unsupported" {
  if (matched.length === 0) return "ontology_unsupported";
  if (feature.feature_class === "uncertainty") return "mandatory_any";
  if (feature.feature_class === "position" && (feature.body === "sun" || feature.body === "moon")) {
    return "mandatory_core";
  }
  if (
    feature.feature_class === "aspect" &&
    (feature.body_a === "sun" || feature.body_a === "moon" || feature.body_b === "sun" || feature.body_b === "moon") &&
    feature.orb <= 6
  ) {
    return "mandatory_core";
  }
  return "eligible";
}

function salienceScore(records: readonly PatternOntologyRecord[]): number {
  let best = 0;
  for (const record of records) {
    const band = record.salience_band === "high" ? 300 : record.salience_band === "medium" ? 200 : 100;
    const score = band + record.presentation_priority;
    if (score > best) best = score;
  }
  return best;
}

function rankScore(feature: NatalFeature, records: readonly PatternOntologyRecord[]): number {
  let score = salienceScore(records);
  score += (5 - CLASS_RANK[feature.feature_class]) * 20;
  if (feature.feature_class === "aspect") {
    score += (5 - (ASPECT_RANK[feature.aspect] ?? 5)) * 8;
    score += Math.max(0, 12 - feature.orb) * 4;
  }
  if (feature.feature_class === "angle") score += 40;
  if (feature.feature_class === "position" && feature.house !== null) score += 10;
  return score;
}

function featureBodies(feature: NatalFeature): string[] {
  switch (feature.feature_class) {
    case "position":
      return [feature.body];
    case "aspect":
      return [feature.body_a, feature.body_b];
    case "pattern":
      return [...feature.member_bodies];
    case "angle":
      return [feature.angle];
    case "house_cusp":
      return [`house_${feature.house}`];
    case "uncertainty":
      return ["uncertainty"];
  }
}

function shareEdge(
  a: NatalFeature,
  aRecords: readonly PatternOntologyRecord[],
  b: NatalFeature,
  bRecords: readonly PatternOntologyRecord[],
): boolean {
  const bodiesA = new Set(featureBodies(a));
  if (featureBodies(b).some((body) => bodiesA.has(body))) return true;
  if (a.feature_class === "pattern" && b.feature_class === "pattern" && a.pattern === b.pattern) return true;
  const tagsA = new Set(aRecords.flatMap((record) => record.cluster_tags));
  if (bRecords.some((record) => record.cluster_tags.some((tag) => tagsA.has(tag)))) return true;
  return false;
}

function splitComponent(aliases: string[]): string[][] {
  if (aliases.length <= MAX_CLUSTER_SIZE) return [aliases];
  const groups: string[][] = [];
  for (let i = 0; i < aliases.length; i += MAX_CLUSTER_SIZE) {
    groups.push(aliases.slice(i, i + MAX_CLUSTER_SIZE));
  }
  return groups;
}

function connectedComponents(
  nodes: Array<{ alias: string; feature: NatalFeature; records: PatternOntologyRecord[] }>,
): string[][] {
  const byAlias = new Map(nodes.map((node) => [node.alias, node]));
  const remaining = new Set(nodes.map((node) => node.alias));
  const components: string[][] = [];
  const ordered = [...nodes].map((node) => node.alias).sort();
  for (const start of ordered) {
    if (!remaining.has(start)) continue;
    const stack = [start];
    remaining.delete(start);
    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      const node = byAlias.get(current)!;
      for (const other of remaining) {
        const peer = byAlias.get(other)!;
        if (shareEdge(node.feature, node.records, peer.feature, peer.records)) {
          remaining.delete(other);
          stack.push(other);
        }
      }
    }
    component.sort();
    components.push(...splitComponent(component));
  }
  return components;
}

/**
 * M4 answers which calculated facts exist. This policy answers which of those
 * facts the Pattern document must account for. Ranking uses only ontology
 * metadata and calculated structure — never user behaviour.
 */
export function selectPatternEvidence(input: SelectionInput): PatternSelectionResult {
  const accounting: PatternFeatureAccounting[] = [];
  const selected: Array<{
    feature: NatalFeature;
    records: PatternOntologyRecord[];
    coverage: PatternPacketCoverage;
    score: number;
  }> = [];

  const sortedFeatures = [...input.features].sort((a, b) => a.feature_id.localeCompare(b.feature_id));
  for (const feature of sortedFeatures) {
    const records = matchingRecords(feature, input.ontology);
    const coverage = coverageFor(feature, records);
    if (coverage === "ontology_unsupported") {
      accounting.push({
        feature_id: feature.feature_id,
        alias: null,
        coverage: "ontology_unsupported",
        reason: "no_activated_ontology_record",
      });
      continue;
    }
    selected.push({
      feature,
      records,
      coverage,
      score: rankScore(feature, records),
    });
  }

  selected.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.feature.feature_id.localeCompare(b.feature.feature_id);
  });

  const mandatory = selected.filter((row) => row.coverage === "mandatory_core" || row.coverage === "mandatory_any");
  if (mandatory.length > MAX_MANDATORY_ALIASES) {
    throw new SelectionCapacityError(
      `mandatory evidence ${mandatory.length} exceeds the ${MAX_MANDATORY_ALIASES}-alias Pattern bound`,
    );
  }

  const kept: typeof selected = [];
  for (const row of selected) {
    if (row.coverage === "mandatory_core" || row.coverage === "mandatory_any") {
      kept.push(row);
      continue;
    }
    if (kept.length < MAX_ELIGIBLE_ALIASES) {
      kept.push(row);
    } else {
      accounting.push({
        feature_id: row.feature.feature_id,
        alias: null,
        coverage: "capacity_omitted",
        reason: "ranked_below_packet_bound",
      });
    }
  }

  kept.sort((a, b) => a.feature.feature_id.localeCompare(b.feature.feature_id));
  const aliasMap: Record<string, string> = {};
  const packetFeatures: PatternFactPacketFeature[] = [];
  const nodes: Array<{ alias: string; feature: NatalFeature; records: PatternOntologyRecord[] }> = [];
  for (let i = 0; i < kept.length; i++) {
    const row = kept[i]!;
    const alias = aliasFor(i);
    aliasMap[alias] = row.feature.feature_id;
    accounting.push({
      feature_id: row.feature.feature_id,
      alias,
      coverage: row.coverage,
      reason: null,
    });
    packetFeatures.push({
      alias,
      feature_class: row.feature.feature_class,
      fact: featureFact(row.feature),
      coverage: row.coverage,
      ontology_rule_ids: row.records.map((record) => record.id),
      cluster_ids: [],
    });
    nodes.push({ alias, feature: row.feature, records: row.records });
  }

  const components = connectedComponents(nodes);
  const clusters: PatternFactPacketCluster[] = [];
  const clusterByAlias = new Map<string, string[]>();
  for (const component of components) {
    const clusterId = `clu_${fnv1aHex8(component.join(","))}`;
    clusters.push({
      cluster_id: clusterId,
      feature_aliases: component,
      compatible_with: [],
    });
    for (const alias of component) {
      const list = clusterByAlias.get(alias) ?? [];
      list.push(clusterId);
      clusterByAlias.set(alias, list);
    }
  }
  for (const cluster of clusters) {
    cluster.compatible_with = clusters
      .filter((other) => other.cluster_id !== cluster.cluster_id)
      .map((other) => other.cluster_id)
      .sort();
  }
  for (const feature of packetFeatures) {
    feature.cluster_ids = clusterByAlias.get(feature.alias) ?? [];
  }

  const eligibleCount = packetFeatures.length;
  const sparsePattern = eligibleCount < CORE_CHAPTERS_MIN * 2;
  const chapterMin = sparsePattern ? SPARSE_CHAPTERS : CORE_CHAPTERS_MIN;
  const chapterMax = sparsePattern ? SPARSE_CHAPTERS : CORE_CHAPTERS_MAX;

  const uncertaintyRules = packetFeatures
    .filter((feature) => feature.feature_class === "uncertainty")
    .flatMap((feature) => feature.ontology_rule_ids);
  const suppressedClasses = [...new Set(
    kept.flatMap(({ feature }) =>
      feature.feature_class === "uncertainty"
        ? feature.suppressed_features
        : [],
    ),
  )].sort();

  const packet: PatternFactPacket = {
    schema_version: M7_SCHEMA_VERSION,
    locale: input.locale,
    effective_accuracy: input.effectiveAccuracy,
    uncertainty: {
      suppressed_classes: suppressedClasses,
      required_language_rule_ids: uncertaintyRules,
    },
    features: packetFeatures,
    clusters,
    selection_constraints: {
      core_chapters_min: chapterMin,
      core_chapters_max: chapterMax,
      additional_signatures_max: ADDITIONAL_SIGNATURES_MAX,
      sparse_pattern: sparsePattern,
    },
  };

  const accounted = new Set(accounting.map((row) => row.feature_id));
  for (const feature of sortedFeatures) {
    if (!accounted.has(feature.feature_id)) {
      accounting.push({
        feature_id: feature.feature_id,
        alias: null,
        coverage: "ontology_unsupported",
        reason: "unaccounted",
      });
    }
  }
  accounting.sort((a, b) => a.feature_id.localeCompare(b.feature_id));

  const manifest: PatternSelectionManifest = {
    schema_version: M7_SCHEMA_VERSION,
    policy_id: PATTERN_SELECTION_POLICY_ID,
    policy_version: PATTERN_SELECTION_POLICY_VERSION,
    // M4 froze feature_set_hash as a bare SHA-256 hex digest, while M7's
    // selection-manifest contract deliberately uses the content-hash form.
    // Normalize at this version boundary without changing the persisted M4
    // identity or double-prefixing authored M7 callers.
    feature_set_hash: input.featureSetHash.startsWith("sha256:")
      ? input.featureSetHash
      : `sha256:${input.featureSetHash}`,
    sparse_pattern: sparsePattern,
    accounting,
  };

  return { packet, manifest, aliasMap };
}
