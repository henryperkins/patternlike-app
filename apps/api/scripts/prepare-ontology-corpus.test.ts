import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
