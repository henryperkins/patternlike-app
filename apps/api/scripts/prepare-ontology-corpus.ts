import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  contentHash,
  type PatternTransformationClass,
} from "@patternlike/shared";
import {
  canonicalizeOntologyCorpusRelease,
  type OntologyCorpusFragment,
  type OntologyCorpusRelease,
} from "../src/services/ontology-corpus.js";

interface AuthoredOntologyCorpusFragment {
  ref: string;
  title: string;
  author: string;
  edition: string;
  location: string;
  locale: string;
  normalized_proposition: string;
  excerpt: string;
  exclusions: string[];
  license_class: "licensed_excerpt" | "internal_synthetic";
  allowed_transformations: PatternTransformationClass[];
}

const AUTHORING_KEYS = new Set([
  "ref",
  "title",
  "author",
  "edition",
  "location",
  "locale",
  "normalized_proposition",
  "excerpt",
  "exclusions",
  "license_class",
  "allowed_transformations",
]);

function authoredFragments(value: unknown): AuthoredOntologyCorpusFragment[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("ontology_corpus_authoring_invalid");
  }
  for (const fragment of value) {
    if (
      fragment === null ||
      typeof fragment !== "object" ||
      Array.isArray(fragment) ||
      Object.keys(fragment).some((key) => !AUTHORING_KEYS.has(key))
    ) {
      throw new Error("ontology_corpus_authoring_invalid");
    }
  }
  return value as AuthoredOntologyCorpusFragment[];
}

function fragmentId(corpusReleaseId: string, ref: string): string {
  const identity = [
    "pattern-source-fragment-v1",
    corpusReleaseId,
    ref,
  ].join("\n");
  return `srcf_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

export async function buildOntologyCorpusRelease(
  value: unknown,
  corpusReleaseId: string,
): Promise<OntologyCorpusRelease> {
  const authored = [...authoredFragments(value)].sort((left, right) =>
    left.ref.localeCompare(right.ref)
  );
  const locale = authored[0]!.locale;
  const seenRefs = new Set<string>();
  const fragments: OntologyCorpusFragment[] = authored.map((fragment) => {
    if (seenRefs.has(fragment.ref)) {
      throw new Error("ontology_corpus_authoring_duplicate_ref");
    }
    seenRefs.add(fragment.ref);
    return {
      id: fragmentId(corpusReleaseId, fragment.ref),
      corpus_release_id: corpusReleaseId,
      locale: fragment.locale,
      title: fragment.title,
      author: fragment.author,
      edition: fragment.edition,
      location: fragment.location,
      exclusions: fragment.exclusions,
      normalized_proposition: fragment.normalized_proposition,
      excerpt: fragment.excerpt,
      license_class: fragment.license_class,
      allowed_transformations: fragment.allowed_transformations,
    };
  });
  const body = {
    schema_version: "0.7.0" as const,
    corpus_release_id: corpusReleaseId,
    locale,
    license_resolved: true as const,
    fragments,
  };
  const release = {
    ...body,
    corpus_hash: await contentHash(canonicalJson(body)),
  } satisfies OntologyCorpusRelease;
  return (await canonicalizeOntologyCorpusRelease(release)).release;
}

export async function prepareOntologyCorpusFile(options: {
  inputPath: string;
  outputPath: string;
  corpusReleaseId: string;
}): Promise<{
  release: OntologyCorpusRelease;
  canonicalBytes: string;
}> {
  const value = JSON.parse(await readFile(options.inputPath, "utf8")) as unknown;
  const release = await buildOntologyCorpusRelease(
    value,
    options.corpusReleaseId,
  );
  const canonicalBytes = canonicalJson(release);
  await writeFile(options.outputPath, canonicalBytes, {
    encoding: "utf8",
    flag: "wx",
  });
  return { release, canonicalBytes };
}

export async function runPrepareOntologyCorpusCli(
  args: readonly string[],
  output: {
    stdout(line: string): void;
    stderr(line: string): void;
  },
): Promise<number> {
  if (
    args.length !== 6 ||
    args[0] !== "--input" ||
    args[2] !== "--release-id" ||
    args[4] !== "--output"
  ) {
    output.stderr(
      "usage: --input <fragments.json> --release-id <id> --output <release.json>",
    );
    return 2;
  }
  try {
    const result = await prepareOntologyCorpusFile({
      inputPath: args[1]!,
      corpusReleaseId: args[3]!,
      outputPath: args[5]!,
    });
    output.stdout(
      `PASS corpus_release_id=${result.release.corpus_release_id} ` +
      `corpus_hash=${result.release.corpus_hash} ` +
      `fragments=${result.release.fragments.length}`,
    );
    return 0;
  } catch (cause) {
    const code = cause instanceof SyntaxError
      ? "input_json_invalid"
      : cause instanceof Error && cause.message.startsWith("ontology_corpus_")
        ? cause.message
        : cause instanceof Error && "code" in cause && cause.code === "EEXIST"
          ? "output_exists"
          : cause instanceof Error && "code" in cause && cause.code === "ENOENT"
            ? "input_missing"
            : "corpus_prepare_failed";
    output.stderr(`FAIL ${code}`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  process.exitCode = await runPrepareOntologyCorpusCli(
    process.argv.slice(2),
    {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    },
  );
}
