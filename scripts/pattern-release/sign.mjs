#!/usr/bin/env node
// Sign an unsigned release body and emit the ingestion request.
//
// Separate from the builder on purpose. The builder decides what is shippable
// and can run anywhere; this command needs a private key, so it runs only where
// that key is. The key is read from a path the operator supplies and is never
// written to this repository, to the output, to stdout, or to a test snapshot.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createSign, sign as signOneShot } from "node:crypto";

import { canonicalJson, sha256Hex } from "./candidates.mjs";

const ALGORITHMS = new Set(["Ed25519", "ES256"]);

/** The exact bytes the signature covers: the body without signature or bundle hash. */
export function signingPayload(bundle) {
  const { signature: _signature, ...body } = bundle;
  const { bundle_hash: _bundleHash, ...release } = body.release;
  return canonicalJson({ ...body, release });
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signBundle(bundle, { alg, keyId, privateKeyPem }) {
  if (!ALGORITHMS.has(alg)) {
    throw new Error(`Unsupported algorithm ${alg}; expected one of ${[...ALGORITHMS].join(", ")}`);
  }
  const payload = Buffer.from(signingPayload(bundle), "utf8");
  const expected = `sha256:${sha256Hex(payload.toString("utf8"))}`;
  if (bundle.release.bundle_hash !== expected) {
    // Signing bytes whose own declared hash is wrong produces a bundle the
    // Worker rejects after the key has already been used on it.
    throw new Error(
      `release.bundle_hash does not match the body (declared ${bundle.release.bundle_hash}, computed ${expected})`,
    );
  }

  const key = createPrivateKey(privateKeyPem);
  const signature = alg === "Ed25519"
    ? signOneShot(null, payload, key)
    : createSign("SHA256").update(payload).end().sign({ key, dsaEncoding: "ieee-p1363" });

  return {
    ...bundle,
    signature: {
      alg,
      key_id: keyId,
      signature: toBase64Url(signature),
      signed_payload_hash: bundle.release.bundle_hash,
    },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) throw new Error(`Unexpected argument ${flag}`);
    args[flag.slice(2)] = argv[index + 1];
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  for (const required of ["release", "key-id", "private-key-file", "out"]) {
    if (!args[required]) {
      throw new Error(
        "Usage: sign.mjs --release <unsigned.json> --key-id <id> --private-key-file <pem outside this repo> --out <file> [--alg Ed25519|ES256] [--idempotency-key <key>]",
      );
    }
  }
  const keyPath = resolve(args["private-key-file"]);
  if (keyPath.startsWith(resolve(fileURLToPath(new URL("../..", import.meta.url))))) {
    throw new Error("Refusing to read a signing key from inside this repository");
  }

  const bundle = JSON.parse(readFileSync(resolve(args.release), "utf8"));
  const signed = signBundle(bundle, {
    alg: args.alg ?? "Ed25519",
    keyId: args["key-id"],
    privateKeyPem: readFileSync(keyPath, "utf8"),
  });

  const request = {
    schema_version: signed.schema_version,
    bundle: signed,
    idempotency_key: args["idempotency-key"] ?? `release-${signed.release.version}`,
    activate: false,
  };
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  // Deliberately says nothing about the key beyond its id. Activation is a
  // separate, separately authorized operator step.
  process.stdout.write(
    `Signed ${signed.release.version} with key ${args["key-id"]} and wrote the ingestion request to ${out}\n` +
      `activate is false: ingesting this does not serve it to anyone.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
