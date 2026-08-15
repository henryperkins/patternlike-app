import { M7_SCHEMA_VERSION, type PatternFactPacket, type PatternOntologyRecord, type PatternPlan, type PatternPlannerOutput, type PatternWriterOutput } from "@patternlike/shared";
import {
  CHAPTER_WORD_MIN,
  SPARSE_CHAPTER_WORD_MIN,
  SIGNATURE_WORD_MIN,
  UNCERTAINTY_WORD_MIN,
} from "./policy.js";
import { padToMinWords } from "./words.js";

const FILLER =
  "This remains a calculated pattern rather than a prediction of events, and it describes a tendency the chart already contains.";

function pad(text: string, min: number): string {
  return padToMinWords(text, min, FILLER);
}

function chapterKey(index: number): string {
  return `chapter_${String(index + 1).padStart(2, "0")}`;
}

function signatureKey(index: number): string {
  return `signature_${String(index + 1).padStart(2, "0")}`;
}

/**
 * Trusted-code planner used by the synthetic publisher and as a fallback
 * envelope for tests. It assigns each non-uncertainty cluster to at most one
 * chapter, never invents aliases, and never declares sparse_pattern itself.
 */
export function buildDeterministicPlan(
  packet: PatternFactPacket,
  ontology: readonly PatternOntologyRecord[],
): PatternPlannerOutput {
  const byId = new Map(ontology.map((record) => [record.id, record]));
  const min = packet.selection_constraints.core_chapters_min;
  const max = packet.selection_constraints.core_chapters_max;
  const uncertainty = new Set(
    packet.features.filter((feature) => feature.feature_class === "uncertainty").map((feature) => feature.alias),
  );
  const seeds = (packet.clusters ?? [])
    .map((cluster) => cluster.feature_aliases.filter((alias) => !uncertainty.has(alias)))
    .filter((aliases) => aliases.length > 0);
  const leftover = packet.features
    .filter((feature) => !uncertainty.has(feature.alias))
    .map((feature) => feature.alias)
    .filter((alias) => !seeds.some((seed) => seed.includes(alias)));
  if (leftover.length > 0) seeds.push(leftover);
  if (seeds.length === 0 && packet.features.length > 0) {
    seeds.push(packet.features.filter((feature) => !uncertainty.has(feature.alias)).map((feature) => feature.alias));
  }

  while (seeds.length > max) {
    const last = seeds.pop()!;
    seeds[seeds.length - 1]!.push(...last.filter((alias) => !seeds[seeds.length - 1]!.includes(alias)));
  }
  while (seeds.length < min) {
    const largest = seeds.reduce((best, seed, index) => seed.length > seeds[best]!.length ? index : best, 0);
    if ((seeds[largest]?.length ?? 0) < 2) break;
    const moved = seeds[largest]!.splice(Math.ceil(seeds[largest]!.length / 2));
    seeds.push(moved);
  }
  if (seeds.length === 0) {
    seeds.push(packet.features.map((feature) => feature.alias));
  }
  if (uncertainty.size > 0) {
    const host = seeds.find((seed) => seed.length > 0) ?? seeds[0]!;
    for (const alias of uncertainty) {
      if (!host.includes(alias)) host.push(alias);
    }
  }

  const assigned = new Set(seeds.flat());
  const chapters = seeds.map((aliases, index) => {
    const usable = aliases.length > 0 ? aliases : [packet.features[0]!.alias];
    const features = packet.features.filter((feature) => usable.includes(feature.alias));
    const ruleIds = [...new Set(features.flatMap((feature) => feature.ontology_rule_ids))];
    const records = ruleIds.map((id) => byId.get(id)).filter((record): record is PatternOntologyRecord => !!record);
    const tension = records.find((record) => record.tensions.length > 0);
    const counter = records.find((record) => record.counter_expressions.length > 0);
    const resource = records.find((record) => record.normalized_proposition.length > 0);
    const titleBody = features.find((feature) => feature.feature_class !== "uncertainty")?.feature_class ?? "pattern";
    return {
      chapter_key: chapterKey(index),
      working_title: `A standing ${titleBody} theme`,
      purpose: "Integrate the selected calculated evidence without inventing facts or personal context.",
      feature_aliases: usable,
      ontology_rule_ids: ruleIds,
      derived_synthesis_ids: ruleIds.filter((id) => byId.get(id)?.meaning_class === "derived_synthesis"),
      required_tension_ids: tension ? [`${tension.id}#tension`] : ruleIds.slice(0, 1).map((id) => `${id}#tension`),
      required_resource_ids: resource ? [`${resource.id}#resource`] : [],
      required_counter_expression_ids: counter
        ? [`${counter.id}#counter`]
        : ruleIds.slice(0, 1).map((id) => `${id}#counter`),
    };
  });

  const omissions = packet.features
    .filter((feature) => feature.coverage === "eligible" && !assigned.has(feature.alias))
    .map((feature) => ({
      feature_alias: feature.alias,
      reason: "capacity_omitted" as const,
      covered_by: null,
    }));

  return {
    schema_version: M7_SCHEMA_VERSION,
    chapters,
    additional_signatures: [],
    omissions,
  };
}

