import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import type { PatternOntologyRelease } from "@patternlike/shared";

import {
  computeOntologyBundleHash,
  ontologySigningPayload,
} from "../src/services/pattern-ontology-verify.js";
import {
  runVerifyActiveOntologyBundleCli,
  verifyActiveOntologyBundle,
  VERIFY_ONTOLOGY_USAGE,
} from "./verify-active-ontology-bundle.js";

const KEY_ID = "ontology-machine-test";
const VERSION = "ontology-verify-1";

type OntologyOrigin = NonNullable<PatternOntologyRelease["provenance"]>["origin"];

type MachineRelease = PatternOntologyRelease & {
  signature?: {
    alg: "Ed25519";
    key_id: string;
    signature: string;
    signed_payload_hash: string;
  };
};

function toBase64Url(value: ArrayBuffer): string {
  return Buffer.from(value).toString("base64url");
}

interface Fixture {
  dir: string;
  bundlePath: string;
  keysPath: string;
  release: MachineRelease;
  args: string[];
}

async function fixture(
  options: {
    origin?: OntologyOrigin;
    signWith?: "trusted" | "other";
    keyIdInKeys?: string;
    mutate?: (release: MachineRelease) => void;
  } = {},
): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "ontology-verify-"));
  const release = syntheticOntologyRelease(VERSION) as MachineRelease;
  release.provenance = { origin: options.origin ?? "machine_pipeline" };
  release.status = "candidate";
  release.evaluation = {
    ...release.evaluation,
    evaluation_report_hash: `sha256:${"a".repeat(64)}`,
    regression_report_hash: `sha256:${"b".repeat(64)}`,
  };
  options.mutate?.(release);

  const trusted = (await webcrypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as webcrypto.CryptoKeyPair;
  const other = (await webcrypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as webcrypto.CryptoKeyPair;

  const bundleHash = await computeOntologyBundleHash(release);
  release.bundle_hash = bundleHash;
  const signingKey = options.signWith === "other"
    ? other.privateKey
    : trusted.privateKey;
  const signature = await webcrypto.subtle.sign(
    { name: "Ed25519" },
    signingKey,
    new TextEncoder().encode(ontologySigningPayload(release)),
  );
  release.signature = {
    alg: "Ed25519",
    key_id: KEY_ID,
    signature: toBase64Url(signature),
    signed_payload_hash: bundleHash,
  };

  const bundlePath = join(dir, "release.json");
  const keysPath = join(dir, "keys.json");
  await writeFile(bundlePath, JSON.stringify(release), "utf8");
  await writeFile(
    keysPath,
    JSON.stringify({
      [options.keyIdInKeys ?? KEY_ID]: {
        alg: "Ed25519",
        public_key: toBase64Url(
          await webcrypto.subtle.exportKey("raw", trusted.publicKey),
        ),
      },
    }),
    "utf8",
  );

  return {
    dir,
    bundlePath,
    keysPath,
    release,
    args: [
      "--bundle", bundlePath,
      "--keys-file", keysPath,
      "--expected-version", VERSION,
      "--expected-bundle-hash", bundleHash,
      "--expected-corpus-hash", release.corpus_release_hash,
    ],
  };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    output: {
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => err.push(line),
    },
  };
}

async function run(args: readonly string[]) {
  const sink = capture();
  const code = await runVerifyActiveOntologyBundleCli(args, sink.output);
  return { code, out: sink.out.join("\n"), err: sink.err.join("\n") };
}

