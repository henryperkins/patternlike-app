import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { NatalFeature, PatternOntologyRelease } from "@patternlike/shared";
import {
  buildDeterministicPlan,
  buildDeterministicWriterOutput,
  ontologyRecordMatchesFeature,
  selectPatternEvidence,
  stripPrivateEvidence,
  validatePatternCandidate,
  validatePatternPlan,
} from "@patternlike/pattern-engine";
import { evaluatePatternPublicationSafety } from "../src/services/pattern-publication-safety.js";

import {
  buildOntologyCorpusRelease,
  prepareOntologyCorpusFile,
  runPrepareOntologyCorpusCli,
} from "./prepare-ontology-corpus.js";

const common = {
  title: "Pattern Ontology Source Manual",
  author: "Pattern editorial",
  edition: "1.0 (2026)",
  locale: "en-US",
  license_class: "licensed_excerpt" as const,
  exclusions: ["a diagnosis", "a guaranteed outcome"],
  allowed_transformations: ["intersection" as const, "contrast" as const],
};

async function runInternalBuilder(
  corpus: Awaited<ReturnType<typeof buildOntologyCorpusRelease>>,
  version?: string,
): Promise<PatternOntologyRelease> {
  const directory = await mkdtemp(join(tmpdir(), "pattern-internal-builder-"));
  try {
    const inputPath = join(directory, "corpus.json");
    const outputPath = join(directory, "candidate.json");
    await writeFile(inputPath, JSON.stringify(corpus));
    const env = { ...process.env };
    if (version === undefined) delete env.ONTOLOGY_VERSION;
    else env.ONTOLOGY_VERSION = version;
    await promisify(execFile)(process.execPath, [
      "--import", "tsx",
      fileURLToPath(new URL("./build-internal-ontology.ts", import.meta.url)),
      inputPath, outputPath,
    ], { env });
    return JSON.parse(await readFile(outputPath, "utf8")) as PatternOntologyRelease;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("internal builder recovers explicit source contrasts in a new candidate version", async () => {
  const input = JSON.parse(await readFile(
    new URL("../../../pattern-corpus/fragments.json", import.meta.url), "utf8",
  ));
  const corpus = await buildOntologyCorpusRelease(input, "pattern-ontology-source-manual-en-us-0.1.0");
  const release = await runInternalBuilder(corpus);
  const countersAt = (location: string) => {
    const fragment = corpus.fragments.find((entry) => entry.location?.startsWith(`${location} `))!;
    return release.records.find((record) => record.source_fragment_ids.includes(fragment.id))!.counter_expressions;
  };

  assert.deepEqual(countersAt("§1.1"), [
    "The counter-expression is that it is the most reliable supply of energy available.",
  ]);
  assert.deepEqual(countersAt("§1.2"), [
    "The counter-expression is that knowing the route is practical.",
  ]);
  assert.deepEqual(countersAt("§1.7"), [
    "The counter-expression is durability.",
    "What is accepted slowly is frequently what is still being maintained years later, and the area that felt heaviest early is often the one described as solid in retrospect.",
  ]);
  assert.deepEqual(countersAt("§1.5"), [
    "The counterweight is that a low threshold for starting is also a low threshold for repair.",
  ]);
  assert.deepEqual(countersAt("§4.3"), [
    "The counter-expression is that squares are where work gets done.",
  ]);
  assert.deepEqual(countersAt("§7.1"), [
    "A reading built only on what is calculable is shorter and says less about arenas, meaning where something plays out, while saying the same amount about tendencies.",
  ]);
  assert.equal(release.records.length, 36);
  assert.equal(new Set(release.records.flatMap((record) => record.source_fragment_ids)).size, 35);
  assert.equal(release.records.filter((record) =>
    record.counter_expressions[0]?.startsWith("The counter-expression is ")).length, 33);
  assert.equal(release.records.filter((record) =>
    record.counter_expressions.length === 1 &&
    record.counter_expressions[0] === record.normalized_proposition).length, 0);
  assert.equal(release.ontology_version, "pattern-ontology-en-us-internal-0.1.2");
  assert.equal(release.evaluation.ontology_version, release.ontology_version);
  assert.equal(release.status, "candidate");
  assert.equal(release.corpus_release_hash, corpus.corpus_hash);
  assert.equal(corpus.corpus_hash, "sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c");
  assert.equal(release.provenance?.authored_by, "pattern-ontology-source-manual-en-us-0.1.0");
});

test("internal builder requires facts supporting pattern and uncertainty meanings", async () => {
  const input = JSON.parse(await readFile(
    new URL("../../../pattern-corpus/fragments.json", import.meta.url), "utf8",
  ));
  const corpus = await buildOntologyCorpusRelease(input, "pattern-ontology-source-manual-en-us-0.1.0");
  const release = await runInternalBuilder(corpus);
  const recordsAt = (location: string) => {
    const fragment = corpus.fragments.find((entry) => entry.location?.startsWith(`${location} `))!;
    return release.records.filter((record) => record.source_fragment_ids.includes(fragment.id));
  };
  for (const location of ["§6.3", "§6.4", "§6.5", "§7.3", "§7.4"]) {
    assert.deepEqual(recordsAt(location), [], `${location} requires facts the predicate cannot establish`);
  }
  const concentration = recordsAt("§6.2");
  assert.equal(concentration.length, 1);
  assert.deepEqual(concentration[0]!.feature_predicate, { type: "pattern", pattern: "stellium" });
  const policy = { policy_id: "natal-feature-policy", policy_version: "1.0.0" } as const;
  for (const [pattern, expected] of [["stellium", true], ["grand_trine", false], ["aspect_chain", false]] as const) {
    const feature: NatalFeature = {
      ...policy, feature_id: `nft_${pattern}`, feature_class: "pattern", pattern,
      member_bodies: ["sun", "moon", "mercury"],
    };
    assert.equal(ontologyRecordMatchesFeature(concentration[0]!, feature), expected, pattern);
    const selected = selectPatternEvidence({
      locale: "en-US", effectiveAccuracy: "exact", featureSetHash: `sha256:${"11".repeat(32)}`,
      features: [feature], ontology: release.records,
    });
    assert.equal(selected.packet.features.length, expected ? 1 : 0, pattern);
  }

  const unknown = recordsAt("§7.1").find((record) => record.feature_predicate.accuracy === "unknown")!;
  const exact = recordsAt("§7.1").find((record) => record.feature_predicate.accuracy === "exact")!;
  const approximate = recordsAt("§7.2")[0]!;
  assert.ok(exact);
  assert.notEqual(exact.id, unknown.id);
  assert.deepEqual(exact.source_fragment_ids, unknown.source_fragment_ids);
  assert.equal(exact.normalized_proposition,
    "Where a factor is missing, the honest form is to name what is absent and stop, rather than to substitute a general statement that would be true of anyone.");
  assert.deepEqual(exact.tensions, ["The failure mode is filling the gap."]);
  assert.deepEqual(exact.counter_expressions, ["What remains is genuinely there."]);
  const source = corpus.fragments.find((fragment) => fragment.id === exact.source_fragment_ids[0])!;
  for (const sentence of [exact.normalized_proposition, ...exact.tensions, ...exact.counter_expressions]) {
    assert.ok(source.excerpt.includes(sentence), "exact-time methodology must quote its cited prepared source");
  }
  const repeat = await runInternalBuilder(corpus);
  assert.deepEqual(repeat, release, "candidate identity and content remain deterministic");

  for (const [accuracy, record] of [["exact", exact], ["approximate", approximate], ["unknown", unknown]] as const) {
    const features: NatalFeature[] = [
      { ...policy, feature_id: "nft_sun", feature_class: "position", body: "sun", longitude: 54.7, sign: 1, house: null },
      { ...policy, feature_id: "nft_moon", feature_class: "position", body: "moon", longitude: 128.4, sign: 4, house: null },
      { ...policy, feature_id: "nft_mercury", feature_class: "position", body: "mercury", longitude: 40, sign: 1, house: null },
      {
        ...policy, feature_id: "nft_uncertainty", feature_class: "uncertainty", accuracy,
        suppressed_features: accuracy === "exact" ? [] : ["houses", "angles", "angle_transits", "moon_time_sensitive"],
      },
    ];
    const selected = selectPatternEvidence({
      locale: "en-US", effectiveAccuracy: accuracy, featureSetHash: `sha256:${"22".repeat(32)}`,
      features, ontology: release.records,
    });
    const uncertainty = selected.packet.features.find((feature) => feature.feature_class === "uncertainty")!;
    assert.equal(uncertainty.coverage, "mandatory_any", accuracy);
    assert.deepEqual(uncertainty.ontology_rule_ids, [record.id], accuracy);
    assert.deepEqual(selected.packet.uncertainty.required_language_rule_ids, [record.id], accuracy);
    const planner = buildDeterministicPlan(selected.packet, release.records);
    assert.deepEqual(validatePatternPlan(planner, selected.packet, release.records), { ok: true, failures: [] }, accuracy);
    const plan = { ...planner, plan_hash: `sha256:${"33".repeat(32)}`, sparse_pattern: selected.packet.selection_constraints.sparse_pattern };
    const writer = buildDeterministicWriterOutput(plan, selected.packet, release.records);
    assert.deepEqual(validatePatternCandidate(writer, plan, selected.packet, release.records), { ok: true, failures: [] }, accuracy);
    const safetyInput = {
      features, selectionManifest: selected.manifest, packet: selected.packet, plan, writer,
      verdict: { schema_version: "0.7.0" as const, verdict: "pass" as const, findings: [] },
      publicProjection: stripPrivateEvidence(writer), ontology: release.records,
      sourceFragmentIds: new Set(corpus.fragments.map((fragment) => fragment.id)),
    };
    assert.deepEqual(evaluatePatternPublicationSafety(safetyInput).failures, [], accuracy);
    const withoutNote = { ...writer, uncertainty_note: null };
    assert.ok(validatePatternCandidate(withoutNote, plan, selected.packet, release.records).failures
      .some((failure) => failure.code === "missing_uncertainty_note"), accuracy);
    assert.ok(evaluatePatternPublicationSafety({ ...safetyInput, writer: withoutNote }).failures
      .some((failure) => failure.code === "mandatory_feature_omission"), accuracy);

    const withoutUncertainty = release.records.filter((entry) => entry.id !== record.id);
    const unsupported = selectPatternEvidence({
      locale: "en-US", effectiveAccuracy: accuracy, featureSetHash: `sha256:${"22".repeat(32)}`,
      features, ontology: withoutUncertainty,
    });
    const unsupportedPlanner = buildDeterministicPlan(unsupported.packet, withoutUncertainty);
    const unsupportedPlan = {
      ...unsupportedPlanner, plan_hash: plan.plan_hash,
      sparse_pattern: unsupported.packet.selection_constraints.sparse_pattern,
    };
    const unsupportedWriter = buildDeterministicWriterOutput(unsupportedPlan, unsupported.packet, withoutUncertainty);
    assert.ok(evaluatePatternPublicationSafety({
      ...safetyInput, ontology: withoutUncertainty, packet: unsupported.packet,
      selectionManifest: unsupported.manifest, plan: unsupportedPlan, writer: unsupportedWriter,
      publicProjection: stripPrivateEvidence(unsupportedWriter),
    }).failures.some((failure) => failure.code === "mandatory_feature_omission"), accuracy);
  }
});

test("internal builder refuses unsupported exact-time guidance from an incompatible source", async () => {
  const input = JSON.parse(await readFile(
    new URL("../../../pattern-corpus/fragments.json", import.meta.url), "utf8",
  ));
  const source = input.find((fragment: { location: string }) => fragment.location.startsWith("§7.1 "));
  for (const missing of [
    "Where a factor is missing, the honest form is to name what is absent and stop, rather than to substitute a general statement that would be true of anyone.",
    "The failure mode is filling the gap.",
    "What remains is genuinely there.",
  ]) {
    const corpus = await buildOntologyCorpusRelease([
      { ...source, excerpt: source.excerpt.replace(missing, "") },
    ], "incompatible-methodology-source-1.0.0");
    await assert.rejects(runInternalBuilder(corpus), /exact-time methodology requires its prepared source sentences/);
  }
});

test("internal builder ignores incidental labels and preserves unmarked fallback behavior", async () => {
  const corpus = await buildOntologyCorpusRelease([
    {
      ...common, ref: "marked", location: "§1.1 Marked",
      normalized_proposition: "This is the main proposition, not its alternative.",
      excerpt: "The same example also contains the quoted label \"The counter-expression is borrowed wording\" without supplying an alternative. The counter-expression is that repair remains available. A separate caution follows.",
    },
    {
      ...common, ref: "unmarked", location: "§1.2 Unmarked",
      normalized_proposition: "This is the main proposition for an unmarked source.",
      excerpt: "A source can express an alternative without labeling it. The same method also supports repair after a difficult start. Further context does not introduce another alternative.",
    },
    {
      ...common, ref: "missing", location: "§1.3 Missing",
      normalized_proposition: "A source without an identified alternative retains its proposition.",
      excerpt: "This source supplies a main observation and a bounded description of it. It does not supply a separately identifiable alternative expression for the builder to extract.",
    },
  ], "counter-expression-fixture-1.0.0");
  const release = await runInternalBuilder(corpus, "pattern-ontology-counter-test-1.0.0");
  const countersFor = (body: string) => release.records.find((record) =>
    record.feature_predicate.body === body)!.counter_expressions;

  assert.deepEqual(countersFor("sun"), ["The counter-expression is that repair remains available."]);
  assert.deepEqual(countersFor("moon"), ["The same method also supports repair after a difficult start."]);
  assert.deepEqual(countersFor("mercury"), ["A source without an identified alternative retains its proposition."]);
  assert.equal(release.ontology_version, "pattern-ontology-counter-test-1.0.0");
  assert.equal(release.evaluation.ontology_version, release.ontology_version);
});

test("builds a canonical release with stable ids and no authoring refs", async () => {
  const release = await buildOntologyCorpusRelease([
    {
      ...common,
      ref: "beta-fragment",
      location: "§2 Beta",
      normalized_proposition: "Beta is the second fixed proposition.",
      excerpt:
        "Beta names a second tendency in neutral language. It presents one expression and a distinct counter-expression without turning either into a verdict about a person.",
    },
    {
      ...common,
      ref: "alpha-fragment",
      location: "§1 Alpha",
      normalized_proposition: "Alpha is the first fixed proposition.",
      excerpt:
        "Alpha names a first tendency in neutral language. It presents one expression and a distinct counter-expression without turning either into a verdict about a person.",
    },
  ], "corpus-manual-1.0.0");

  assert.equal(release.schema_version, "0.7.0");
  assert.equal(release.corpus_release_id, "corpus-manual-1.0.0");
  assert.equal(release.locale, "en-US");
  assert.equal(release.license_resolved, true);
  assert.match(release.corpus_hash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    release.fragments.map((fragment) => ({
      id: fragment.id,
      location: fragment.location,
      hasRef: Object.hasOwn(fragment, "ref"),
    })),
    [
      {
        id: "srcf_c97ba75b97ec63f344a7e6ae93055c66",
        location: "§1 Alpha",
        hasRef: false,
      },
      {
        id: "srcf_2e4e7899f48b2456c52f02a510a9e44d",
        location: "§2 Beta",
        hasRef: false,
      },
    ],
  );
});

test("writes one canonical registration manifest from an authoring file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pattern-corpus-"));
  try {
    const inputPath = join(directory, "fragments.json");
    const outputPath = join(directory, "release.json");
    await writeFile(inputPath, JSON.stringify([
      {
        ...common,
        ref: "alpha-fragment",
        location: "§1 Alpha",
        normalized_proposition: "Alpha is the fixed proposition.",
        excerpt:
          "Alpha names a tendency in neutral language. It presents one expression and a distinct counter-expression without turning either into a verdict about a person.",
      },
    ]));

    const result = await prepareOntologyCorpusFile({
      inputPath,
      outputPath,
      corpusReleaseId: "corpus-file-1.0.0",
    });

    const bytes = await readFile(outputPath, "utf8");
    assert.equal(bytes, result.canonicalBytes);
    assert.equal(result.release.fragments.length, 1);
    assert.equal(result.release.corpus_release_id, "corpus-file-1.0.0");
    assert.deepEqual(JSON.parse(bytes), result.release);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runs the corpus packager without printing source text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pattern-corpus-cli-"));
  try {
    const inputPath = join(directory, "fragments.json");
    const outputPath = join(directory, "release.json");
    const sourceMarker = "SOURCE_TEXT_MUST_NOT_BE_LOGGED";
    await writeFile(inputPath, JSON.stringify([
      {
        ...common,
        ref: "alpha-fragment",
        location: "§1 Alpha",
        normalized_proposition: "Alpha is the fixed proposition.",
        excerpt:
          `${sourceMarker} names a tendency in neutral language. It presents ` +
          "one expression and a distinct counter-expression without a verdict.",
      },
    ]));
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runPrepareOntologyCorpusCli(
      [
        "--input",
        inputPath,
        "--release-id",
        "corpus-cli-1.0.0",
        "--output",
        outputPath,
      ],
      {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(stderr.length, 0);
    assert.equal(stdout.length, 1);
    assert.match(
      stdout[0]!,
      /^PASS corpus_release_id=corpus-cli-1\.0\.0 corpus_hash=sha256:[0-9a-f]{64} fragments=1$/,
    );
    assert.doesNotMatch(JSON.stringify({ stdout, stderr }), /SOURCE_TEXT/);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).fragments.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
