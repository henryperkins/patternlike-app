#!/usr/bin/env node
/**
 * Download and verify Swiss Ephemeris data files.
 *
 * Every file is fetched from a pinned commit and checked against the SHA-256 in
 * ephemeris.lock.json. Existing files are re-verified rather than trusted for
 * being non-empty, so a truncated or tampered download cannot cache forever —
 * the previous skip check only tested that a file existed and exceeded 1000
 * bytes.
 *
 * Source: https://github.com/aloistr/swisseph/tree/master/ephe
 * Licensing: Swiss Ephemeris dual-license (AGPL or commercial) — SE-01.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "ephemeris.lock.json"), "utf8"),
);

const outDir = process.env.SE_EPHE_PATH
  ? path.resolve(process.env.SE_EPHE_PATH)
  : path.join(root, "data", "ephe");

const BASE = `https://raw.githubusercontent.com/aloistr/swisseph/${lock.commit}/${lock.path}`;

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function verify(name, buf, expected) {
  const actual = sha256(buf);
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch\n  expected ${expected}\n  actual   ${actual}\n` +
        `  source   ${BASE}/${name}\n` +
        `  If upstream changed intentionally, update ephemeris.lock.json deliberately.`,
    );
  }
  return actual;
}

async function ensure(entry) {
  const dest = path.join(outDir, entry.name);

  if (fs.existsSync(dest)) {
    const existing = fs.readFileSync(dest);
    if (sha256(existing) === entry.sha256) {
      console.log(`ok    ${entry.name} (verified, ${existing.length} bytes)`);
      return;
    }
    console.log(`stale ${entry.name} (digest mismatch, re-downloading)`);
  }

  console.log(`get   ${entry.name}`);
  const url = `${BASE}/${entry.name}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  verify(entry.name, buf, entry.sha256);
  fs.writeFileSync(dest, buf);
  console.log(`ok    ${entry.name} (${buf.length} bytes, digest verified)`);
}

fs.mkdirSync(outDir, { recursive: true });
console.log(`ephe dir: ${outDir}`);
console.log(`pinned:   ${lock.commit}`);

let failed = 0;
let fatal = false;
for (const entry of lock.files) {
  try {
    await ensure(entry);
  } catch (err) {
    failed++;
    const required = entry.required !== false;
    console.error(`${required ? "FATAL" : "warn "} ${entry.name}: ${err.message}`);
    if (required) fatal = true;
  }
}

const missingRequired = lock.files
  .filter((f) => f.required !== false)
  .filter((f) => !fs.existsSync(path.join(outDir, f.name)));

if (missingRequired.length) {
  console.error(
    `FATAL required ephemeris files missing: ${missingRequired.map((f) => f.name).join(", ")}`,
  );
  process.exit(1);
}
if (fatal) {
  process.exit(1);
}
console.log(`done (${lock.files.length - failed}/${lock.files.length} verified)`);