test("accepts a signed machine release and prints only identity and a verdict", async () => {
  const f = await fixture();
  try {
    const result = await run(f.args);
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /^PASS /);
    assert.ok(result.out.includes(`version=${VERSION}`));
    assert.ok(result.out.includes(`bundle_hash=${f.release.bundle_hash}`));
    assert.ok(result.out.includes(`signing_key_id=${KEY_ID}`));
    assert.ok(result.out.includes("origin=machine_pipeline"));

    // The release rules and their reader-facing meanings are the whole point of
    // never printing them: an operator terminal, a CI log, and a ticket paste
    // are all places this command's output ends up.
    const printed = `${result.out}\n${result.err}`;
    for (const record of f.release.records) {
      assert.ok(!printed.includes(record.id), `printed ${record.id}`);
      assert.ok(!printed.includes(record.normalized_proposition));
    }
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("returns the verified identity to a programmatic caller", async () => {
  const f = await fixture();
  try {
    const verified = await verifyActiveOntologyBundle({
      bundlePath: f.bundlePath,
      keysPath: f.keysPath,
      expectedVersion: VERSION,
      expectedBundleHash: f.release.bundle_hash,
      expectedCorpusHash: f.release.corpus_release_hash,
    });
    assert.deepEqual(verified, {
      version: VERSION,
      bundleHash: f.release.bundle_hash,
      corpusReleaseHash: f.release.corpus_release_hash,
      signingKeyId: KEY_ID,
      origin: "machine_pipeline",
    });
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("refuses malformed bundle JSON", async () => {
  const f = await fixture();
  try {
    await writeFile(f.bundlePath, "{not json", "utf8");
    const result = await run(f.args);
    assert.equal(result.code, 1);
    assert.equal(result.err, "FAIL bundle_json_invalid");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("refuses a missing bundle or keyring", async () => {
  const f = await fixture();
  try {
    const missingBundle = await run([
      ...f.args.slice(0, 1), join(f.dir, "absent.json"), ...f.args.slice(2),
    ]);
    assert.equal(missingBundle.err, "FAIL bundle_missing");
    const missingKeys = await run([
      ...f.args.slice(0, 3), join(f.dir, "absent-keys.json"), ...f.args.slice(4),
    ]);
    assert.equal(missingKeys.err, "FAIL keys_missing");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("refuses an unexpected version, bundle hash, or corpus hash", async () => {
  const f = await fixture();
  try {
    const version = await run([
      ...f.args.slice(0, 5), "ontology-other", ...f.args.slice(6),
    ]);
    assert.equal(version.err, "FAIL ontology_version_mismatch");
    const bundle = await run([
      ...f.args.slice(0, 7), `sha256:${"c".repeat(64)}`, ...f.args.slice(8),
    ]);
    assert.equal(bundle.err, "FAIL bundle_hash_mismatch");
    const corpus = await run([
      ...f.args.slice(0, 9), `sha256:${"d".repeat(64)}`,
    ]);
    assert.equal(corpus.err, "FAIL corpus_release_hash_mismatch");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("refuses internal provenance", async () => {
  const f = await fixture({ origin: "synthetic_internal" });
  try {
    const result = await run(f.args);
    assert.equal(result.code, 1);
    assert.equal(result.err, "FAIL provenance_not_machine_pipeline");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("refuses an unknown signing key", async () => {
  const f = await fixture({ keyIdInKeys: "some-other-key" });
  try {
    const result = await run(f.args);
    assert.equal(result.code, 1);
    assert.equal(result.err, "FAIL signature_key_unknown");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("refuses a signature made by a key the keyring does not hold", async () => {
  const f = await fixture({ signWith: "other" });
  try {
    const result = await run(f.args);
    assert.equal(result.code, 1);
    assert.equal(result.err, "FAIL signature_invalid");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("refuses a release the compiler rejects", async () => {
  const f = await fixture({
    mutate: (release) => {
      release.records = [];
    },
  });
  try {
    const result = await run(f.args);
    assert.equal(result.code, 1);
    assert.equal(result.err, "FAIL compiler_rejected");
    assert.ok(!result.err.includes("record"));
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("requires every argument and rejects an unknown one", async () => {
  const f = await fixture();
  try {
    for (const args of [
      [],
      f.args.slice(0, 8),
      [...f.args, "--activation-scope", "public"],
      [...f.args.slice(0, 8), "--unknown", "value"],
      ["--bundle", f.bundlePath, "--bundle", f.bundlePath, ...f.args.slice(2, 8)],
      [...f.args.slice(0, 9), "--expected-corpus-hash"],
    ]) {
      const result = await run(args);
      assert.equal(result.code, 2, JSON.stringify(args));
      assert.equal(result.err, VERIFY_ONTOLOGY_USAGE);
    }
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("prints usage for --help and succeeds", async () => {
  const result = await run(["--help"]);
  assert.equal(result.code, 0);
  assert.equal(result.out, VERIFY_ONTOLOGY_USAGE);
});