export function buildDeterministicWriterOutput(
  plan: PatternPlan | PatternPlannerOutput,
  packet: PatternFactPacket,
  ontology: readonly PatternOntologyRecord[],
): PatternWriterOutput {
  const byId = new Map(ontology.map((record) => [record.id, record]));
  const chapterMin = packet.selection_constraints.sparse_pattern ? SPARSE_CHAPTER_WORD_MIN : CHAPTER_WORD_MIN;
  const chapters = plan.chapters.map((chapter) => {
    const aliases = chapter.feature_aliases;
    const rules = chapter.ontology_rule_ids;
    const record = byId.get(rules[0] ?? "") ?? ontology[0];
    const proposition = record?.normalized_proposition ?? "This configuration describes a standing tendency.";
    const tension = record?.tensions[0] ?? "The same structure can pull in two directions at once.";
    const counter = record?.counter_expressions[0] ?? "The same structure can read as discipline rather than conflict.";
    const section = (key: string, text: string) => ({
      section_key: key,
      text: pad(text, Math.ceil(chapterMin / 3)),
      claim_class: "reflective_interpretation" as const,
      feature_aliases: aliases,
      ontology_rule_ids: rules,
      derived_synthesis_ids: chapter.derived_synthesis_ids,
    });
    return {
      chapter_key: chapter.chapter_key,
      title: chapter.working_title.slice(0, 90),
      summary: pad(`This chapter holds ${proposition}`, 40),
      sections: [
        section(`${chapter.chapter_key}_section_01`, `The calculated evidence points to ${proposition}`),
        section(`${chapter.chapter_key}_section_02`, `How that tendency is used remains a matter of attention, not fate.`),
      ],
      tensions: [
        {
          text: pad(tension, 30),
          claim_class: "tension" as const,
          feature_aliases: aliases,
          ontology_rule_ids: rules,
          derived_synthesis_ids: [],
        },
      ],
      resources: [
        {
          text: pad(proposition, 30),
          claim_class: "resource" as const,
          feature_aliases: aliases,
          ontology_rule_ids: rules,
          derived_synthesis_ids: [],
        },
      ],
      counter_expression: {
        text: pad(counter, 30),
        claim_class: "counter_expression" as const,
        feature_aliases: aliases,
        ontology_rule_ids: rules,
        derived_synthesis_ids: [],
      },
    };
  });

  const uncertaintyFeature = packet.features.find((feature) => feature.feature_class === "uncertainty");
  const uncertaintyNote = uncertaintyFeature
    ? {
        text: pad(
          "Birth-time accuracy limits what this Pattern can say about houses, angles, and time-sensitive claims.",
          UNCERTAINTY_WORD_MIN,
        ),
        claim_class: "uncertainty" as const,
        feature_aliases: [uncertaintyFeature.alias],
        ontology_rule_ids: uncertaintyFeature.ontology_rule_ids,
        derived_synthesis_ids: [],
      }
    : null;

  const additional_signatures = ("additional_signatures" in plan ? plan.additional_signatures : []).map((signature, index) => ({
    signature_key: signature.signature_key ?? signatureKey(index),
    title: signature.working_title.slice(0, 90),
    text: pad("A quieter calculated signature remains present without becoming a major theme.", SIGNATURE_WORD_MIN),
    feature_aliases: signature.feature_aliases,
    ontology_rule_ids: signature.ontology_rule_ids,
  }));

  return {
    schema_version: M7_SCHEMA_VERSION,
    title: "Your Pattern",
    chapters,
    additional_signatures,
    uncertainty_note: uncertaintyNote,
  };
}
