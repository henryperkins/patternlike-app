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

/**
 * The hosts `CALC_SERVICE_URL` can name across wrangler's dev and production
 * blocks.
 *
 * Listed rather than inferred from the path, because inferring would defeat the
 * point: the dispatcher fails closed on an unknown host, and a rule that read
 * "anything asking for /v1/cycles is the calculation service" would let any host
 * in through a familiar-looking URL.
 */
const CALCULATION_HOSTS = new Set(["127.0.0.1", "localhost", "patternlike-calc.fly.dev"]);

function isCalculationHost(url: URL): boolean {
  return CALCULATION_HOSTS.has(url.hostname);
}

/**
 * Sentinel chart fingerprints that drive `/v1/cycles` failure paths.
 *
 * Fingerprints rather than a place label, because the cycle request carries no
 * birth data at all — natal longitudes and nothing else, which is the property
 * that keeps a decryption path out of the calculation service. A test seeds a
 * `chart_snapshots` row with one of these and the scan behaves accordingly.
 * All three are well-formed sha256 digests, so nothing downstream can pass or
 * fail for the wrong reason.
 */
export const CYCLE_FP_EMPTY = `sha256:${"e".repeat(64)}`;
export const CYCLE_FP_REFUSED = `sha256:${"f".repeat(64)}`;
export const CYCLE_FP_UNAVAILABLE = `sha256:${"a".repeat(64)}`;

interface CycleRequestBody {
  schema_version: string;
  request_id: string;
  chart_fingerprint: string;
  natal_positions: Array<{ body: string; longitude_deg: number }>;
  natal_accuracy: "exact" | "approximate" | "unknown";
  suppressed_features?: string[];
  window: { from: string; to: string };
  techniques: string[];
  cycle_policy_id: string;
  cycle_policy_version: string;
  orb_policy_id: string;
  orb_policy_version: string;
  contract_id: string;
  contract_version: string;
}

/** `cyc_` + 32 hex, deterministic on the encounter rather than on the scan. */
function mockCycleId(fingerprint: string, encounter: string): string {
  return `cyc_${stableHash(`${fingerprint}|${encounter}`).slice(0, 32)}`;
}

/**
 * Envelopes are absolute and independent of the requested window, which is the
 * real contract: two overlapping request windows that select the same encounter
 * must return the same complete pass list, envelope, first exact time, and id.
 * A mock whose output moved with the window would make that untestable.
 */
