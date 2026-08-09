import tzlookup from "tz-lookup";
import {
  TZDB_STABLE_FROM_YEAR,
  isValidIanaZone,
  parseCivilDateTime,
  resolveLocalWallTime,
  type ResolvedLocalTime,
  type TimezoneConfidence,
  type TimezoneQualifier,
  type TimezoneSource,
} from "@patternlike/shared";

/**
 * Historical timezone resolution.
 *
 * Two questions have to be answered in order, and only the first one needs a
 * dataset. *Which zone* a coordinate falls in comes from `tz-lookup` (CC0), a
 * ~150 KB encoded raster of the tz boundaries that runs anywhere and needs no
 * network — which matters, because sending a birthplace to a third-party
 * geocoder would make the consent ledger's "not connected" column untrue.
 * *What that zone's clock read* on the birth date is then the tz database's
 * job, through the shared `Intl` helpers.
 *
 * Two limits are real and are surfaced rather than hidden. The raster is built
 * from timezone-boundary-builder 2019b, so boundary changes since then are
 * missing and the lossy encoding drifts near borders — hence the proximity
 * probe below. And tzdb only promises that a zone id matches a location's
 * clocks from 1970 onward, so an earlier birth is reported at reduced
 * confidence rather than presented as settled.
 */

/** Roughly 11 km at the equator; enough to notice a boundary running nearby. */
const PROBE_DEGREES = 0.1;

export interface CoordinateZone {
  timezone: string;
  boundaryNearby: boolean;
}

function clampLatitude(value: number): number {
  return Math.min(90, Math.max(-90, value));
}

/** Keeps a probe that stepped past the antimeridian on the globe. */
function wrapLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function zoneAt(latitude: number, longitude: number): string | null {
  try {
    const zone = tzlookup(clampLatitude(latitude), wrapLongitude(longitude));
    return zone && isValidIanaZone(zone) ? zone : null;
  } catch {
    // tz-lookup throws on non-finite input rather than returning null.
    return null;
  }
}

/**
 * Resolve coordinates to a zone, and report whether the point sits close enough
 * to a boundary that the answer is worth confirming. Boundary proximity is the
 * failure mode a raster lookup actually has: in the middle of a zone it is
 * exact, and within a few kilometres of a border it can land on the wrong side.
 */
export function zoneFromCoordinates(
  latitude: number,
  longitude: number,
): CoordinateZone | null {
  const timezone = zoneAt(latitude, longitude);
  if (!timezone) return null;

  // A degree of longitude shrinks toward the poles; widen the step so the probe
  // covers a comparable ground distance instead of a few metres at latitude 89.
  const cosLat = Math.cos((clampLatitude(latitude) * Math.PI) / 180);
  const lonStep = PROBE_DEGREES / Math.max(Math.abs(cosLat), 0.01);

  const probes: Array<[number, number]> = [
    [PROBE_DEGREES, 0],
    [-PROBE_DEGREES, 0],
    [0, lonStep],
    [0, -lonStep],
  ];

  let boundaryNearby = false;
  for (const [dLat, dLon] of probes) {
    if (zoneAt(latitude + dLat, longitude + dLon) !== timezone) {
      boundaryNearby = true;
      break;
    }
  }

  return { timezone, boundaryNearby };
}

export interface TimezoneResolutionInput {
  latitude?: number | null;
  longitude?: number | null;
  birthDate?: string | null;
  birthTimeLocal?: string | null;
  timezoneHint?: string | null;
}

export interface TimezoneResolution {
  timezone: string;
  source: TimezoneSource;
  confidence: TimezoneConfidence;
  boundaryNearby: boolean;
  /** The hint that was set aside because coordinates disagreed with it. */
  hintOverridden: string | null;
  local: ResolvedLocalTime | null;
  qualifiers: TimezoneQualifier[];
}

/**
 * `Etc/GMT±N` is what the boundary dataset returns for open water. It is a
 * fixed offset with no history, so a birth that lands on one is almost always a
 * coordinate typo — a swapped latitude and longitude, or a missing sign.
 */
function isNauticalZone(zone: string): boolean {
  return zone === "Etc/UTC" || zone === "Etc/GMT" || zone.startsWith("Etc/GMT");
}

