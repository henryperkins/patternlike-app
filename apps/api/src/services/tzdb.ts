/**
 * A pinned IANA time-zone database for the Worker.
 *
 * Every JavaScript runtime already carries a tz database through `Intl`, and
 * `@patternlike/shared`'s timezone primitives read it. That is fine for
 * previewing a birth instant, and it is not fine for M5 day boundaries: `Intl`
 * exposes no version, so a Worker deployment that silently picked up a newer
 * database could move a reader's local day without changing any value the frozen
 * command records. An input that can change with no visible trace is not a
 * frozen input.
 *
 * So the data is pinned in `package-lock.json` through `moment-timezone` and
 * read from `data/packed/latest.json`. Only the DATA is used. moment-timezone's
 * runtime is a UMD file inside a CommonJS package, which `@cloudflare/vitest-pool-workers`
 * refuses to load at all — and pulling in `moment` to answer two questions
 * ("what offset, and which database version") would put a date-formatting
 * library in a Worker that needs neither.
 *
 * The decoder below is moment-timezone's own packed format, reproduced
 * faithfully: base-60 digits, cumulative transition deltas in minutes, and an
 * index array that maps each interval to its offset. `tzdb.test.ts` pins it
 * against values taken from moment-timezone itself.
 */

import packed from "moment-timezone/data/packed/latest.json";

interface PackedData {
  version: string;
  zones: string[];
  links: string[];
}

const data = packed as unknown as PackedData;

/** The exact database every V5 day boundary and anchor was resolved against. */
export const TZDB_DATA_VERSION: string = data.version;

interface ZoneTable {
  /** Exclusive upper bound of each interval, ascending, last is Infinity. */
  untils: number[];
  /** Minutes WEST of UTC during each interval, matching moment-timezone's sign. */
  offsets: number[];
}

/**
 * Base-60 with moment-timezone's digit alphabet: 0-9, then A-X for 10-33, then
 * a-x for 34-57. Fractional parts appear for pre-1900 local mean times, which
 * are not whole minutes — Chicago was UTC-05:50:36 until 1883 — so the fraction
 * is kept rather than rounded away.
 */
function charCodeToInt(charCode: number): number {
  if (charCode > 96) return charCode - 87;
  if (charCode > 64) return charCode - 29;
  return charCode - 48;
}

function unpackBase60(value: string): number {
  const [whole = "", fractional = ""] = value.split(".");
  let sign = 1;
  let index = 0;
  if (value.charCodeAt(0) === 45) {
    index = 1;
    sign = -1;
  }
  let out = 0;
  for (; index < whole.length; index += 1) {
    out = 60 * out + charCodeToInt(whole.charCodeAt(index));
  }
  let multiplier = 1;
  for (let i = 0; i < fractional.length; i += 1) {
    multiplier /= 60;
    out += charCodeToInt(fractional.charCodeAt(i)) * multiplier;
  }
  return out * sign;
}

function unpackZone(packedZone: string): ZoneTable {
  const parts = packedZone.split("|");
  const offsets = (parts[2] ?? "").split(" ").map(unpackBase60);
  const indices = (parts[3] ?? "").split("").map((c) => unpackBase60(c));
  const untils = (parts[4] ?? "").split(" ").map(unpackBase60);

  // Untils are cumulative deltas in minutes; the final interval never ends.
  for (let i = 0; i < indices.length; i += 1) {
    untils[i] = Math.round((untils[i - 1] ?? 0) + (untils[i] ?? 0) * 60_000);
  }
  untils[indices.length - 1] = Infinity;

  return {
    untils: untils.slice(0, indices.length),
    offsets: indices.map((index) => offsets[index] ?? 0),
  };
}

const packedByName = new Map<string, string>();
for (const zone of data.zones) {
  packedByName.set(zone.slice(0, zone.indexOf("|")), zone);
}

const linkTargets = new Map<string, string>();
for (const link of data.links) {
  const [target, alias] = link.split("|");
  if (target && alias) linkTargets.set(alias, target);
}

const decoded = new Map<string, ZoneTable>();

function tableFor(zone: string): ZoneTable | null {
  const cached = decoded.get(zone);
  if (cached) return cached;
  const name = packedByName.has(zone) ? zone : linkTargets.get(zone);
  const packedZone = name ? packedByName.get(name) : undefined;
  if (!packedZone) return null;
  const table = unpackZone(packedZone);
  decoded.set(zone, table);
  return table;
}

export function hasZone(zone: string): boolean {
  return tableFor(zone) !== null;
}

/**
 * Which interval `utcMillis` falls in.
 *
 * Reproduces moment-timezone's `closest`: the array is ascending with an
 * `Infinity` terminator, and the answer is the first interval whose bound is
 * strictly greater than the target.
 */
function intervalIndex(untils: number[], utcMillis: number): number {
  const last = untils.length - 1;
  if (utcMillis < untils[0]!) return 0;
  if (utcMillis >= untils[last]!) return last;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (untils[mid]! <= utcMillis) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Offset in minutes WEST of UTC that `zone` observed at `utcMillis`, matching
 * moment-timezone's sign convention so the pinned test vectors are comparable
 * without a mental flip.
 */
export function zoneOffsetMinutesWest(zone: string, utcMillis: number): number {
  const table = tableFor(zone);
  if (!table) throw new Error(`unknown IANA zone: ${zone}`);
  return table.offsets[intervalIndex(table.untils, utcMillis)]!;
}

/** Offset in milliseconds EAST of UTC, which is the direction arithmetic wants. */
export function zoneOffsetMillisEast(zone: string, utcMillis: number): number {
  return -zoneOffsetMinutesWest(zone, utcMillis) * 60_000;
}

/**
 * The civil date `zone` was showing at `utcMillis`, under the PINNED database.
 *
 * Derived from the same offset table rather than from `Intl`, so a resolved
 * anchor and the date it is checked against can never come from two different
 * databases.
 */
export function pinnedLocalDate(zone: string, utcMillis: number): string {
  const local = new Date(Math.round(utcMillis + zoneOffsetMillisEast(zone, utcMillis)));
  const year = String(local.getUTCFullYear()).padStart(4, "0");
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A compact SQLite JSON lookup for exact owner-local-day predicates.
 *
 * The scheduler cannot ask SQLite to apply pinned IANA rules, so it binds this
 * finite map and joins `users.timezone` to the already-resolved local date.
 * Aliases are included because `hasZone()` accepts them as stored preferences.
 */
export function pinnedLocalDateIndexJson(utcMillis: number): string {
  const dates: Record<string, string> = {};
  for (const zone of packedByName.keys()) {
    dates[zone] = pinnedLocalDate(zone, utcMillis);
  }
  for (const [alias, target] of linkTargets) {
    dates[alias] = dates[target] ?? pinnedLocalDate(alias, utcMillis);
  }
  return JSON.stringify(dates);
}