function mockCycles(req: CycleRequestBody): Array<Record<string, unknown>> {
  const fp = req.chart_fingerprint;
  const suppressed = new Set(req.suppressed_features ?? []);

  const cycles: Array<Record<string, unknown>> = [
    {
      id: mockCycleId(fp, "saturn|sun|square"),
      technique: "transit",
      body: "saturn",
      target: "sun",
      aspect: "square",
      start_at: "2026-07-19T05:22:10Z",
      exact_at: "2026-08-02T14:11:07Z",
      end_at: "2027-01-26T18:44:02Z",
      pass_count: 3,
      passes: [
        { pass_index: 1, direction: "direct", exact_at: "2026-08-02T14:11:07Z", speed_deg_per_day: 0.0331 },
        { pass_index: 2, direction: "retrograde", exact_at: "2026-10-19T03:52:44Z", speed_deg_per_day: -0.0288 },
        { pass_index: 3, direction: "direct", exact_at: "2027-01-11T21:07:19Z", speed_deg_per_day: 0.0302 },
      ],
      orb_deg: 3,
      importance_score: 0.82,
    },
  ];

  // The real scanner omits natal Moon targets when the chart's uncertainty
  // report suppresses moon_time_sensitive; a transiting Moon against a stable
  // target would still be allowed, and this fixture deliberately has none.
  if (!suppressed.has("moon_time_sensitive")) {
    cycles.push({
      id: mockCycleId(fp, "mars|moon|trine"),
      technique: "transit",
      body: "mars",
      target: "moon",
      aspect: "trine",
      start_at: "2026-08-05T01:00:00Z",
      exact_at: "2026-08-09T12:00:00Z",
      end_at: "2026-08-14T23:00:00Z",
      pass_count: 1,
      passes: [
        { pass_index: 1, direction: "direct", exact_at: "2026-08-09T12:00:00Z", speed_deg_per_day: 0.61 },
      ],
      orb_deg: 2,
      importance_score: 0.41,
    });
  }

  // Response ordering is part of the contract: (exact_at, id).
  return cycles.sort((a, b) => {
    const at = String(a.exact_at);
    const bt = String(b.exact_at);
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
}

async function mockCycleScan(request: Request): Promise<Response> {
  const req = (await request.json()) as CycleRequestBody;

  if (
    !Array.isArray(req.natal_positions) ||
    req.natal_positions.length === 0 ||
    !req.natal_positions.every(
      (position) =>
        position &&
        typeof position.body === "string" &&
        typeof position.longitude_deg === "number" &&
        Number.isFinite(position.longitude_deg),
    ) ||
    !Array.isArray(req.techniques) ||
    req.techniques.length !== 1 ||
    req.techniques[0] !== "transits"
  ) {
    return json(
      {
        ok: false,
        schema_version: req.schema_version,
        request_id: req.request_id,
        error_class: "invalid_cycle_request",
        error_message: "natal_positions and the transits technique are required",
      },
      400,
    );
  }

  if (req.chart_fingerprint === CYCLE_FP_UNAVAILABLE) {
    // Transport envelope with a non-200, the shape the real service uses when a
    // request never reached the engine. The client must read this as
    // `unavailable`, not as a refusal.
    return json({ error: { code: "unauthorized", message: "Valid service credentials are required" } }, 401);
  }

  if (req.chart_fingerprint === CYCLE_FP_REFUSED) {
    return json({
      ok: false,
      schema_version: req.schema_version,
      request_id: req.request_id,
      error_class: "cycle_window_incomplete",
      error_message: "encounter boundaries not proven within the policy lookaround limit",
    });
  }

  return json({
    ok: true,
    schema_version: req.schema_version,
    request_id: req.request_id,
    chart_fingerprint: req.chart_fingerprint,
    cycle_policy_id: req.cycle_policy_id,
    cycle_policy_version: req.cycle_policy_version,
    orb_policy_id: req.orb_policy_id,
    orb_policy_version: req.orb_policy_version,
    contract_id: req.contract_id,
    contract_version: req.contract_version,
    container_digest: `sha256:${"4d".repeat(32)}`,
    ephemeris_data_version: "se-2.10.03-1800-2399",
    cycles: req.chart_fingerprint === CYCLE_FP_EMPTY ? [] : mockCycles(req),
  });
}

/**
 * Sentinel request ids that drive `/v1/daily-sky` failure paths.
 *
 * Request ids rather than a place label or a fingerprint, because the daily-sky
 * request carries neither: it holds natal longitudes, a resolved day, and policy
 * versions, and nothing in it names a chart or a user. That is the property that
 * keeps a decryption path out of the calculation service, so the test seam has
 * to respect it too.
 */
export const DAILY_SKY_REQ_REFUSED = "req_mock_daily_sky_refused";
export const DAILY_SKY_REQ_UNAVAILABLE = "req_mock_daily_sky_unavail";
export const DAILY_SKY_REQ_ZERO_EVENTS = "req_mock_daily_sky_zeroevt";

interface DailySkyRequestBody {
  schema_version: string;
  request_id: string;
  day_start_at: string;
  day_end_at: string;
  anchor_at: string;
  anchor_resolution: string;
  natal_positions: Array<{ body: string; longitude_deg: number }>;
  natal_house_cusps: { house_system: string; cusps_deg: number[] } | null;
  effective_accuracy: "exact" | "approximate" | "unknown";
  suppressed_features: string[];
  ephemeris_data_version: string;
  tzdb_version: string;
  daily_sky_policy_id: string;
  daily_sky_policy_version: string;
  calculation_policy_id: string;
  calculation_policy_version: string;
  contract_id: string;
  contract_version: string;
}

/**
 * `dsf_` + 32 hex over the fact's own content, mirroring the real derivation
 * closely enough that a caller can still check `fact_id === content_digest[0:32]`.
 */
function mockFact(
  req: DailySkyRequestBody,
  kind: string,
  effectiveAt: string,
  label: string,
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const anchored = kind === "anchor_position" || kind === "lunar_phase" || kind === "house_placement";
  const core = {
    kind,
    scope: kind === "transit_natal_contact" || kind === "house_placement" ? "personalized" : "collective",
    effective_at: effectiveAt,
    label,
    precision: anchored
      ? { longitude_decimals: 6, instant_resolution_seconds: null }
      : { longitude_decimals: null, instant_resolution_seconds: 1 },
    detail,
    daily_sky_policy_id: req.daily_sky_policy_id,
    daily_sky_policy_version: req.daily_sky_policy_version,
    calculation_policy_id: req.calculation_policy_id,
    calculation_policy_version: req.calculation_policy_version,
    ephemeris_data_version: req.ephemeris_data_version,
    container_digest: `sha256:${"7e".repeat(32)}`,
  };
  const digest = stableHash(JSON.stringify(core));
  return { ...core, fact_id: `dsf_${digest.slice(0, 32)}`, content_digest: `sha256:${digest}` };
}

async function mockDailySky(request: Request): Promise<Response> {
  const req = (await request.json()) as DailySkyRequestBody;

  if (req.request_id === DAILY_SKY_REQ_UNAVAILABLE) {
    // Transport envelope with a non-200: the request never reached the engine.
    return json(
      { error: { code: "unauthorized", message: "Valid service credentials are required" } },
      401,
    );
  }
  if (req.request_id === DAILY_SKY_REQ_REFUSED) {
    return json({
      ok: false,
      schema_version: req.schema_version,
      request_id: req.request_id,
      error_class: "calculation_failed",
      error_message: "the daily-sky scan did not complete",
    });
  }

  const suppressed = new Set(req.suppressed_features ?? []);
  const facts: Array<Record<string, unknown>> = [
    mockFact(req, "anchor_position", req.anchor_at, "Sun at 7.42 degrees Leo", {
      body: "sun",
      longitude_deg: 127.423118,
      sign: "leo",
      sign_degree_deg: 7.423118,
      speed_deg_per_day: 0.955214,
      retrograde: false,
    }),
    mockFact(req, "anchor_position", req.anchor_at, "Moon at 19.88 degrees Scorpio", {
      body: "moon",
      longitude_deg: 229.882407,
      sign: "scorpio",
      sign_degree_deg: 19.882407,
      speed_deg_per_day: 12.114903,
      retrograde: false,
    }),
    // Always present, on every success: an empty EVENT list must never look
    // like an empty FACTUAL day, or the publisher has nothing to be grounded in.
    mockFact(req, "lunar_phase", req.anchor_at, "Waxing gibbous Moon", {
      phase: "waxing_gibbous",
      elongation_deg: 102.459289,
      illuminated_fraction: 0.606,
    }),
  ];

  if (req.request_id !== DAILY_SKY_REQ_ZERO_EVENTS) {
    const natalTarget = req.natal_positions.find((p) => p.body === "sun");
    if (natalTarget) {
      facts.push(
        mockFact(
          req,
          "transit_natal_contact",
          "2026-07-30T14:11:07Z",
          "Transiting Saturn exactly square natal Sun",
          {
            transiting_body: "saturn",
            natal_target: "sun",
            aspect: "square",
            direction: "retrograde",
            speed_deg_per_day: -0.028812,
          },
        ),
      );
    }
    facts.push(
      mockFact(req, "sign_ingress", "2026-07-30T22:05:31Z", "Mercury enters Virgo", {
        body: "mercury",
        from_sign: "leo",
        to_sign: "virgo",
        direction: "direct",
      }),
    );
  }

  if (req.natal_house_cusps && !suppressed.has("houses")) {
    facts.push(
      mockFact(req, "house_placement", req.anchor_at, "Transiting Saturn in the tenth house", {
        body: "saturn",
        house: 10,
        house_system: req.natal_house_cusps.house_system,
        longitude_deg: 1.774002,
      }),
    );
  }

  const rank = [
    "anchor_position",
    "lunar_phase",
    "transit_natal_contact",
    "sign_ingress",
    "collective_exact_aspect",
    "house_placement",
  ];
  facts.sort((a, b) => {
    const kindDelta = rank.indexOf(String(a.kind)) - rank.indexOf(String(b.kind));
    if (kindDelta !== 0) return kindDelta;
    if (a.effective_at !== b.effective_at) return String(a.effective_at) < String(b.effective_at) ? -1 : 1;
    return String(a.fact_id) < String(b.fact_id) ? -1 : 1;
  });

  return json({
    ok: true,
    schema_version: req.schema_version,
    request_id: req.request_id,
    day_start_at: req.day_start_at,
    day_end_at: req.day_end_at,
    anchor_at: req.anchor_at,
    anchor_resolution: req.anchor_resolution,
    effective_accuracy: req.effective_accuracy,
    suppressed_features: [...(req.suppressed_features ?? [])].sort(),
    daily_sky_policy_id: req.daily_sky_policy_id,
    daily_sky_policy_version: req.daily_sky_policy_version,
    calculation_policy_id: req.calculation_policy_id,
    calculation_policy_version: req.calculation_policy_version,
    contract_id: req.contract_id,
    contract_version: req.contract_version,
    container_digest: `sha256:${"7e".repeat(32)}`,
    ephemeris_data_version: req.ephemeris_data_version,
    tzdb_version: req.tzdb_version,
    facts,
  });
}

/** The provider host. Reached only by the OpenAI publisher adapter. */
export const OPENAI_HOST = "api.openai.com";

/**
 * The single outbound interceptor, dispatching BY HOST first.
 *
 * One seam rather than two: a parallel fetch interceptor installed alongside
 * this one would mean the calculation path and the provider path could each
 * think they had covered the network while the other quietly reached it. Host
 * first, then path, and an unknown host is a hard failure — a test that
 * accidentally addresses a real service should break loudly here rather than
 * make a request.
 */
export async function mockCalcService(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.hostname === OPENAI_HOST) {
    // Task 7 installs the Responses fake behind this seam. Until then the host
    // is routed but unimplemented, which is still a refusal rather than a
    // network call.
    return json(
      { error: { message: "the OpenAI test seam is not installed", type: "not_implemented" } },
      501,
    );
  }

  if (!isCalculationHost(url)) {
    return json({ error: { code: "unmocked_host", message: `no test seam for ${url.hostname}` } }, 502);
  }

  if (url.pathname.endsWith("/v1/cycles")) return mockCycleScan(request);
  if (url.pathname.endsWith("/v1/daily-sky")) return mockDailySky(request);
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