function hasCoordinates(
  input: TimezoneResolutionInput,
): input is TimezoneResolutionInput & { latitude: number; longitude: number } {
  return (
    typeof input.latitude === "number" &&
    Number.isFinite(input.latitude) &&
    typeof input.longitude === "number" &&
    Number.isFinite(input.longitude)
  );
}

/**
 * Decide the zone a chart will be calculated in.
 *
 * Coordinates win when they are present. The browser's current zone — which is
 * what the web client can offer without a lookup — is wrong for anyone who has
 * moved since being born, and it is not a value the user can meaningfully
 * check, so it is used only when there is nothing better.
 */
export function resolveTimezone(input: TimezoneResolutionInput): TimezoneResolution {
  const qualifiers: TimezoneQualifier[] = [];
  const hint =
    typeof input.timezoneHint === "string" && input.timezoneHint.trim()
      ? input.timezoneHint.trim()
      : null;
  const validHint = hint && isValidIanaZone(hint) ? hint : null;

  let timezone = "UTC";
  let source: TimezoneSource = "default";
  let boundaryNearby = false;
  let hintOverridden: string | null = null;

  const coordinateZone = hasCoordinates(input)
    ? zoneFromCoordinates(input.latitude, input.longitude)
    : null;

  if (coordinateZone) {
    timezone = coordinateZone.timezone;
    source = "coordinates";
    boundaryNearby = coordinateZone.boundaryNearby;
    if (validHint && validHint !== timezone) {
      hintOverridden = validHint;
      qualifiers.push({
        code: "hint_replaced",
        message: `The birthplace coordinates resolve to ${timezone}, so ${validHint} was not used.`,
      });
    }
  } else if (validHint) {
    timezone = validHint;
    source = "hint";
    qualifiers.push({
      code: "no_coordinates",
      message:
        "No birthplace coordinates were supplied, so the timezone is taken as given and cannot be checked against a location.",
    });
  } else {
    qualifiers.push({
      code: "no_coordinates",
      message:
        "Neither coordinates nor a valid IANA timezone were supplied, so the chart falls back to UTC.",
    });
  }

  if (boundaryNearby) {
    qualifiers.push({
      code: "near_zone_boundary",
      message:
        "This birthplace is within a few kilometres of a timezone boundary. Confirm the zone against a birth record.",
    });
  }
  if (source === "coordinates" && isNauticalZone(timezone)) {
    qualifiers.push({
      code: "nautical_zone",
      message:
        "These coordinates fall in open water, where the zone is a fixed nautical offset with no local history. Check the latitude and longitude.",
    });
  }

  const civil = input.birthDate
    ? parseCivilDateTime(input.birthDate, input.birthTimeLocal ?? null)
    : null;
  const local = civil ? resolveLocalWallTime(timezone, civil) : null;

  if (civil && civil.year < TZDB_STABLE_FROM_YEAR) {
    qualifiers.push({
      code: "pre_1970_zone_boundary",
      message: `The timezone database only guarantees that ${timezone} matches this location's clocks from ${TZDB_STABLE_FROM_YEAR} onward. Confirm the offset against a birth record.`,
    });
  }
  if (local?.resolution === "ambiguous") {
    qualifiers.push({
      code: "local_time_ambiguous",
      message: `Clocks in ${timezone} ran through this local time twice that day. The earlier of the two instants was used.`,
    });
  }
  if (local?.resolution === "nonexistent") {
    qualifiers.push({
      code: "local_time_nonexistent",
      message: `Clocks in ${timezone} skipped this local time that day. The instant just after the change was used.`,
    });
  }

  return {
    timezone,
    source,
    confidence: gradeConfidence(source, boundaryNearby, civil?.year ?? null),
    boundaryNearby,
    hintOverridden,
    local,
    qualifiers,
  };
}

function gradeConfidence(
  source: TimezoneSource,
  boundaryNearby: boolean,
  year: number | null,
): TimezoneConfidence {
  // Nothing was geocoded, so there is no geocode to grade.
  if (source !== "coordinates") return "none";

  const preTzdb = year !== null && year < TZDB_STABLE_FROM_YEAR;
  if (boundaryNearby && preTzdb) return "low";
  if (boundaryNearby || preTzdb) return "medium";
  return "high";
}
