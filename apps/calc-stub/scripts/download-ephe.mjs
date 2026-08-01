#!/usr/bin/env node
/**
 * Download Swiss Ephemeris planet/moon files (1800–2400) from the official
 * Astrodienst / aloistr repository. Required for high-precision SEFLG_SWIEPH.
 *
 * Source: https://github.com/aloistr/swisseph/tree/master/ephe
 * Licensing: Swiss Ephemeris dual-license (AGPL or commercial) — SE-01.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.SE_EPHE_PATH
  ? path.resolve(process.env.SE_EPHE_PATH)
  : path.join(root, "data", "ephe");

const BASE =
  "https://raw.githubusercontent.com/aloistr/swisseph/master/ephe";

const FILES = [
  "sepl_18.se1", // planets 1800–2400
  "semo_18.se1", // moon 1800–2400
  "seas_18.se1", // main asteroids (optional but useful)
  "sefstars.txt",
  "seorbel.txt",
];

async function download(name) {
  const url = `${BASE}/${name}`;
  const dest = path.join(outDir, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    console.log(`skip  ${name} (exists)`);
    return;
  }
  console.log(`get   ${name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`ok    ${name} (${buf.length} bytes)`);
}

fs.mkdirSync(outDir, { recursive: true });
console.log(`ephe dir: ${outDir}`);
for (const f of FILES) {
  await download(f);
}
console.log("done");
