/** Pure schema definitions shared by the provider and build-time validators. */

import m0ChartContractSchema from "../../../../contracts/m0/chart-contract.schema.json";
import m0CommonSchema from "../../../../contracts/m0/common.schema.json";
import m7CommonSchema from "../../../../contracts/m7/common.schema.json";
import ontologyRecordSchema from "../../../../contracts/m7/pattern-ontology-record.schema.json";
import { ONTOLOGY_PIPELINE_LIMITS } from "./ontology-pipeline-limits.js";

export type OntologyProviderPass = "generator" | "evaluator";

export const ONTOLOGY_EVALUATOR_DIMENSIONS = [
  "source_support",
  "entailment",
  "contradiction",
  "unsupported_expansion",
  "diagnostic_or_predictive_drift",
  "one_sided_or_essentialist_framing",
  "tension_counter_expression_balance",
  "uncertainty_compatibility",
  "cross_record_conflict",
] as const;

const STRING_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string", minLength: 1 },
} as const;

const NONEMPTY_STRING_SCHEMA = { type: "string", minLength: 1 } as const;
const LOCALE_TAG_SCHEMA = {
  type: "string",
  minLength: m0CommonSchema.$defs.localeTag.minLength,
  maxLength: m0CommonSchema.$defs.localeTag.maxLength,
  pattern: m0CommonSchema.$defs.localeTag.pattern,
} as const;
const ONTOLOGY_RULE_ID_SCHEMA = {
  type: "string",
  pattern: m7CommonSchema.$defs.ontologyRuleId.pattern,
} as const;
const SOURCE_FRAGMENT_ID_SCHEMA = {
  type: "string",
  pattern: m7CommonSchema.$defs.sourceFragmentId.pattern,
} as const;
const CELESTIAL_BODY_SCHEMA = {
  type: "string",
  enum: m0CommonSchema.$defs.celestialBody.enum,
} as const;
const ASPECT_TYPE_SCHEMA = {
  type: "string",
  enum: m0CommonSchema.$defs.aspectType.enum,
} as const;
const HOUSE_SCHEMA = {
  type: "integer",
  minimum: ontologyRecordSchema.$defs.featurePredicate.properties.house.minimum,
  maximum: ontologyRecordSchema.$defs.featurePredicate.properties.house.maximum,
} as const;

const FEATURE_PREDICATE_SCHEMA = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "body"],
      properties: {
        type: { type: "string", enum: ["position"] },
        body: { type: "string", enum: ["sun", "moon"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "body", "house"],
      properties: {
        type: { type: "string", enum: ["position"] },
        body: CELESTIAL_BODY_SCHEMA,
        // M7's projection has no `sign` member, so the frozen M4 position
        // predicate can be represented only through its required house arm.
        house: HOUSE_SCHEMA,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "aspect"],
      properties: {
        type: { type: "string", enum: ["aspect"] },
        aspect: {
          type: "string",
          enum: [
            "conjunction",
            "square",
            "trine",
            "sextile",
          ],
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "body_a", "body_b", "aspect"],
      properties: {
        type: { type: "string", enum: ["aspect"] },
        body_a: CELESTIAL_BODY_SCHEMA,
        body_b: CELESTIAL_BODY_SCHEMA,
        aspect: ASPECT_TYPE_SCHEMA,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "pattern"],
      properties: {
        type: { type: "string", enum: ["pattern"] },
        pattern: {
          type: "string",
          enum: m0ChartContractSchema.$defs.chartSnapshot.properties.patterns
            .items.properties.pattern_type.enum,
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "angle"],
      properties: {
        type: { type: "string", enum: ["angle"] },
        angle: { type: "string", enum: ["ascendant", "midheaven"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "house"],
      properties: {
        type: { type: "string", enum: ["house_cusp"] },
        house: HOUSE_SCHEMA,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "accuracy"],
      properties: {
        type: { type: "string", enum: ["uncertainty"] },
        accuracy: {
          type: "string",
          enum: m0CommonSchema.$defs.birthTimeAccuracy.enum,
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { type: "string", enum: ["uncertainty"] },
      },
    },
  ],
} as const;

const ONTOLOGY_RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "meaning_class",
    "locale",
    "feature_predicate",
    "normalized_proposition",
    "source_fragment_ids",
    "input_meaning_ids",
    "transformation_class",
    "tensions",
    "counter_expressions",
    "prohibited_claims",
    "salience_band",
    "presentation_priority",
    "cluster_tags",
  ],
  properties: {
    id: ONTOLOGY_RULE_ID_SCHEMA,
    meaning_class: {
      type: "string",
      enum: ["source_supported", "derived_synthesis", "expression_guidance"],
    },
    locale: LOCALE_TAG_SCHEMA,
    feature_predicate: FEATURE_PREDICATE_SCHEMA,
    normalized_proposition: NONEMPTY_STRING_SCHEMA,
    source_fragment_ids: {
      type: "array",
      items: SOURCE_FRAGMENT_ID_SCHEMA,
    },
    input_meaning_ids: {
      type: "array",
      items: ONTOLOGY_RULE_ID_SCHEMA,
    },
    transformation_class: {
      anyOf: [
        {
          type: "string",
          enum: [
            "intersection",
            "contrast",
            "tension",
            "counterbalance",
            "developmental_arc",
            "expression_range",
            "shared_motif",
          ],
        },
        { type: "null" },
      ],
    },
    tensions: STRING_ARRAY_SCHEMA,
    counter_expressions: STRING_ARRAY_SCHEMA,
    prohibited_claims: STRING_ARRAY_SCHEMA,
    salience_band: { type: "string", enum: ["low", "medium", "high"] },
    presentation_priority: {
      type: "integer",
      minimum: ontologyRecordSchema.$defs.patternOntologyRecord.properties
        .presentation_priority.minimum,
      maximum: ontologyRecordSchema.$defs.patternOntologyRecord.properties
        .presentation_priority.maximum,
    },
    cluster_tags: STRING_ARRAY_SCHEMA,
  },
} as const;

const GENERATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "records", "complete"],
  properties: {
    schema_version: { type: "string", enum: ["0.7.0"] },
    records: {
      type: "array",
      maxItems: ONTOLOGY_PIPELINE_LIMITS.maximum_candidate_records,
      items: ONTOLOGY_RECORD_SCHEMA,
    },
    complete: { type: "boolean" },
  },
} as const;

const DIMENSION_PROPERTIES = Object.fromEntries(
  ONTOLOGY_EVALUATOR_DIMENSIONS.map((dimension) => [
    dimension,
    { type: "string", enum: ["pass", "reject"] },
  ]),
);

const EVALUATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "rule_id", "verdict", "dimensions"],
  properties: {
    schema_version: { type: "string", enum: ["0.7.0"] },
    rule_id: ONTOLOGY_RULE_ID_SCHEMA,
    verdict: { type: "string", enum: ["pass", "reject"] },
    dimensions: {
      type: "object",
      additionalProperties: false,
      required: [...ONTOLOGY_EVALUATOR_DIMENSIONS],
      properties: DIMENSION_PROPERTIES,
    },
  },
} as const;

export const ONTOLOGY_STRICT_SCHEMA: Record<OntologyProviderPass, unknown> = {
  generator: GENERATOR_SCHEMA,
  evaluator: EVALUATOR_SCHEMA,
};
