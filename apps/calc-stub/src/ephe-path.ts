import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve Swiss Ephemeris data directory.
 * Order: SE_EPHE_PATH env → apps/calc-stub/data/ephe → cwd/data/ephe
 */
export function resolveEphePath(): string {
  if (process.env.SE_EPHE_PATH) {
    return path.resolve(process.env.SE_EPHE_PATH);
  }
  const candidates = [
    path.resolve(here, "../data/ephe"),
    path.resolve(process.cwd(), "data/ephe"),
    path.resolve(process.cwd(), "apps/calc-stub/data/ephe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "sepl_18.se1"))) return p;
  }
  return candidates[0]!;
}

export function assertEphePresent(ephePath: string): void {
  const required = ["sepl_18.se1", "semo_18.se1"];
  const missing = required.filter(
    (f) => !fs.existsSync(path.join(ephePath, f)),
  );
  if (missing.length) {
    throw new Error(
      `Swiss Ephemeris data missing in ${ephePath}: ${missing.join(", ")}. ` +
        `Run: npm run ephe:download -w @patternlike/calc-stub`,
    );
  }
}
