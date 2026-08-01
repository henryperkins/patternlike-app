/**
 * Deterministic stand-in for the Swiss Ephemeris calculation service.
 *
 * Wired as miniflare's `outboundService`, so every outbound fetch from the
 * Worker under test — including `invokeCalc`'s POST to CALC_SERVICE_URL — lands
 * here instead of the network. Tests stay hermetic.
 *
 * It is deterministic on the birth inputs, so identical birth data reproduces
 * the same fingerprint. That is what makes the UNIQUE(user_id, fingerprint)
 * / 409 path testable without running the real engine, whose own behaviour is
 * covered by the 33 tests in apps/calc-stub.
 *
 * Place labels beginning with TRIGGER_ drive the failure paths.
 */

/** Sentinel place labels that make the mock fail in a specific way. */
export const TRIGGER_CALC_ERROR = "TRIGGER_CALC_ERROR";
export const TRIGGER_INVALID_PROFILE = "TRIGGER_INVALID_PROFILE";

/**
 * A filesystem path deliberately embedded in the upstream error message. The
 * API must log it and never return it — the real engine's 502 leaked exactly
 * this shape.
 */
export const LEAKY_UPSTREAM_MESSAGE =
  "swe_calc_ut failed: Ephemeris file /srv/app/apps/calc-stub/data/ephe/sepl_18.se1 not found";

interface CalcRequestBody {
  request_id: string;
  user_id: string;
  profile_version: number;
  accuracy: "exact" | "approximate" | "unknown";
  birth_date: string | null;
  birth_time_local: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  place_label: string | null;
  approximate_window_minutes?: number | null;
  contract_id: string;
  contract_version: string;
}

/** FNV-1a, hex-padded to 64 chars so it satisfies the sha256Hex contract shape. */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = "";
  let acc = h;
  for (let i = 0; i < 8; i++) {
    acc = Math.imul(acc ^ (i + 1), 0x01000193) >>> 0;
    out += acc.toString(16).padStart(8, "0");
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function mockCalcService(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.endsWith("/v1/calculate")) {
    return json({ ok: false, chart: null, error_class: "not_found" }, 404);
  }

  const req = (await request.json()) as CalcRequestBody;

  if (req.place_label === TRIGGER_CALC_ERROR) {
    return json(
      {
        ok: false,
        chart: null,
        error_class: "calc_error",
        error_message: LEAKY_UPSTREAM_MESSAGE,
      },
      400,
    );
  }
  if (req.place_label === TRIGGER_INVALID_PROFILE) {
    return json(
      {
        ok: false,
        chart: null,
        error_class: "invalid_birth_profile",
        error_message: "invalid birth_date: 2023-02-30 (unit out of range)",
      },
      400,
    );
  }

  // Mirrors the real engine's contract: a synthesized noon downgrades the
  // effective accuracy and suppresses everything derived from a birth time.
  const synthetic = req.accuracy === "unknown" || !req.birth_time_local;
  const accuracy = synthetic ? "unknown" : req.accuracy;
  const hasPlace = req.latitude !== null && req.longitude !== null;
  const anglesIncluded = !synthetic && hasPlace;

  const fingerprint =
    "sha256:" +
    stableHash(
      [
        req.birth_date,
        req.birth_time_local,
        req.timezone,
        req.latitude,
        req.longitude,
        accuracy,
      ].join("|"),
    );

  const positions: Array<Record<string, unknown>> = [
    {
      body: "sun",
      longitude_deg: 54.703,
      speed_longitude_deg_per_day: 0.963,
      retrograde: false,
      sign: "taurus",
      house: anglesIncluded ? 10 : null,
    },
    {
      body: "moon",
      longitude_deg: 128.44,
      speed_longitude_deg_per_day: 13.2,
      retrograde: false,
      sign: "leo",
      house: anglesIncluded ? 1 : null,
    },
  ];
  if (anglesIncluded) {
    positions.push(
      { body: "ascendant", longitude_deg: 145.295198, sign: "leo", house: 1 },
      { body: "midheaven", longitude_deg: 50.960263, sign: "taurus", house: 10 },
    );
  }

  const suppressed = anglesIncluded
    ? []
    : [
        { feature_class: "houses", reason: synthetic ? "unknown_birth_time" : "birthplace_unavailable" },
        { feature_class: "angles", reason: synthetic ? "unknown_birth_time" : "birthplace_unavailable" },
        { feature_class: "angle_transits", reason: synthetic ? "unknown_birth_time" : "birthplace_unavailable" },
      ];
  if (synthetic) {
    suppressed.push({ feature_class: "moon_time_sensitive", reason: "unknown_birth_time" });
  }

  return json({
    ok: true,
    chart: {
      schema_version: "0.2.0",
      id: `cht_${crypto.randomUUID().replace(/-/g, "")}`,
      user_id: req.user_id,
      profile_version: req.profile_version,
      fingerprint,
      contract_id: req.contract_id,
      contract_version: req.contract_version,
      container_digest: `sha256:${"c".repeat(64)}`,
      tzdb_version: "2026a",
      birth: {
        accuracy,
        utc_instant: synthetic ? null : `${req.birth_date}T19:34:00.000Z`,
        timezone: req.timezone,
        place_label: req.place_label,
        latitude: req.latitude,
        longitude: req.longitude,
        sensitive_profile: null,
      },
      positions,
      houses: anglesIncluded
        ? { system_used: "placidus", fallback_applied: false, cusps_deg: Array(12).fill(0).map((_, i) => i * 30) }
        : null,
      angles: anglesIncluded
        ? { ascendant_deg: 145.295198, midheaven_deg: 50.960263 }
        : null,
      aspects: [
        {
          id: "asp_mock000000000000000000000001",
          body_a: "sun",
          body_b: "moon",
          aspect: "square",
          orb_deg: 1.2,
          applying: true,
          orb_policy_id: "orb-launch-default",
          orb_policy_version: "0.2.0",
        },
      ],
      patterns: [],
      uncertainty: {
        accuracy,
        window:
          accuracy === "approximate"
            ? {
                plus_minus_minutes: req.approximate_window_minutes ?? 30,
                earliest_local: null,
                latest_local: null,
              }
            : null,
        suppressed_features: suppressed,
        qualified_features: [],
        user_facing_summary: anglesIncluded
          ? "Birth time is exact; houses and angles are included (Swiss Ephemeris)."
          : "Birth time is unknown; houses, angles, and time-sensitive Moon claims are suppressed.",
      },
      calculated_at: "2026-08-01T12:00:00.000Z",
      status: "active",
      r2_uri: null,
    },
  });
}
