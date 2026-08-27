/**
 * Offline verification of a downloaded active ontology bundle.
 *
 * A production-safe second opinion: it re-derives the bundle hash from the
 * canonical signing payload, verifies the signature against an explicitly
 * supplied keyring, compiles the release with the same compiler the Worker
 * runs, and requires `provenance.origin = "machine_pipeline"` — the origin half
 * of the invariant `ontologyServesAccount` enforces. The other half,
 * `activation_scope`, is derived from D1 evidence and is not in these bytes, so
 * this command deliberately does not claim to answer it.
 *
 * Every expectation is an explicit argument. There is no default keyring, no
 * environment lookup, and no "current version" inference: an operator running
 * this during a rollout must state what they believe they downloaded, or the
 * command tells them nothing they did not already assume.
 *
 * What it prints is bounded to identity and verdict — version, hashes, signing
 * key id, origin, and a closed pass/fail code. Ontology records are the release
 * rules and the reader-facing meanings; neither may reach an operator terminal,
 * a CI log, or a paste into a ticket.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileOntologyRelease } from "@patternlike/pattern-engine";
import type { PatternOntologyRelease } from "@patternlike/shared";
import {
  computeOntologyBundleHash,
  parseOntologyKeys,
  verifyOntologySignature,
  type SignedOntologyRelease,
} from "../src/services/pattern-ontology-verify.js";

export const VERIFY_ONTOLOGY_USAGE = [
  "usage: --bundle <release.json> --keys-file <keys.json>",
  "       --expected-version <ontology_version>",
  "       --expected-bundle-hash <sha256:...>",
  "       --expected-corpus-hash <sha256:...>",
].join("\n");

const REQUIRED_FLAGS = [
  "--bundle",
  "--keys-file",
  "--expected-version",
  "--expected-bundle-hash",
  "--expected-corpus-hash",
] as const;

type RequiredFlag = (typeof REQUIRED_FLAGS)[number];

export interface VerifyOntologyBundleInput {
  bundlePath: string;
  keysPath: string;
  expectedVersion: string;
  expectedBundleHash: string;
  expectedCorpusHash: string;
}

export interface VerifiedOntologyBundle {
  version: string;
  bundleHash: string;
  corpusReleaseHash: string;
  signingKeyId: string;
  origin: string;
}

/** A closed failure vocabulary. Nothing here is derived from release content. */
export class OntologyBundleVerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OntologyBundleVerificationError";
  }
}

function fail(code: string): never {
  throw new OntologyBundleVerificationError(code);
}

/** `sha256:` is optional in the contract, so two spellings must compare equal. */
function sameHash(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.trim().toLowerCase().replace(/^sha256:/, "");
  const a = normalize(left);
  const b = normalize(right);
  return /^[0-9a-f]{64}$/.test(a) && a === b;
}

async function readJson(path: string, missing: string, invalid: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    fail(missing);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail(invalid);
  }
}

export async function verifyActiveOntologyBundle(
  input: VerifyOntologyBundleInput,
): Promise<VerifiedOntologyBundle> {
  const parsed = await readJson(
    input.bundlePath,
    "bundle_missing",
    "bundle_json_invalid",
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("bundle_not_an_object");
  }
  const signed = parsed as SignedOntologyRelease;

  if (signed.ontology_version !== input.expectedVersion) {
    fail("ontology_version_mismatch");
  }
  if (
    typeof signed.corpus_release_hash !== "string" ||
    !sameHash(signed.corpus_release_hash, input.expectedCorpusHash)
  ) {
    fail("corpus_release_hash_mismatch");
  }
  // The origin half of the serving invariant. `activation_scope` lives in D1
  // evidence, not in these bytes, so a pass here is not "this may serve a
  // reader" -- it is "these bytes are the machine release you named".
  const origin = (signed as PatternOntologyRelease).provenance?.origin;
  if (origin !== "machine_pipeline") fail("provenance_not_machine_pipeline");

  // Recomputed from the canonical signing payload, never read from the file.
  const computed = await computeOntologyBundleHash(signed);
  if (
    typeof signed.bundle_hash !== "string" ||
    !sameHash(signed.bundle_hash, computed) ||
    !sameHash(computed, input.expectedBundleHash)
  ) {
    fail("bundle_hash_mismatch");
  }

  const keysRaw = await readJson(
    input.keysPath,
    "keys_missing",
    "keys_json_invalid",
  );
  const keys = parseOntologyKeys(JSON.stringify(keysRaw));
  if (keys.size === 0) fail("keys_empty");

  const rejection = await verifyOntologySignature(signed, keys);
  if (rejection) fail(rejection.class);

  const compiled = compileOntologyRelease({ ...signed, signature: undefined });
  if (!compiled.ok) fail("compiler_rejected");

  return {
    version: signed.ontology_version,
    bundleHash: computed,
    corpusReleaseHash: signed.corpus_release_hash,
    signingKeyId: signed.signature!.key_id,
    origin,
  };
}

export interface VerifyOntologyBundleOutput {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

function parseArguments(args: readonly string[]): VerifyOntologyBundleInput | null {
  if (args.length !== REQUIRED_FLAGS.length * 2) return null;
  const seen = new Map<RequiredFlag, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] as RequiredFlag;
    const value = args[index + 1];
    if (!REQUIRED_FLAGS.includes(flag) || seen.has(flag)) return null;
    if (value === undefined || value === "" || value.startsWith("--")) return null;
    seen.set(flag, value);
  }
  if (seen.size !== REQUIRED_FLAGS.length) return null;
  return {
    bundlePath: seen.get("--bundle")!,
    keysPath: seen.get("--keys-file")!,
    expectedVersion: seen.get("--expected-version")!,
    expectedBundleHash: seen.get("--expected-bundle-hash")!,
    expectedCorpusHash: seen.get("--expected-corpus-hash")!,
  };
}

export async function runVerifyActiveOntologyBundleCli(
  args: readonly string[],
  output: VerifyOntologyBundleOutput,
): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    output.stdout(VERIFY_ONTOLOGY_USAGE);
    return 0;
  }
  const input = parseArguments(args);
  if (!input) {
    output.stderr(VERIFY_ONTOLOGY_USAGE);
    return 2;
  }
  try {
    const verified = await verifyActiveOntologyBundle(input);
    output.stdout(
      `PASS version=${verified.version} bundle_hash=${verified.bundleHash} ` +
      `corpus_release_hash=${verified.corpusReleaseHash} ` +
      `signing_key_id=${verified.signingKeyId} origin=${verified.origin}`,
    );
    return 0;
  } catch (cause) {
    output.stderr(
      `FAIL ${
        cause instanceof OntologyBundleVerificationError
          ? cause.code
          : "verification_failed"
      }`,
    );
    return 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  process.exitCode = await runVerifyActiveOntologyBundleCli(
    process.argv.slice(2),
    {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    },
  );
}
