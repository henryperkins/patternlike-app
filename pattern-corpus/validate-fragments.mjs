#!/usr/bin/env node
// Pre-ingestion gate for Pattern Ontology Source Manual fragments.
//
// Mirrors the checks that would otherwise fail late, in the pipeline:
//   - CLOSED_PROHIBITED_ASSERTION      apps/api/src/services/ontology-candidate-validation.ts
//   - HYPE + exclamation               apps/api/src/services/reading-evaluation.ts
//   - transformationClass enum         contracts/m7/common.schema.json
//   - license_class enum + uniformity  contracts/m7/pattern-source-fragment.schema.json
//                                      apps/api/src/services/ontology-corpus.ts
//   - excerpt maxLength 2000           contracts/m7/pattern-source-fragment.schema.json
//
// Usage: node validate-fragments.mjs fragments.json

import { readFileSync } from "node:fs";

const CLOSED_PROHIBITED_ASSERTION =
  /\b(?:diagnos(?:is|e|ed|ing)|predict(?:ion|s|ed|ing|ive)?|caus(?:e|es|ed|ing|ation|al)|inevitab(?:le|ly|ility)|fate|biograph(?:y|ical|ic)|life[\s_-]*events?)\b/i;

const HYPE =
  /\b(?:amazing|incredible|unlock|manifest|destiny|magical|epic|game[- ]chang\w+)\b/i;

const TRANSFORMATION_CLASSES = new Set([
  "intersection",
  "contrast",
  "tension",
  "counterbalance",
  "developmental_arc",
  "expression_range",
  "shared_motif",
]);

const LICENSE_CLASSES = new Set(["licensed_excerpt", "internal_synthetic"]);
const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/;

// SOW §2/§3 editorial bounds, tighter than the schema's 1..2000.
const EXCERPT_MIN = 400;
const EXCERPT_MAX_SCHEMA = 2000;
const PROPOSITION_MAX = 200;
const MIN_EXCLUSIONS = 2;

const path = process.argv[2] ?? "fragments.json";
const fragments = JSON.parse(readFileSync(path, "utf8"));

const failures = [];
const warnings = [];
const seenRefs = new Set();
const licenseClasses = new Set();

const fail = (ref, msg) => failures.push(`${ref}: ${msg}`);
const warn = (ref, msg) => warnings.push(`${ref}: ${msg}`);

/** Every string a derived record could inherit vocabulary from. */
const inheritedText = (f) =>
  [f.normalized_proposition ?? "", f.excerpt ?? "", ...(f.exclusions ?? [])].join(" \n ");

for (const f of fragments) {
  const ref = f.ref ?? "<missing ref>";

  for (const k of [
    "ref",
    "title",
    "author",
    "edition",
    "location",
    "locale",
    "license_class",
    "normalized_proposition",
    "excerpt",
  ]) {
    if (typeof f[k] !== "string" || f[k].trim() === "") fail(ref, `${k} missing or blank`);
  }

  if (seenRefs.has(f.ref)) fail(ref, "duplicate ref");
  seenRefs.add(f.ref);

  if (!LOCALE_TAG.test(f.locale ?? "")) fail(ref, `locale "${f.locale}" is not a BCP 47 tag`);

  if (!LICENSE_CLASSES.has(f.license_class)) {
    fail(ref, `license_class "${f.license_class}" not in enum`);
  }
  licenseClasses.add(f.license_class);

  const prop = f.normalized_proposition ?? "";
  if (prop.length > PROPOSITION_MAX) {
    fail(ref, `normalized_proposition ${prop.length} chars, max ${PROPOSITION_MAX}`);
  }
  if ((prop.match(/\.\s+\S/g) ?? []).length > 0) {
    warn(ref, "normalized_proposition looks like more than one sentence");
  }

  const ex = f.excerpt ?? "";
  if (ex.length > EXCERPT_MAX_SCHEMA) {
    fail(ref, `excerpt ${ex.length} chars, schema max ${EXCERPT_MAX_SCHEMA}`);
  } else if (ex.length < EXCERPT_MIN) {
    fail(ref, `excerpt ${ex.length} chars, SOW min ${EXCERPT_MIN}`);
  }

  // The regex that matters: it runs on derived records, which inherit this vocabulary.
  const text = inheritedText(f);
  const banned = text.match(CLOSED_PROHIBITED_ASSERTION);
  if (banned) fail(ref, `prohibited assertion vocabulary: "${banned[0]}"`);

  const hype = text.match(HYPE);
  if (hype) fail(ref, `hype term: "${hype[0]}"`);

  if (/!/.test(text)) fail(ref, "contains an exclamation mark");

  const exclusions = f.exclusions ?? [];
  if (!Array.isArray(exclusions) || exclusions.length < MIN_EXCLUSIONS) {
    fail(ref, `needs >= ${MIN_EXCLUSIONS} exclusions, has ${exclusions.length ?? 0}`);
  }
  for (const e of exclusions) {
    if (typeof e !== "string" || e.trim() === "") {
      fail(ref, "blank exclusion string refuses every record unconditionally");
      continue;
    }
    // exclusionsAllow() is a literal, case-insensitive substring test on record text.
    if (e.trim().split(/\s+/).length < 2) {
      warn(ref, `exclusion "${e}" is a single word and will over-refuse`);
    }
    if (ex.toLowerCase().includes(e.toLowerCase())) {
      warn(ref, `exclusion "${e}" appears in this fragment's own excerpt`);
    }
  }

  const transforms = f.allowed_transformations ?? [];
  if (!Array.isArray(transforms) || transforms.length === 0) {
    fail(ref, "allowed_transformations is empty; no derived_synthesis can descend from this");
  }
  for (const t of transforms) {
    if (!TRANSFORMATION_CLASSES.has(t)) fail(ref, `unknown transformation class "${t}"`);
  }
  if (new Set(transforms).size !== transforms.length) {
    fail(ref, "duplicate transformation class");
  }
}

if (licenseClasses.size > 1) {
  failures.push(
    `corpus mixes license classes (${[...licenseClasses].join(", ")}) — ontology_corpus_manifest_invalid`,
  );
}

// Cross-fragment: an exclusion on one fragment refuses records citing it, but a
// derived_synthesis may descend from several. Flag phrases another fragment uses.
for (const a of fragments) {
  for (const e of a.exclusions ?? []) {
    if (typeof e !== "string" || !e.trim()) continue;
    for (const b of fragments) {
      if (a.ref === b.ref) continue;
      if ((b.excerpt ?? "").toLowerCase().includes(e.toLowerCase())) {
        warnings.push(`${a.ref}: exclusion "${e}" appears in ${b.ref}'s excerpt`);
      }
    }
  }
}

console.log(`checked ${fragments.length} fragments from ${path}\n`);

if (warnings.length) {
  console.log(`warnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ~ ${w}`);
  console.log("");
}

if (failures.length) {
  console.log(`FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  x ${f}`);
  process.exit(1);
}

console.log("PASS — no blocking findings.");
console.log(
  `license_class: ${[...licenseClasses][0]} (public_capable = ${
    [...licenseClasses][0] === "licensed_excerpt" ? 1 : 0
  })`,
);
