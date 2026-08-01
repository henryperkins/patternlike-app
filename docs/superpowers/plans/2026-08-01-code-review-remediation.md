# Code Review Remediation Implementation Plan

> **STATUS: EXECUTED.** All nine tasks were implemented and committed, `53847f0..0d2784b`.
> Final state: `npm run typecheck` clean, calc-stub 33 tests pass, api 26 tests pass,
> `npm run test:contracts` passes, `npm run build` exits 0 with `apps/calc-stub/dist` populated.
> Two things diverged from the plan as written, both deliberately:
> 1. Task 1 gained a tenth test after the NaN Julian day was found to **corrupt sweph's
>    ephemeris cache for the life of the process**, failing every subsequent request from
>    every user — a worse consequence than the review reported.
> 2. Task 8's `.dockerignore` was created at the repository root, not in `apps/calc-stub/`.
>    The build context is the repo root, so a file inside `apps/calc-stub` would have no effect.
>
> Contract-level findings deliberately not patched in code are recorded in
> [`docs/reviews/2026-08-01-spec-escalations.md`](../../reviews/2026-08-01-spec-escalations.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute steps 1–7 of the suggested remediation order from the Pattern-Like code review, so the M0/M1 skeleton fails closed instead of emitting confidently wrong charts, silently losing users' data, and encrypting birth PII under a key committed to the repo.

**Architecture:** Three layers get fixed independently. The **calculation engine** (`apps/calc-stub`) stops accepting impossible inputs and stops labelling synthesized values as fact — every claim in a chart must be derivable from something the caller actually supplied. The **API** (`apps/api`) scopes idempotency to the user, writes birth profile + job + chart atomically through `D1.batch()`, and refuses to boot into a production-shaped environment with development secrets. The **supply chain** (Dockerfile, ephemeris download, contract fixture) pins the Swiss Ephemeris data by commit and SHA-256 so the reproducibility claims in the calculation contract are true. Contract-level defects that the code implements *correctly* are escalated to a document rather than patched in code.

**Tech Stack:** TypeScript 5.8 (strict), Node 22, Hono 4 on Cloudflare Workers, D1 (SQLite), Swiss Ephemeris 2.10.03 via `sweph@2.10.3-7`, Luxon 3 for timezone resolution, `node:test` for calc-stub, Vitest 3 for api, Python 3.12 for contract validators.

## Global Constraints

- **Do not change `schema_version`.** It is `0.2.0` everywhere and frozen for M0.
- **No new runtime dependencies.** Every fix uses what is already in `package.json`.
- **TypeScript is strict** with `noUnusedLocals` and `noUnusedParameters` (`tsconfig.base.json:15-16`). Dead bindings are a compile error, not a lint warning.
- **calc-stub tests use `node:test` + `node:assert/strict`.** API tests use `vitest`. Do not mix them.
- **Test discovery:** calc-stub runs `tsx --test src/**/*.test.ts`. After adding a test file, confirm the reported `ℹ tests N` count actually increased — a file that is never discovered passes silently.
- **The D1 migration `0001_m0_core.sql` is edited in place.** This is the documented M0 policy (`db/d1/MIGRATIONS.json:12`) and is now safe because git history exists. Local databases must be recreated with `npm run db:local -w @patternlike/api`.
- **Every schema edit must keep `python contracts/m0/smoke_check.py` passing** — it executes the SQL against in-memory SQLite and asserts 21 tables plus two CHECK constraints.
- **Error responses use the documented envelope**: `{ "error": { "code", "message", "request_id" } }`. Never return plain text, and never put a filesystem path, stack trace, or upstream exception string in `message`.
- **Baseline to preserve** (verified green before this plan starts): `npm run typecheck` clean; calc-stub 8 tests pass; api 2 tests pass; `npm run test:contracts` passes.

## Verified Facts This Plan Depends On

These were confirmed by running code, not by reading it. Do not re-derive them.

| Fact | Evidence |
|---|---|
| `DateTime.fromObject({year:2023,month:2,day:30},{zone:'UTC'}).isValid === false` (`invalidReason: "unit out of range"`) | Luxon probe |
| Same for `2023-02-29` and `2023-13-01`; `2024-02-29` is valid | Luxon probe |
| `IANAZone.isValidZone('Mars/Olympus') === false`; `('UTC')`, `('utc')`, `('PST')`, `('Etc/GMT+5')` are all `true`; `('')` is `false` | Luxon probe |
| A DST spring-forward gap time stays **valid** — Luxon shifts it forward (2023-03-12 02:30 New York → 03:30-04:00). So `!dt.isValid` after date+zone validation is a backstop, not the DST path. | Luxon probe |
| Current `2023-02-30` path yields `year/month/day = NaN/NaN/NaN`, `toISO() === null`, `hourDecimal = NaN` | Luxon probe |
| Upstream `aloistr/swisseph` master is `85e65da01dce506bd0ec044ad3e39ab6d144d82b`, and all five ephemeris files at that commit byte-match the local copies | `git ls-remote` + SHA-256 comparison of downloaded vs local |
| `contracts/m0/chart-contract.schema.json:82-94` sets `additionalProperties: false` on `data_files[]`, allowing only `name` and `sha256` | schema read |
| OpenAPI declares `'409'` for `POST /v1/birth-profiles` (`openapi.yaml:54`) | grep |

## File Structure

| File | Change | Responsibility after this plan |
|---|---|---|
| `apps/calc-stub/src/engine.ts` | Modify | Reject impossible input; suppress derived facts that were not actually computed; correct applying/separating |
| `apps/calc-stub/src/validation.test.ts` | Create | Calendar date, IANA zone, time format, coordinate range, ephemeris range |
| `apps/calc-stub/src/aspects.test.ts` | Create | Applying/separating against a numerically differentiated orb |
| `apps/calc-stub/src/uncertainty.test.ts` | Create | The uncertainty report describes what was actually computed |
| `apps/calc-stub/ephemeris.lock.json` | Create | Pinned upstream commit + per-file SHA-256 |
| `apps/calc-stub/scripts/download-ephe.mjs` | Rewrite | Fetch from the pinned commit, verify every byte, fail loudly |
| `apps/calc-stub/Dockerfile` | Modify | Verify the directory the downloader actually writes to |
| `apps/calc-stub/.dockerignore` | Create | Keep stale host files out of the build context |
| `apps/calc-stub/tsconfig.json` | Modify | `build` emits; `typecheck` stays `--noEmit` via CLI flag |
| `db/d1/0001_m0_core.sql` | Modify | User-scoped idempotency; `user_keys` keyed for rotation |
| `db/d1/MIGRATIONS.json` | Modify | Record the in-place edit and the local-reset requirement |
| `apps/api/src/routes/birth.ts` | Rewrite body | Validate, scope, batch, 409, never orphan a row |
| `apps/api/src/index.ts` | Modify | `onError` envelope; config guard middleware; `serviceAuth` on internal routes |
| `apps/api/src/routes/stubs.ts` | Modify | Split internal routes out of the consumer router |
| `apps/api/src/middleware/config-guard.ts` | Create | Refuse dev secrets in a non-dev environment |
| `apps/api/src/crypto.ts` | Modify | HKDF-derived KEK; no silent dev fallback outside dev |
| `apps/api/src/db/users.ts` | Modify | Key rotation-capable; destroyed keys are 410, not a permanent 500 |
| `apps/api/src/crypto.test.ts` | Modify | Cover fail-closed behaviour |
| `apps/api/src/config.test.ts` | Create | Config guard truth table |
| `apps/api/wrangler.toml` | Modify | `[env.production]` without `AUTH_STUB` |
| `apps/api/package.json` | Modify | `deploy` targets the production environment |
| `contracts/m0/fixtures/valid/calculation-contract.launch.json` | Modify | Real hashes for the files the engine actually loads |
| `contracts/m0/smoke_check.py` | Modify | Regression check: two users may reuse one idempotency key |
| `docs/reviews/2026-08-01-spec-escalations.md` | Create | Contract-level defects the code implements faithfully |
| `README.md` | Modify | Remove the completeness claim the code does not support |

---

### Task 0: Initialize git and commit the baseline — **COMPLETE**

Done before this plan was written. `git init -b main`, then commit `53847f0` "Baseline: M0/M1 skeleton as reviewed" — 83 files, no `node_modules`, no source modified. This unblocks CI (which had never run), gives `MIGRATIONS.json`'s in-place edit policy something to fall back on, and makes the `AGPL_SOURCE_OFFER.md` clone-at-tag procedure operable.

---

### Task 1: Reject impossible calculation input

**Files:**
- Modify: `apps/calc-stub/src/engine.ts:144-198` (`resolveUtcInstant`), `:365-400` (`calculateChart` guards)
- Test: `apps/calc-stub/src/validation.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveUtcInstant(req: CalcRequest): UtcInstantParts` now **throws** `Error` on a non-existent calendar date, an unknown IANA zone, a malformed `birth_time_local`, or a date outside the ephemeris range. `UtcInstantParts` is unchanged. `calculateChart` catches these and returns `{ ok: false, error_class: "invalid_birth_profile" }` — Task 2 and Task 5 rely on `invalid_birth_profile` being the class for all bad input.
- Produces: `EPHEMERIS_MIN_YEAR = 1800`, `EPHEMERIS_MAX_YEAR = 2399` exported from `engine.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/calc-stub/src/validation.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateChart, resolveUtcInstant } from "./engine.js";
import type { CalcRequest } from "@patternlike/shared";

function req(overrides: Partial<CalcRequest> = {}): CalcRequest {
  return {
    request_id: "val_1",
    user_id: "usr_validation_0001",
    profile_version: 1,
    accuracy: "exact",
    birth_date: "1990-05-15",
    birth_time_local: "12:34:00",
    timezone: "America/Los_Angeles",
    latitude: 34.0522,
    longitude: -118.2437,
    place_label: "Los Angeles, CA, US",
    contract_id: "calc-contract-launch",
    contract_version: "0.2.0",
    ...overrides,
  };
}

describe("calculation input validation", () => {
  it("rejects calendar dates that do not exist", async () => {
    for (const birth_date of ["2023-02-30", "2023-02-29", "2023-13-01", "2023-00-10"]) {
      const res = await calculateChart(req({ birth_date }));
      assert.equal(res.ok, false, `${birth_date} should not produce a chart`);
      assert.equal(res.chart, null);
      assert.equal(res.error_class, "invalid_birth_profile", `${birth_date} error_class`);
    }
  });

  it("accepts a real leap day", async () => {
    const res = await calculateChart(req({ birth_date: "2024-02-29" }));
    assert.equal(res.ok, true);
    assert.ok(res.chart);
  });

  it("rejects malformed date strings instead of coercing them", async () => {
    for (const birth_date of ["1990-5-15", "15/05/1990", "1990-05-15T12:00:00Z", ""]) {
      const res = await calculateChart(req({ birth_date }));
      assert.equal(res.ok, false, `${JSON.stringify(birth_date)} should be rejected`);
    }
  });

  it("rejects an unknown IANA zone instead of silently computing in UTC", async () => {
    const res = await calculateChart(req({ timezone: "Mars/Olympus" }));
    assert.equal(res.ok, false);
    assert.equal(res.error_class, "invalid_birth_profile");
    assert.match(res.error_message ?? "", /timezone/i);
  });

  it("rejects malformed or out-of-range local times", async () => {
    for (const birth_time_local of ["25:00", "12:60:00", "noon", "12"]) {
      const res = await calculateChart(req({ birth_time_local }));
      assert.equal(res.ok, false, `${birth_time_local} should be rejected`);
      assert.equal(res.error_class, "invalid_birth_profile");
    }
  });

  it("rejects coordinates outside the valid range or of the wrong type", async () => {
    const bad: Array<Partial<CalcRequest>> = [
      { latitude: 999 },
      { latitude: -91 },
      { longitude: 181 },
      { longitude: -180.5 },
      { latitude: Number.POSITIVE_INFINITY },
      { latitude: "34.05" as unknown as number },
      { longitude: "-118.24" as unknown as number },
    ];
    for (const patch of bad) {
      const res = await calculateChart(req(patch));
      assert.equal(res.ok, false, `${JSON.stringify(patch)} should be rejected`);
      assert.equal(res.error_class, "invalid_birth_profile");
    }
  });

  it("rejects dates outside the pinned ephemeris range without leaking a filesystem path", async () => {
    for (const birth_date of ["1799-12-31", "2400-01-01"]) {
      const res = await calculateChart(req({ birth_date }));
      assert.equal(res.ok, false, `${birth_date} should be rejected`);
      assert.equal(res.error_class, "invalid_birth_profile");
      const message = res.error_message ?? "";
      assert.ok(!/[A-Za-z]:\\|\/(home|Users|app)\//.test(message), `path leaked: ${message}`);
    }
  });

  it("never returns a chart containing a null longitude", async () => {
    const res = await calculateChart(req({ birth_date: "2023-02-30" }));
    assert.equal(res.chart, null);
  });

  it("resolveUtcInstant throws rather than falling back to UTC on a bad zone", () => {
    assert.throws(
      () => resolveUtcInstant(req({ timezone: "Mars/Olympus" })),
      /timezone/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/calc-stub`
Expected: FAIL. `2023-02-30` returns `ok: true` with a NaN-filled chart; `Mars/Olympus` returns `ok: true` computed in UTC; `latitude: 999` returns `ok: true`. Confirm the summary line shows the new file was discovered (`ℹ tests` should be 17, not 8).

- [ ] **Step 3: Replace the import and add validation helpers in `engine.ts`**

Change line 14 from `import { DateTime } from "luxon";` to:

```ts
import { DateTime, IANAZone } from "luxon";
```

Add after the `angleDiff` function (line 126), before `export interface UtcInstantParts`:

```ts
/**
 * Swiss Ephemeris coverage of the pinned data files (sepl_18.se1 / semo_18.se1
 * are the 1800–2400 series). Outside this range swe_calc_ut fails with an error
 * that embeds the ephemeris directory path, so reject the input first.
 */
export const EPHEMERIS_MIN_YEAR = 1800;
export const EPHEMERIS_MAX_YEAR = 2399;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Thrown for anything the caller supplied that cannot describe a real birth. */
export class InvalidBirthProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBirthProfileError";
  }
}

function assertFiniteInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number") {
    throw new InvalidBirthProfileError(
      `${label} must be a number, received ${typeof value}`,
    );
  }
  if (!Number.isFinite(value)) {
    throw new InvalidBirthProfileError(`${label} must be finite`);
  }
  if (value < min || value > max) {
    throw new InvalidBirthProfileError(
      `${label} out of range: ${value} (expected ${min}..${max})`,
    );
  }
  return value;
}

/**
 * Validate birthplace coordinates. Returns null when both are absent, which is
 * a legitimate state (no birthplace supplied) rather than an error.
 */
export function resolveCoordinates(
  req: CalcRequest,
): { latitude: number; longitude: number } | null {
  const hasLat = req.latitude !== null && req.latitude !== undefined;
  const hasLon = req.longitude !== null && req.longitude !== undefined;
  if (!hasLat && !hasLon) return null;
  if (hasLat !== hasLon) {
    throw new InvalidBirthProfileError(
      "latitude and longitude must be supplied together",
    );
  }
  return {
    latitude: assertFiniteInRange(req.latitude, "latitude", -90, 90),
    longitude: assertFiniteInRange(req.longitude, "longitude", -180, 180),
  };
}
```

- [ ] **Step 4: Rewrite `resolveUtcInstant`**

Replace the whole body of `resolveUtcInstant` (lines 144-198) with:

```ts
export function resolveUtcInstant(req: CalcRequest): UtcInstantParts {
  if (!req.birth_date) {
    throw new InvalidBirthProfileError(
      "birth_date required for Swiss Ephemeris calculation",
    );
  }

  const dateMatch = ISO_DATE_RE.exec(req.birth_date);
  if (!dateMatch) {
    throw new InvalidBirthProfileError(
      `invalid birth_date: ${req.birth_date} (expected YYYY-MM-DD)`,
    );
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);

  // Prove the date exists before any zone handling. The previous implementation
  // treated an invalid DateTime as "bad timezone" and retried in UTC, which is
  // equally invalid for a date that never existed — 2023-02-30 became NaN parts
  // and then a NaN Julian day.
  const calendarProbe = DateTime.fromObject({ year, month, day }, { zone: "UTC" });
  if (!calendarProbe.isValid) {
    throw new InvalidBirthProfileError(
      `invalid birth_date: ${req.birth_date} (${calendarProbe.invalidReason ?? "not a real calendar date"})`,
    );
  }

  if (year < EPHEMERIS_MIN_YEAR || year > EPHEMERIS_MAX_YEAR) {
    throw new InvalidBirthProfileError(
      `birth_date outside supported ephemeris range: ${req.birth_date} ` +
        `(supported ${EPHEMERIS_MIN_YEAR}-01-01 through ${EPHEMERIS_MAX_YEAR}-12-31)`,
    );
  }

  const zone = req.timezone || "UTC";
  if (!IANAZone.isValidZone(zone)) {
    throw new InvalidBirthProfileError(
      `invalid timezone: ${zone} (expected an IANA zone id)`,
    );
  }

  let hour = 12;
  let minute = 0;
  let second = 0;
  const hasRealTime =
    req.accuracy !== "unknown" && typeof req.birth_time_local === "string";

  if (hasRealTime) {
    const timeMatch = LOCAL_TIME_RE.exec(req.birth_time_local!);
    if (!timeMatch) {
      throw new InvalidBirthProfileError(
        `invalid birth_time_local: ${req.birth_time_local} (expected HH:MM or HH:MM:SS)`,
      );
    }
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    second = timeMatch[3] === undefined ? 0 : Number(timeMatch[3]);
    if (hour > 23 || minute > 59 || second > 59) {
      throw new InvalidBirthProfileError(
        `invalid birth_time_local: ${req.birth_time_local} (out of range)`,
      );
    }
  }

  const synthetic = !hasRealTime;

  const dt = DateTime.fromObject(
    { year, month, day, hour, minute, second },
    { zone },
  );
  if (!dt.isValid) {
    // Backstop only. Luxon resolves DST spring-forward gaps by shifting forward
    // and stays valid, so with the date and zone already proven this is not
    // expected to be reachable — fail closed rather than fabricate an instant.
    throw new InvalidBirthProfileError(
      `birth date/time cannot be resolved in ${zone}: ${dt.invalidReason ?? "invalid local time"}`,
    );
  }

  const utc = dt.toUTC();
  const hourDecimal =
    utc.hour + utc.minute / 60 + utc.second / 3600 + utc.millisecond / 3_600_000;
  const iso = utc.toISO();
  if (iso === null) {
    throw new InvalidBirthProfileError(
      `birth date/time did not resolve to an instant: ${req.birth_date}`,
    );
  }

  return {
    year: utc.year,
    month: utc.month,
    day: utc.day,
    hourDecimal,
    iso,
    zone: dt.zoneName ?? zone,
    synthetic_local_noon: synthetic,
  };
}
```

- [ ] **Step 5: Wire the coordinate check and the error class into `calculateChart`**

In `calculateChart`, replace the `includeAngles` block (lines 395-409) with:

```ts
    const coordinates = resolveCoordinates(req);

    let housesMeta: ReturnType<typeof computeHouses> | null = null;
    if (coordinates && req.accuracy !== "unknown" && !utc.synthetic_local_noon) {
      try {
        housesMeta = computeHouses(jdUt, coordinates.latitude, coordinates.longitude);
      } catch {
        housesMeta = null;
      }
    }
```

Delete the now-unused `includeAngles` const (`noUnusedLocals` will reject it otherwise). Replace line 412 with:

```ts
    // Angles and houses require a real birth time AND a birthplace. Accuracy is
    // a label the caller supplies; it is not evidence that a time was given.
    const suppressAngles = housesMeta === null;
    const suppressMoon = utc.synthetic_local_noon;
```

Then replace the `catch` block at line 547 with:

```ts
  } catch (err) {
    if (err instanceof InvalidBirthProfileError) {
      return {
        ok: false,
        chart: null,
        error_class: "invalid_birth_profile",
        error_message: err.message,
      };
    }
    return {
      ok: false,
      chart: null,
      error_class: "calc_error",
      error_message: err instanceof Error ? err.message : String(err),
    };
  }
```

Finally, in the chart body replace `latitude: req.latitude` / `longitude: req.longitude` (lines 516-517) with:

```ts
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w @patternlike/calc-stub`
Expected: PASS, `ℹ tests 17`, `ℹ fail 0`. The 8 pre-existing tests must still pass — in particular "unknown birth time suppresses houses/angles" and "rejects exact accuracy without birth_date".

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/calc-stub/src/engine.ts apps/calc-stub/src/validation.test.ts
git commit -m "fix(calc): reject impossible birth input instead of computing NaN charts"
```

---

### Task 2: Make the uncertainty report describe what was actually computed

**Files:**
- Modify: `apps/calc-stub/src/engine.ts:200-247` (`buildUncertainty`), `:459-462` (call site), `:507-519` (chart `birth` block)
- Test: `apps/calc-stub/src/uncertainty.test.ts` (create)

**Interfaces:**
- Consumes: `resolveCoordinates`, `InvalidBirthProfileError` from Task 1; `utc.synthetic_local_noon`; `suppressAngles` / `suppressMoon` as redefined in Task 1 Step 5.
- Produces: `buildUncertainty(input: UncertaintyInputs): UncertaintyReport` where
  `UncertaintyInputs = { accuracy: BirthTimeAccuracy; syntheticNoon: boolean; anglesIncluded: boolean; approximateWindowMinutes: number | null }`.
- Produces: `DEFAULT_APPROXIMATE_WINDOW_MINUTES = 30` exported from `engine.ts`.
- Produces: `chart.birth.accuracy` and `chart.uncertainty.accuracy` are now always equal.

- [ ] **Step 1: Write the failing test**

Create `apps/calc-stub/src/uncertainty.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateChart } from "./engine.js";
import type { CalcRequest } from "@patternlike/shared";

function req(overrides: Partial<CalcRequest> = {}): CalcRequest {
  return {
    request_id: "unc_1",
    user_id: "usr_uncertainty_0001",
    profile_version: 1,
    accuracy: "exact",
    birth_date: "1990-05-15",
    birth_time_local: "12:34:00",
    timezone: "America/Los_Angeles",
    latitude: 34.0522,
    longitude: -118.2437,
    place_label: "Los Angeles, CA, US",
    contract_id: "calc-contract-launch",
    contract_version: "0.2.0",
    ...overrides,
  };
}

const suppressed = (chart: { uncertainty: { suppressed_features: Array<{ feature_class: string }> } }) =>
  new Set(chart.uncertainty.suppressed_features.map((f) => f.feature_class));

describe("uncertainty reporting", () => {
  it("never claims angles are suppressed while also returning them", async () => {
    for (const patch of [
      {},
      { birth_time_local: null },
      { accuracy: "approximate" as const },
      { accuracy: "unknown" as const, birth_time_local: null },
      { latitude: null, longitude: null },
    ]) {
      const res = await calculateChart(req(patch));
      assert.equal(res.ok, true, JSON.stringify(patch));
      const chart = res.chart!;
      const claimsSuppressed = suppressed(chart).has("angles");
      const actuallyReturned = chart.angles !== null;
      assert.notEqual(
        claimsSuppressed,
        actuallyReturned,
        `${JSON.stringify(patch)}: suppressed=${claimsSuppressed} returned=${actuallyReturned}`,
      );
    }
  });

  it("suppresses angles when accuracy is exact but no birth time was supplied", async () => {
    const res = await calculateChart(req({ birth_time_local: null }));
    assert.equal(res.ok, true);
    const chart = res.chart!;
    assert.equal(chart.angles, null, "angles must not be computed from synthetic noon");
    assert.equal(chart.houses, null);
    assert.equal(chart.birth.utc_instant, null);
    assert.ok(!chart.positions.some((p) => p.body === "ascendant"));
    assert.ok(!chart.positions.some((p) => p.body === "midheaven"));
    assert.ok(chart.positions.every((p) => p.house === null));
  });

  it("keeps birth.accuracy and uncertainty.accuracy consistent", async () => {
    for (const patch of [
      {},
      { birth_time_local: null },
      { accuracy: "approximate" as const },
      { accuracy: "unknown" as const, birth_time_local: null },
    ]) {
      const res = await calculateChart(req(patch));
      const chart = res.chart!;
      assert.equal(
        chart.birth.accuracy,
        chart.uncertainty.accuracy,
        `${JSON.stringify(patch)} disagreed`,
      );
    }
  });

  it("honours the caller's approximate window instead of hardcoding 30 minutes", async () => {
    for (const minutes of [15, 90, 360]) {
      const res = await calculateChart(
        req({ accuracy: "approximate", approximate_window_minutes: minutes }),
      );
      assert.equal(res.ok, true);
      assert.equal(
        res.chart!.uncertainty.window?.plus_minus_minutes,
        minutes,
        `window for ${minutes}`,
      );
    }
  });

  it("defaults the approximate window to 30 minutes when the caller omits it", async () => {
    const res = await calculateChart(req({ accuracy: "approximate" }));
    assert.equal(res.chart!.uncertainty.window?.plus_minus_minutes, 30);
  });

  it("suppresses angles when a birthplace is missing even with an exact time", async () => {
    const res = await calculateChart(req({ latitude: null, longitude: null }));
    assert.equal(res.ok, true);
    const chart = res.chart!;
    assert.equal(chart.angles, null);
    const reasons = chart.uncertainty.suppressed_features.map((f) => f.reason);
    assert.ok(
      reasons.includes("birthplace_unavailable"),
      `expected birthplace_unavailable, got ${reasons.join(",")}`,
    );
    // The birth time was real, so time-sensitive Moon claims stay available.
    assert.ok(!suppressed(chart).has("moon_time_sensitive"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/calc-stub`
Expected: FAIL on "suppresses angles when accuracy is exact but no birth time was supplied" (angles are currently returned), on the accuracy-consistency test, and on the approximate-window tests (hardcoded 30).

- [ ] **Step 3: Rewrite `buildUncertainty`**

Replace lines 200-247 of `engine.ts` entirely with:

```ts
export const DEFAULT_APPROXIMATE_WINDOW_MINUTES = 30;

export interface UncertaintyInputs {
  /** Accuracy as it will be stored on the chart, after any downgrade. */
  accuracy: BirthTimeAccuracy;
  /** True when no real birth time was supplied and noon was used as an epoch. */
  syntheticNoon: boolean;
  /** True only when houses and angles were actually computed and returned. */
  anglesIncluded: boolean;
  approximateWindowMinutes: number | null;
}

/**
 * Describe what the calculation actually produced.
 *
 * The previous implementation keyed entirely off the caller-declared accuracy,
 * so a request with accuracy "exact" and no birth time computed Placidus houses
 * from synthetic noon and simultaneously reported them as suppressed.
 */
function buildUncertainty(input: UncertaintyInputs): UncertaintyReport {
  const { accuracy, syntheticNoon, anglesIncluded, approximateWindowMinutes } = input;

  const suppressed_features: UncertaintyReport["suppressed_features"] = [];
  if (!anglesIncluded) {
    const reason = syntheticNoon ? "unknown_birth_time" : "birthplace_unavailable";
    suppressed_features.push(
      { feature_class: "houses", reason },
      { feature_class: "angles", reason },
      { feature_class: "angle_transits", reason },
    );
  }
  if (syntheticNoon) {
    suppressed_features.push({
      feature_class: "moon_time_sensitive",
      reason: "unknown_birth_time",
    });
  }

  const qualified_features: UncertaintyReport["qualified_features"] = [];
  let window: UncertaintyReport["window"] = null;

  if (accuracy === "approximate") {
    window = {
      plus_minus_minutes:
        approximateWindowMinutes ?? DEFAULT_APPROXIMATE_WINDOW_MINUTES,
      earliest_local: null,
      latest_local: null,
    };
    qualified_features.push({
      feature_id: "moon",
      qualification: "low_confidence_moon",
    });
    if (anglesIncluded) {
      qualified_features.push({
        feature_id: "houses",
        qualification: "approximate_only",
      });
    }
  }

  const summary = (() => {
    if (syntheticNoon) {
      return (
        "Birth time is unknown; houses, angles, and time-sensitive Moon claims are suppressed. " +
        "Noon is used only as a technical epoch for planetary longitudes and is never stored as the birth instant."
      );
    }
    if (accuracy === "approximate") {
      const pm = window?.plus_minus_minutes ?? DEFAULT_APPROXIMATE_WINDOW_MINUTES;
      return (
        `Birth time is approximate (±${pm} minutes); Moon` +
        (anglesIncluded ? " and house" : "") +
        " claims are qualified across the uncertainty window."
      );
    }
    if (!anglesIncluded) {
      return "Birth time is exact, but no birthplace was supplied; houses and angles are suppressed.";
    }
    return "Birth time is exact; houses and angles are included (Swiss Ephemeris).";
  })();

  return {
    accuracy,
    window,
    suppressed_features,
    qualified_features,
    user_facing_summary: summary,
  };
}
```

- [ ] **Step 4: Downgrade accuracy at the call site and use it consistently**

In `calculateChart`, replace lines 459-462 with:

```ts
    // A declared accuracy of exact/approximate is not evidence a time was given.
    // When noon was synthesized the effective accuracy is unknown; storing that
    // keeps chart.birth.accuracy and chart.uncertainty.accuracy from disagreeing.
    // The API rejects this combination up front, so this is a backstop.
    const effectiveAccuracy: BirthTimeAccuracy = utc.synthetic_local_noon
      ? "unknown"
      : req.accuracy;

    const uncertainty = buildUncertainty({
      accuracy: effectiveAccuracy,
      syntheticNoon: utc.synthetic_local_noon,
      anglesIncluded: !suppressAngles,
      approximateWindowMinutes: req.approximate_window_minutes ?? null,
    });
```

In the `fingerprintPayload` object, change `accuracy: req.accuracy` to `accuracy: effectiveAccuracy`.

In the chart `birth` block, change `accuracy: req.accuracy` to `accuracy: effectiveAccuracy`, and simplify `utc_instant` (which is now redundant with the downgrade but stays explicit):

```ts
      birth: {
        accuracy: effectiveAccuracy,
        // Never store synthetic noon as birth UTC authority
        utc_instant: utc.synthetic_local_noon ? null : utc.iso,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @patternlike/calc-stub`
Expected: PASS, `ℹ tests 23`, `ℹ fail 0`.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/calc-stub/src/engine.ts apps/calc-stub/src/uncertainty.test.ts
git commit -m "fix(calc): suppress angles unless a real birth time and place were supplied"
```

---

### Task 3: Correct applying / separating

**Files:**
- Modify: `apps/calc-stub/src/engine.ts:327-363` (`buildAspects`)
- Test: `apps/calc-stub/src/aspects.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isApplying(lonA, lonB, speedA, speedB, aspectAngle): boolean` exported from `engine.ts`.
- Produces: `angularSeparation(a: number, b: number): number` exported from `engine.ts` (a rename-free re-export of the existing private `angleDiff`).
- Produces: `ASPECT_ANGLE_BY_TYPE: Record<AspectType, number>` exported from `engine.ts`.

**Why the current code is wrong:** `closing` at line 344 tests only whether the raw angular separation is shrinking. That is the rule for a conjunction. For a sextile, square, trine, or opposition the question is whether `|separation − aspect_angle|` is shrinking, so the heuristic inverts the answer whenever the separation sits on the near side of the aspect angle. Measured against the repo's own golden fixture, 8 of 15 aspects carry the wrong flag, and every error is a non-conjunction aspect.

- [ ] **Step 1: Write the failing test**

Create `apps/calc-stub/src/aspects.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASPECT_ANGLE_BY_TYPE,
  angularSeparation,
  goldenExactFixture,
  isApplying,
} from "./engine.js";

describe("applying / separating", () => {
  it("is true when a conjunction is closing", () => {
    // A at 0° moving +1°/day toward B parked at 5°: separation 5 → 4.
    assert.equal(isApplying(0, 5, 1, 0, 0), true);
  });

  it("is false when a conjunction is opening", () => {
    assert.equal(isApplying(0, 5, 0, 1, 0), false);
  });

  it("is true when a trine is closing from below the aspect angle", () => {
    // Separation 118° growing toward an exact 120° trine.
    assert.equal(isApplying(0, 118, 0, 1, 120), true);
  });

  it("is false when the separation shrinks away from the aspect angle", () => {
    // Separation 118° shrinking to 117° — moving away from 120°, so the orb
    // grows. The old heuristic called this applying because separation closed.
    assert.equal(isApplying(0, 118, 0, -1, 120), false);
  });

  it("is true when a trine is closing from above the aspect angle", () => {
    // Separation 122° shrinking toward 120°.
    assert.equal(isApplying(0, 122, 0, -1, 120), true);
  });

  it("is false when a trine is opening from above the aspect angle", () => {
    assert.equal(isApplying(0, 122, 0, 1, 120), false);
  });

  it("handles the 0/360 wrap", () => {
    // A at 359°, B at 1°: separation 2°, A gaining → conjunction applying.
    assert.equal(isApplying(359, 1, 1, 0, 0), true);
    assert.equal(isApplying(1, 359, 0, 1, 0), true);
  });

  it("treats an exact aspect as neither applying nor separating", () => {
    assert.equal(isApplying(0, 120, 0, 1, 120), false);
  });

  it("matches the sign of the numerically differentiated orb on the golden chart", async () => {
    const chart = await goldenExactFixture();
    const byBody = new Map(chart.positions.map((p) => [p.body, p]));

    let checked = 0;
    const failures: string[] = [];

    for (const asp of chart.aspects) {
      const a = byBody.get(asp.body_a);
      const b = byBody.get(asp.body_b);
      assert.ok(a && b, `missing position for ${asp.body_a}/${asp.body_b}`);

      const speedA = a.speed_longitude_deg_per_day ?? 0;
      const speedB = b.speed_longitude_deg_per_day ?? 0;
      const angle = ASPECT_ANGLE_BY_TYPE[asp.aspect];

      // Choose dt so the pair moves ~0.001° relative to each other: three orders
      // of magnitude above the 1e-6 rounding on stored longitudes, and far too
      // small to step over exactness.
      const relSpeed = Math.abs(speedA - speedB);
      if (relSpeed === 0) continue;
      const dt = 0.001 / relSpeed;

      const orbNow = Math.abs(angularSeparation(a.longitude_deg, b.longitude_deg) - angle);
      const orbLater = Math.abs(
        angularSeparation(a.longitude_deg + speedA * dt, b.longitude_deg + speedB * dt) - angle,
      );
      if (orbNow < 1e-6) continue; // exact: derivative undefined

      const expected = orbLater < orbNow;
      if (asp.applying !== expected) {
        failures.push(
          `${asp.aspect} ${asp.body_a}/${asp.body_b}: applying=${asp.applying} ` +
            `but orb ${orbNow.toFixed(6)} → ${orbLater.toFixed(6)}`,
        );
      }
      checked++;
    }

    assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
    assert.ok(checked >= 10, `expected a meaningful aspect count, checked ${checked}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/calc-stub`
Expected: FAIL. The exported symbols do not exist yet (`isApplying is not a function`). After Step 3 exports them but before Step 4 fixes the logic, the golden-chart test fails listing roughly 8 mismatched aspects.

- [ ] **Step 3: Export the helpers**

In `engine.ts`, change `function angleDiff` (line 122) to be exported under its clearer name and keep the old name as an internal alias:

```ts
/** Smallest angle between two ecliptic longitudes, in [0, 180]. */
export function angularSeparation(a: number, b: number): number {
  let d = Math.abs(norm360(a) - norm360(b)) % 360;
  if (d > 180) d = 360 - d;
  return d;
}
```

Delete the old `angleDiff` function and replace its single call site in `buildAspects` (line 336) with `angularSeparation`.

Add after the `ASPECT_ANGLES` array (line 96):

```ts
export const ASPECT_ANGLE_BY_TYPE: Record<AspectType, number> = Object.fromEntries(
  ASPECT_ANGLES.map(({ aspect, angle }) => [aspect, angle]),
) as Record<AspectType, number>;
```

- [ ] **Step 4: Implement `isApplying` and use it**

Add immediately before `buildAspects` (line 327):

```ts
/**
 * An aspect is applying when the orb to exactness is shrinking:
 * d|separation − aspect_angle| / dt < 0.
 *
 * Let d = norm360(lonA − lonB) ∈ [0, 360). The separation reported by
 * angularSeparation is d when d ≤ 180 and 360 − d otherwise, so
 *
 *   d(separation)/dt = (speedA − speedB)   when d ≤ 180
 *                    = (speedB − speedA)   otherwise
 *
 * and, since orb = |separation − angle|,
 *
 *   d(orb)/dt = sign(separation − angle) · d(separation)/dt
 *
 * Exactly on the aspect the orb is at a minimum and the derivative is
 * undefined; the aspect is neither applying nor separating, so this returns
 * false. Retrograde motion needs no special case — it is a negative speed.
 */
export function isApplying(
  lonA: number,
  lonB: number,
  speedA: number,
  speedB: number,
  aspectAngle: number,
): boolean {
  const d = norm360(lonA - lonB);
  const separation = d <= 180 ? d : 360 - d;
  const separationRate = d <= 180 ? speedA - speedB : speedB - speedA;
  const offset = separation - aspectAngle;
  if (offset === 0) return false;
  return Math.sign(offset) * separationRate < 0;
}
```

In `buildAspects`, replace the `closing` computation and its use (lines 341-353) with:

```ts
          const applying = isApplying(
            a.longitude_deg,
            b.longitude_deg,
            a.speed_longitude_deg_per_day ?? 0,
            b.speed_longitude_deg_per_day ?? 0,
            angle,
          );
          out.push({
            id: newId("asp"),
            body_a: a.body,
            body_b: b.body,
            aspect,
            orb_deg: Number(orb.toFixed(4)),
            applying,
            orb_policy_id: ORB_POLICY_ID,
            orb_policy_version: ORB_POLICY_VERSION,
          });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @patternlike/calc-stub`
Expected: PASS, `ℹ tests 32`, `ℹ fail 0`.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/calc-stub/src/engine.ts apps/calc-stub/src/aspects.test.ts
git commit -m "fix(calc): compute applying from the orb derivative, not raw separation"
```

---

### Task 4: Scope idempotency to the user and make key destruction recoverable

**Files:**
- Modify: `db/d1/0001_m0_core.sql:30-38` (`user_keys`), `:431-451` (`jobs`), `:470-495` (`export_requests`, `deletion_requests`)
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `contracts/m0/smoke_check.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: unique index `uq_jobs_scope_key` on `jobs(job_type, COALESCE(user_id, ''), idempotency_key)`. Task 5 queries `jobs` with a `user_id` predicate and relies on this.
- Produces: `user_keys` primary key becomes `(user_id, key_version)`. Task 7 relies on being able to insert a new key version for a user who already has a destroyed row.

**Why a partial index rather than a table constraint:** `jobs.user_id` is nullable for system jobs, and SQLite treats NULLs as distinct in a UNIQUE constraint, so `UNIQUE (job_type, user_id, idempotency_key)` would silently stop deduplicating system jobs. A unique index over `COALESCE(user_id, '')` collapses those into one namespace. The schema already uses an expression-based unique index for `uq_context_signals_norm` (line 287), so this matches the file's existing style.

- [ ] **Step 1: Write the failing check**

In `contracts/m0/smoke_check.py`, add this function after `check_sql`'s `content_releases` block (before the closing of `check_sql`, at the same indentation as the other checks):

```python
    # Idempotency keys must be per-user, not a global namespace (review: critical)
    con.execute(
        "INSERT INTO users (id, status, locale, timezone, entitlement_tier, created_at, updated_at) "
        "VALUES ('usr_b', 'active', 'en-US', 'UTC', 'free', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
    )
    con.execute(
        "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, attempts, created_at) "
        "VALUES ('job_a', 'NormalizeBirthAndCalculateChart', 'usr_t', 'shared-key-001', 'succeeded', 1, "
        "'2026-01-01T00:00:00Z')"
    )
    try:
        con.execute(
            "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, attempts, created_at) "
            "VALUES ('job_b', 'NormalizeBirthAndCalculateChart', 'usr_b', 'shared-key-001', 'queued', 1, "
            "'2026-01-01T00:00:00Z')"
        )
        print("D1 OK  jobs idempotency_key is scoped per user")
    except sqlite3.IntegrityError as exc:
        raise SystemExit(
            f"jobs idempotency_key is a global namespace across users: {exc}"
        )

    try:
        con.execute(
            "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, attempts, created_at) "
            "VALUES ('job_c', 'NormalizeBirthAndCalculateChart', 'usr_t', 'shared-key-001', 'queued', 1, "
            "'2026-01-01T00:00:00Z')"
        )
        raise SystemExit("jobs must still reject a duplicate key for the SAME user")
    except sqlite3.IntegrityError:
        print("D1 OK  jobs still rejects a duplicate key for the same user")

    # A destroyed key must not block re-keying (review: permanent 500)
    con.execute(
        "INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at, destroyed_at) "
        "VALUES ('usr_t', 1, 2, X'00', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')"
    )
    try:
        con.execute(
            "INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at) "
            "VALUES ('usr_t', 2, 2, X'01', '2026-02-01T00:00:00Z')"
        )
        print("D1 OK  user_keys supports rotation after destruction")
    except sqlite3.IntegrityError as exc:
        raise SystemExit(f"user_keys cannot rotate: {exc}")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python contracts/m0/smoke_check.py`
Expected: FAIL with `jobs idempotency_key is a global namespace across users: UNIQUE constraint failed: jobs.job_type, jobs.idempotency_key`.

- [ ] **Step 3: Fix the `jobs` constraint**

In `db/d1/0001_m0_core.sql`, delete line 447 (`  UNIQUE (job_type, idempotency_key)`) and the trailing comma on line 446, so the table ends:

```sql
  finished_at TEXT,
  created_at TEXT NOT NULL
);

-- Idempotency is per (job_type, user, key). user_id is nullable for system jobs,
-- and SQLite treats NULLs as distinct in a UNIQUE constraint, so COALESCE keeps
-- system jobs in a single namespace instead of silently skipping deduplication.
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_scope_key
  ON jobs(job_type, COALESCE(user_id, ''), idempotency_key);

CREATE INDEX IF NOT EXISTS idx_jobs_status_available
  ON jobs(status, available_at);
```

- [ ] **Step 4: Fix `user_keys` for rotation**

Replace lines 30-38 with:

```sql
CREATE TABLE IF NOT EXISTS user_keys (
  user_id TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL DEFAULT 1,
  kek_version INTEGER NOT NULL DEFAULT 1,
  wrapped_dek BLOB NOT NULL,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  destroyed_at TEXT,
  -- Keyed by version so a destroyed key does not permanently block the user:
  -- with user_id alone as the PK, the destroyed_at IS NULL lookup missed while
  -- the insert still collided, 500ing forever and making rotation impossible.
  PRIMARY KEY (user_id, key_version)
);

-- At most one live key per user; destroyed rows are retained for audit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_keys_active
  ON user_keys(user_id) WHERE destroyed_at IS NULL;
```

- [ ] **Step 5: Scope the export and deletion idempotency keys the same way**

At line 479 change `  idempotency_key TEXT NOT NULL UNIQUE,` to `  idempotency_key TEXT NOT NULL,` and add before the closing `);` of `export_requests`:

```sql
  UNIQUE (user_id, idempotency_key)
```

Apply the identical change to `deletion_requests` at line 492. Both tables already carry a `user_id` column; confirm with `grep -n "user_id" db/d1/0001_m0_core.sql` around each table before editing.

- [ ] **Step 6: Run the checks to verify they pass**

Run: `python contracts/m0/smoke_check.py`
Expected: PASS, including the three new `D1 OK` lines.

Run: `python contracts/m0/validate_schemas.py`
Expected: PASS.

- [ ] **Step 7: Record the in-place edit**

In `db/d1/MIGRATIONS.json`, extend the `0001_m0_core` description with `; per-user idempotency scoping; user_keys keyed by (user_id, key_version) for rotation` and add to `notes`:

```json
    "2026-08-01: 0001 edited in place for per-user idempotency scoping, user_keys rotation, and KEK derivation v2. Local databases must be recreated: npm run db:local -w @patternlike/api. Pre-existing local rows encrypted under KEK derivation v1 are not readable."
```

- [ ] **Step 8: Commit**

```bash
git add db/d1/0001_m0_core.sql db/d1/MIGRATIONS.json contracts/m0/smoke_check.py
git commit -m "fix(db): scope idempotency keys per user and allow key rotation"
```

---

### Task 5: Make the birth-profile write atomic, scoped, and honest about conflicts

**Files:**
- Modify: `apps/api/src/routes/birth.ts` (whole handler)

**Interfaces:**
- Consumes: `uq_jobs_scope_key` from Task 4; `invalid_birth_profile` as the calc error class from Task 1.
- Produces: `POST /v1/birth-profiles` returns `400` for bad input, `202` for accepted/duplicate/in-flight, `409` when the same birth data already has a chart, `502` when the calculation service fails. It never returns 500 on any of these paths and never leaves a row orphaned.

**The five defects being fixed here:**
1. The job lookup omits `user_id`, so user B reusing user A's key gets A's job and chart ids while B's profile is never written (critical, silent data loss).
2. Any retry that is not a retry-after-success re-executes the `jobs` INSERT and 500s on the unique constraint, after `birth_profiles` has already been written.
3. Resubmitting identical birth data under a new key produces the same fingerprint, violating `UNIQUE(user_id, fingerprint)` and 500ing — where OpenAPI declares 409.
4. Failed calculations leave `birth_profiles` rows at `status='active'`, several at once for one user, with nothing superseding the prior version.
5. `birth_time_local` is never required, so `accuracy: "exact"` with no time reaches the engine.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/birth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateBirthProfileRequest } from "./birth.js";

describe("birth profile request validation", () => {
  const base = {
    accuracy: "exact" as const,
    consent_id: "cns_0000000000000001",
    birth_date: "1990-05-15",
    birth_time_local: "12:34:00",
    birthplace: { latitude: 34.0522, longitude: -118.2437, label: "Los Angeles" },
  };

  it("accepts a complete exact profile", () => {
    expect(validateBirthProfileRequest(base)).toBeNull();
  });

  it("requires birth_time_local when accuracy is exact", () => {
    const err = validateBirthProfileRequest({ ...base, birth_time_local: undefined });
    expect(err?.code).toBe("invalid_body");
    expect(err?.message).toMatch(/birth_time_local/);
  });

  it("requires birth_time_local when accuracy is approximate", () => {
    const err = validateBirthProfileRequest({
      ...base,
      accuracy: "approximate",
      birth_time_local: null,
    });
    expect(err?.code).toBe("invalid_body");
  });

  it("allows a missing birth_time_local when accuracy is unknown", () => {
    expect(
      validateBirthProfileRequest({
        ...base,
        accuracy: "unknown",
        birth_time_local: null,
      }),
    ).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    for (const birthplace of [
      { latitude: 999, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: -91, longitude: 0 },
    ]) {
      expect(validateBirthProfileRequest({ ...base, birthplace })?.code).toBe("invalid_body");
    }
  });

  it("rejects coordinates supplied as strings", () => {
    const err = validateBirthProfileRequest({
      ...base,
      birthplace: { latitude: "34.05" as unknown as number, longitude: -118.24 },
    });
    expect(err?.code).toBe("invalid_body");
  });

  it("rejects a birth_date that is not YYYY-MM-DD", () => {
    expect(validateBirthProfileRequest({ ...base, birth_date: "1990-5-15" })?.code).toBe(
      "invalid_body",
    );
  });

  it("requires accuracy and consent_id", () => {
    expect(validateBirthProfileRequest({ ...base, consent_id: undefined })?.code).toBe(
      "invalid_body",
    );
    expect(
      validateBirthProfileRequest({ ...base, accuracy: undefined as never })?.code,
    ).toBe("invalid_body");
  });

  it("rejects an unrecognised accuracy value", () => {
    expect(
      validateBirthProfileRequest({ ...base, accuracy: "precise" as never })?.code,
    ).toBe("invalid_body");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/api`
Expected: FAIL — `validateBirthProfileRequest` is not exported from `birth.js`.

- [ ] **Step 3: Add the validator**

At the top of `apps/api/src/routes/birth.ts`, after the imports, add:

```ts
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/;
const ACCURACIES = new Set(["exact", "approximate", "unknown"]);

export interface ValidationFailure {
  code: "invalid_body";
  message: string;
}

function badCoordinate(value: unknown, label: string, limit: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${label} must be a finite number`;
  }
  if (value < -limit || value > limit) {
    return `${label} out of range: ${value} (expected ${-limit}..${limit})`;
  }
  return null;
}

/**
 * Validate everything the calculation engine will otherwise have to guess at.
 * birth_time_local is required for exact and approximate because without it the
 * engine synthesizes noon, and houses and angles derived from a synthetic noon
 * are not facts about the user.
 */
export function validateBirthProfileRequest(
  body: Partial<BirthProfileRequest>,
): ValidationFailure | null {
  const fail = (message: string): ValidationFailure => ({ code: "invalid_body", message });

  if (!body.accuracy || !ACCURACIES.has(body.accuracy)) {
    return fail("accuracy must be one of exact, approximate, unknown");
  }
  if (!body.consent_id) {
    return fail("accuracy and consent_id are required");
  }

  if (body.accuracy !== "unknown") {
    if (!body.birth_date) {
      return fail("birth_date required unless accuracy is unknown");
    }
    if (!body.birth_time_local) {
      return fail(
        "birth_time_local required when accuracy is exact or approximate; " +
          "use accuracy \"unknown\" when the birth time is not known",
      );
    }
  }

  if (body.birth_date !== undefined && body.birth_date !== null) {
    if (typeof body.birth_date !== "string" || !ISO_DATE_RE.test(body.birth_date)) {
      return fail("birth_date must be formatted YYYY-MM-DD");
    }
  }
  if (body.birth_time_local !== undefined && body.birth_time_local !== null) {
    if (
      typeof body.birth_time_local !== "string" ||
      !LOCAL_TIME_RE.test(body.birth_time_local)
    ) {
      return fail("birth_time_local must be formatted HH:MM or HH:MM:SS");
    }
  }
  if (
    body.approximate_window_minutes !== undefined &&
    body.approximate_window_minutes !== null
  ) {
    const w = body.approximate_window_minutes;
    if (typeof w !== "number" || !Number.isInteger(w) || w < 1 || w > 1440) {
      return fail("approximate_window_minutes must be an integer between 1 and 1440");
    }
  }

  const latError = badCoordinate(body.birthplace?.latitude, "birthplace.latitude", 90);
  if (latError) return fail(latError);
  const lonError = badCoordinate(body.birthplace?.longitude, "birthplace.longitude", 180);
  if (lonError) return fail(lonError);

  const hasLat =
    body.birthplace?.latitude !== null && body.birthplace?.latitude !== undefined;
  const hasLon =
    body.birthplace?.longitude !== null && body.birthplace?.longitude !== undefined;
  if (hasLat !== hasLon) {
    return fail("birthplace latitude and longitude must be supplied together");
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @patternlike/api`
Expected: PASS, 11 tests (2 crypto + 9 birth).

- [ ] **Step 5: Rewrite the handler to use the validator, scope the lookup, and batch the writes**

Replace the body of the `birthRoutes.post` handler (everything from `const idem = ...` to the final `return c.json(...)`) with:

```ts
  const requestId = c.get("requestId");
  const errorBody = (code: string, message: string) => ({
    error: { code, message, request_id: requestId },
  });

  const idem = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!idem) {
    return c.json(
      errorBody("missing_idempotency_key", "Idempotency-Key header required (8-256 chars)"),
      400,
    );
  }

  const userId = c.get("userId");

  let body: Partial<BirthProfileRequest>;
  try {
    body = (await c.req.json()) as Partial<BirthProfileRequest>;
  } catch {
    return c.json(errorBody("invalid_json", "Request body must be valid JSON"), 400);
  }
  if (body === null || typeof body !== "object") {
    return c.json(errorBody("invalid_body", "Request body must be a JSON object"), 400);
  }

  const invalid = validateBirthProfileRequest(body);
  if (invalid) {
    return c.json(errorBody(invalid.code, invalid.message), 400);
  }
  const accuracy = body.accuracy!;

  // Idempotency is scoped to this user. Without the user_id predicate a second
  // user reusing the same key received the first user's job and chart ids while
  // their own profile was never written.
  const existingJob = await c.env.DB.prepare(
    `SELECT id, status, result_class FROM jobs
     WHERE job_type = ? AND user_id = ? AND idempotency_key = ?`,
  )
    .bind("NormalizeBirthAndCalculateChart", userId, idem)
    .first<{ id: string; status: string; result_class: string | null }>();

  if (existingJob?.status === "succeeded") {
    return c.json(
      {
        schema_version: SCHEMA_VERSION,
        workflow: "NormalizeBirthAndCalculateChart",
        status: "duplicate",
        idempotency_key: idem,
        job_id: existingJob.id,
        resource_id: existingJob.result_class,
      },
      202,
    );
  }
  if (existingJob && (existingJob.status === "queued" || existingJob.status === "running")) {
    // In flight. Report it instead of re-running the unique insert and 500ing.
    return c.json(
      {
        schema_version: SCHEMA_VERSION,
        workflow: "NormalizeBirthAndCalculateChart",
        status: "running",
        idempotency_key: idem,
        job_id: existingJob.id,
        resource_id: null,
      },
      202,
    );
  }

  await ensureUser(c.env.DB, userId);

  const now = new Date().toISOString();
  const versionRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(version), 0) AS v FROM birth_profiles WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ v: number }>();
  const profileVersion = (versionRow?.v ?? 0) + 1;

  const sensitive = {
    birth_date: body.birth_date ?? null,
    birth_time_local: body.birth_time_local ?? null,
    birthplace: body.birthplace ?? null,
    approximate_window_minutes: body.approximate_window_minutes ?? null,
    consent_id: body.consent_id,
  };

  const { keyVersion, nonce, ciphertext } = await encryptPayload(c.env, userId, sensitive);
  const encBytes = Uint8Array.from(atob(ciphertext), (ch) => ch.charCodeAt(0));

  const jobId = existingJob?.id ?? newId("job");

  // The profile lands as 'pending' and the job as 'running' in one transaction.
  // A prior failed job for this key is reused rather than re-inserted, so a
  // retry can never collide with uq_jobs_scope_key.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO birth_profiles (
        user_id, version, accuracy, status, timezone,
        payload_enc, payload_key_version, payload_nonce,
        geocode_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(
      userId,
      profileVersion,
      accuracy,
      body.timezone_hint ?? "UTC",
      encBytes,
      keyVersion,
      nonce,
      now,
      now,
    ),
    existingJob
      ? c.env.DB.prepare(
          `UPDATE jobs SET status = 'running', payload_json = ?, attempts = attempts + 1,
                           started_at = ?, finished_at = NULL, result_class = NULL
           WHERE id = ?`,
        ).bind(JSON.stringify({ profile_version: profileVersion }), now, jobId)
      : c.env.DB.prepare(
          `INSERT INTO jobs (
            id, job_type, user_id, idempotency_key, status, payload_json,
            attempts, started_at, created_at
          ) VALUES (?, 'NormalizeBirthAndCalculateChart', ?, ?, 'running', ?, 1, ?, ?)`,
        ).bind(
          jobId,
          userId,
          idem,
          JSON.stringify({ profile_version: profileVersion }),
          now,
          now,
        ),
  ]);

  const calc = await invokeCalc(c.env, {
    request_id: jobId,
    user_id: userId,
    profile_version: profileVersion,
    accuracy,
    birth_date: body.birth_date ?? null,
    birth_time_local: body.birth_time_local ?? null,
    timezone: body.timezone_hint ?? "UTC",
    latitude: body.birthplace?.latitude ?? null,
    longitude: body.birthplace?.longitude ?? null,
    place_label: body.birthplace?.label ?? null,
    approximate_window_minutes: body.approximate_window_minutes ?? null,
    contract_id: CALC_CONTRACT_ID,
    contract_version: CALC_CONTRACT_VERSION,
  });

  if (!calc.ok || !calc.chart) {
    const calcClass = calc.error_class ?? "calc_failed";
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE jobs SET status = 'failed', result_class = ?, finished_at = ? WHERE id = ?`,
      ).bind(calcClass, now, jobId),
      c.env.DB.prepare(
        `UPDATE birth_profiles SET status = 'invalid', updated_at = ?
         WHERE user_id = ? AND version = ?`,
      ).bind(now, userId, profileVersion),
    ]);

    // Bad input is the caller's problem and is safe to echo. Anything else is
    // an upstream fault whose message has previously leaked the calc service's
    // absolute filesystem path, so it is logged rather than returned.
    if (calcClass === "invalid_birth_profile") {
      return c.json(
        errorBody("invalid_birth_profile", calc.error_message ?? "Birth profile is not valid"),
        400,
      );
    }
    console.error("calc_failed", {
      request_id: requestId,
      job_id: jobId,
      error_class: calcClass,
      error_message: calc.error_message,
    });
    return c.json(
      errorBody("calc_failed", "Calculation service could not produce a chart"),
      502,
    );
  }

  const chart = calc.chart;

  // Identical birth data under a new key reproduces the fingerprint. OpenAPI
  // declares 409 for this; the previous code let UNIQUE(user_id, fingerprint)
  // throw after the profile and job rows were already committed.
  const duplicate = await c.env.DB.prepare(
    `SELECT id FROM chart_snapshots WHERE user_id = ? AND fingerprint = ?`,
  )
    .bind(userId, chart.fingerprint)
    .first<{ id: string }>();

  if (duplicate) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE jobs SET status = 'succeeded', result_class = ?, finished_at = ? WHERE id = ?`,
      ).bind(duplicate.id, now, jobId),
      c.env.DB.prepare(
        `UPDATE birth_profiles SET status = 'superseded', updated_at = ?
         WHERE user_id = ? AND version = ?`,
      ).bind(now, userId, profileVersion),
    ]);
    return c.json(
      {
        error: {
          code: "chart_already_exists",
          message: "This birth data already has a chart",
          request_id: requestId,
          details: { chart_id: duplicate.id, fingerprint: chart.fingerprint },
        },
      },
      409,
    );
  }

  const publicSnapshot = {
    positions: chart.positions,
    houses: chart.houses,
    angles: chart.angles,
    aspects: chart.aspects,
    patterns: chart.patterns ?? [],
    uncertainty: chart.uncertainty,
  };

  const birthEnc = await encryptPayload(c.env, userId, {
    utc_instant: chart.birth.utc_instant,
    place_label: chart.birth.place_label,
    latitude: chart.birth.latitude,
    longitude: chart.birth.longitude,
  });
  const birthEncBytes = Uint8Array.from(atob(birthEnc.ciphertext), (ch) => ch.charCodeAt(0));

  // One transaction: publish the chart, supersede the previous chart AND the
  // previous profile versions, activate this profile, close the job. Previously
  // only charts were superseded, leaving several 'active' profiles per user.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO chart_snapshots (
        id, user_id, profile_version, fingerprint, contract_id, contract_version,
        container_digest, tzdb_version, status, calculated_at, snapshot_json,
        birth_accuracy, birth_enc, birth_key_version, birth_nonce,
        r2_uri, uncertainty_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(
      chart.id,
      userId,
      profileVersion,
      chart.fingerprint,
      chart.contract_id,
      chart.contract_version,
      chart.container_digest,
      chart.tzdb_version ?? null,
      chart.calculated_at,
      JSON.stringify(publicSnapshot),
      chart.birth.accuracy,
      birthEncBytes,
      birthEnc.keyVersion,
      birthEnc.nonce,
      JSON.stringify(chart.uncertainty),
      now,
    ),
    c.env.DB.prepare(
      `UPDATE chart_snapshots SET status = 'superseded'
       WHERE user_id = ? AND id != ? AND status = 'active'`,
    ).bind(userId, chart.id),
    c.env.DB.prepare(
      `UPDATE birth_profiles SET status = 'superseded', updated_at = ?
       WHERE user_id = ? AND version != ? AND status IN ('pending', 'active')`,
    ).bind(now, userId, profileVersion),
    c.env.DB.prepare(
      `UPDATE birth_profiles SET status = 'active', updated_at = ?
       WHERE user_id = ? AND version = ?`,
    ).bind(now, userId, profileVersion),
    c.env.DB.prepare(
      `UPDATE jobs SET status = 'succeeded', result_class = ?, finished_at = ? WHERE id = ?`,
    ).bind(chart.id, now, jobId),
  ]);

  return c.json(
    {
      schema_version: SCHEMA_VERSION,
      workflow: "NormalizeBirthAndCalculateChart",
      status: "succeeded",
      idempotency_key: idem,
      job_id: jobId,
      resource_id: chart.id,
      chart: {
        id: chart.id,
        fingerprint: chart.fingerprint,
        contract_id: chart.contract_id,
        uncertainty: chart.uncertainty,
        status: "active",
      },
    },
    202,
  );
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run test -w @patternlike/api`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/birth.ts apps/api/src/routes/birth.test.ts
git commit -m "fix(api): scope idempotency per user, batch birth writes, return 409 on duplicate chart"
```

---

### Task 6: Add the documented error envelope to every uncaught path

**Files:**
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `app.onError` returning the `{ error: { code, message, request_id } }` envelope with `code: "internal_error"` and a generic message.

Without `app.onError`, Hono's default handler returns `500 Internal Server Error` as `text/plain`, so the documented envelope never appears on any uncaught path — including a malformed JSON body and the D1 constraint violations Task 5 removed.

- [ ] **Step 1: Add the handler**

In `apps/api/src/index.ts`, insert before `app.notFound(...)`:

```ts
app.onError((err, c) => {
  const requestId =
    c.get("requestId") ?? c.req.header("x-request-id") ?? crypto.randomUUID();
  // Log the detail; never return it. Upstream messages have previously carried
  // the calculation service's absolute filesystem path.
  console.error("unhandled_error", {
    request_id: requestId,
    path: c.req.path,
    method: c.req.method,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "Unexpected server error",
        request_id: requestId,
      },
    },
    500,
  );
});
```

Add `request_id` to the `notFound` envelope for consistency:

```ts
app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: "Route not found",
        request_id: c.get("requestId") ?? c.req.header("x-request-id") ?? null,
      },
    },
    404,
  ),
);
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "fix(api): return the documented error envelope on uncaught paths"
```

---

### Task 7: Fail closed on development secrets in a production environment

**Files:**
- Modify: `apps/api/src/crypto.ts:27-35`, `apps/api/src/db/users.ts:26-78`, `apps/api/src/env.ts`
- Modify: `apps/api/wrangler.toml`, `apps/api/package.json`, `.env.example`
- Modify: `apps/api/src/index.ts`, `apps/api/src/routes/stubs.ts`
- Modify: `apps/api/src/crypto.test.ts`
- Create: `apps/api/src/middleware/config-guard.ts`, `apps/api/src/config.test.ts`

**Interfaces:**
- Consumes: `user_keys` PK `(user_id, key_version)` from Task 4.
- Produces: `resolveRootKey(env: RootKeyEnv): Promise<CryptoKey>` — **signature change** from `(rootKek?: string)`. `RootKeyEnv = { ROOT_KEK?: string; ENVIRONMENT?: string }`.
- Produces: `DEV_ROOT_KEK`, `KEK_DERIVATION_VERSION = 2`, `RootKekError`, `isDevEnvironment(environment?: string): boolean` from `crypto.ts`.
- Produces: `checkSecureConfig(env): { code: string; message: string } | null` and `configGuard` middleware from `middleware/config-guard.ts`.
- Produces: `UserKeyDestroyedError` from `db/users.ts`.

**Four defects:** `ROOT_KEK` falls back to a repo-committed string with nothing asserting it is configured; the KEK is a bare unsalted SHA-256 with no KDF and no domain separation; `AUTH_STUB="1"` is in the only `[vars]` block so a bare `wrangler deploy` publishes header-trusted auth; and `serviceAuth` is exported and wired to nothing while `/internal/content-releases` sits on the consumer router.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkSecureConfig } from "./middleware/config-guard.js";
import { DEV_ROOT_KEK, resolveRootKey, isDevEnvironment } from "./crypto.js";

const STRONG_KEK = "a-real-root-kek-with-enough-entropy-32+";

describe("secure configuration guard", () => {
  it("passes in development with no secrets set", () => {
    expect(checkSecureConfig({ ENVIRONMENT: "development", AUTH_STUB: "1" })).toBeNull();
  });

  it("passes in production with a real ROOT_KEK and no AUTH_STUB", () => {
    expect(
      checkSecureConfig({ ENVIRONMENT: "production", ROOT_KEK: STRONG_KEK }),
    ).toBeNull();
  });

  it("refuses production without ROOT_KEK", () => {
    const err = checkSecureConfig({ ENVIRONMENT: "production" });
    expect(err?.code).toBe("root_kek_not_configured");
  });

  it("refuses production with the development placeholder as ROOT_KEK", () => {
    const err = checkSecureConfig({ ENVIRONMENT: "production", ROOT_KEK: DEV_ROOT_KEK });
    expect(err?.code).toBe("root_kek_not_configured");
  });

  it("refuses production with AUTH_STUB enabled", () => {
    const err = checkSecureConfig({
      ENVIRONMENT: "production",
      AUTH_STUB: "1",
      ROOT_KEK: STRONG_KEK,
    });
    expect(err?.code).toBe("auth_stub_in_production");
  });

  it("treats an unset ENVIRONMENT as non-development", () => {
    expect(checkSecureConfig({})?.code).toBe("root_kek_not_configured");
  });
});

describe("root key derivation", () => {
  it("classifies environments", () => {
    expect(isDevEnvironment("development")).toBe(true);
    expect(isDevEnvironment("test")).toBe(true);
    expect(isDevEnvironment("production")).toBe(false);
    expect(isDevEnvironment(undefined)).toBe(false);
  });

  it("throws rather than silently using the dev key outside development", async () => {
    await expect(resolveRootKey({ ENVIRONMENT: "production" })).rejects.toThrow(
      /ROOT_KEK/,
    );
  });

  it("uses the dev fallback only in development", async () => {
    await expect(resolveRootKey({ ENVIRONMENT: "development" })).resolves.toBeDefined();
  });

  it("rejects a ROOT_KEK that is too short to be a real secret", async () => {
    await expect(
      resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: "short" }),
    ).rejects.toThrow(/32/);
  });

  it("derives a usable AES-GCM key via HKDF", async () => {
    const key = await resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: STRONG_KEK });
    expect(key.algorithm.name).toBe("AES-GCM");
    expect(key.usages).toContain("encrypt");
    expect(key.usages).toContain("decrypt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/api`
Expected: FAIL — `./middleware/config-guard.js` does not exist and `crypto.js` exports neither `DEV_ROOT_KEK` nor `isDevEnvironment`.

- [ ] **Step 3: Rewrite the KEK derivation**

Replace lines 27-35 of `apps/api/src/crypto.ts` with:

```ts
/** The placeholder that shipped in the repository. Never valid outside dev. */
export const DEV_ROOT_KEK = "patternlike-dev-only-root-kek-change-me!!";

/**
 * Bumped from 1 when the derivation moved from a bare unsalted SHA-256 of the
 * passphrase to HKDF-SHA256 with a salt and domain separation. Ciphertext
 * produced under v1 is not readable under v2; M0 is pre-production, so local
 * databases are recreated rather than migrated.
 */
export const KEK_DERIVATION_VERSION = 2;

const KEK_HKDF_SALT = new TextEncoder().encode("patternlike/kek/v2");
const KEK_HKDF_INFO = new TextEncoder().encode("patternlike:root-kek:aes-256-gcm");

const MIN_ROOT_KEK_LENGTH = 32;

export interface RootKeyEnv {
  ROOT_KEK?: string;
  ENVIRONMENT?: string;
}

export class RootKekError extends Error {
  readonly code = "root_kek_not_configured";
  constructor(message: string) {
    super(message);
    this.name = "RootKekError";
  }
}

export function isDevEnvironment(environment: string | undefined): boolean {
  return environment === "development" || environment === "test";
}

async function deriveKek(material: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(material),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: KEK_HKDF_SALT, info: KEK_HKDF_INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Resolve the root KEK. Outside development a missing, placeholder, or
 * implausibly short ROOT_KEK is a hard failure — the previous behaviour was to
 * encrypt every user's birth date, time, and coordinates under a string printed
 * in the source, with nothing failing or warning.
 */
export async function resolveRootKey(env: RootKeyEnv): Promise<CryptoKey> {
  const configured = env.ROOT_KEK?.trim();
  const dev = isDevEnvironment(env.ENVIRONMENT);

  if (!configured) {
    if (!dev) {
      throw new RootKekError(
        "ROOT_KEK is not configured; set it with `wrangler secret put ROOT_KEK`",
      );
    }
    return deriveKek(DEV_ROOT_KEK);
  }
  if (configured === DEV_ROOT_KEK && !dev) {
    throw new RootKekError("ROOT_KEK is set to the development placeholder");
  }
  if (configured.length < MIN_ROOT_KEK_LENGTH) {
    throw new RootKekError(
      `ROOT_KEK must be at least ${MIN_ROOT_KEK_LENGTH} characters`,
    );
  }
  return deriveKek(configured);
}
```

- [ ] **Step 4: Add the config guard**

Create `apps/api/src/middleware/config-guard.ts`:

```ts
import type { Context, Next } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "./auth.js";
import { DEV_ROOT_KEK, isDevEnvironment } from "../crypto.js";

export interface ConfigFailure {
  code: string;
  message: string;
}

/**
 * Workers have no startup hook with access to bindings, so the closest thing to
 * "fail startup" is refusing every request. Cheap enough to run per request.
 */
export function checkSecureConfig(
  env: Pick<Env, "ENVIRONMENT" | "AUTH_STUB" | "ROOT_KEK"> | Partial<Env>,
): ConfigFailure | null {
  if (isDevEnvironment(env.ENVIRONMENT)) return null;

  if (env.AUTH_STUB === "1") {
    return {
      code: "auth_stub_in_production",
      message:
        "AUTH_STUB=1 trusts an unauthenticated X-User-Id header and must not be set outside development",
    };
  }
  const kek = env.ROOT_KEK?.trim();
  if (!kek || kek === DEV_ROOT_KEK) {
    return {
      code: "root_kek_not_configured",
      message: "ROOT_KEK must be configured with a real secret outside development",
    };
  }
  return null;
}

export async function configGuard(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const failure = checkSecureConfig(c.env);
  if (failure) {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    console.error("insecure_configuration", { code: failure.code });
    return c.json(
      {
        error: {
          code: "configuration_error",
          message: failure.message,
          request_id: requestId,
        },
      },
      503,
    );
  }
  await next();
}
```

- [ ] **Step 5: Update the `resolveRootKey` caller and make key destruction recoverable**

In `apps/api/src/db/users.ts`, replace `ensureUserKey` (lines 26-78) with:

```ts
export class UserKeyDestroyedError extends Error {
  readonly code = "user_key_destroyed";
  constructor(userId: string) {
    super(`Encryption key for ${userId} has been destroyed`);
    this.name = "UserKeyDestroyedError";
  }
}

export class UnsupportedKekVersionError extends Error {
  readonly code = "kek_version_unsupported";
  constructor(found: number) {
    super(
      `user_keys.kek_version ${found} predates KEK derivation v${KEK_DERIVATION_VERSION}; ` +
        `recreate the local database with: npm run db:local -w @patternlike/api`,
    );
    this.name = "UnsupportedKekVersionError";
  }
}

export async function ensureUserKey(
  env: Env,
  userId: string,
): Promise<{ dek: Uint8Array; keyVersion: number }> {
  const active = await env.DB.prepare(
    `SELECT key_version, kek_version, wrapped_dek FROM user_keys
     WHERE user_id = ? AND destroyed_at IS NULL
     ORDER BY key_version DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{ key_version: number; kek_version: number; wrapped_dek: ArrayBuffer }>();

  const root = await resolveRootKey(env);

  if (active) {
    if (active.kek_version !== KEK_DERIVATION_VERSION) {
      throw new UnsupportedKekVersionError(active.kek_version);
    }
    // Stored as nonce(12) || ciphertext
    const wrapped = new Uint8Array(active.wrapped_dek);
    const nonce = wrapped.slice(0, 12);
    const ct = wrapped.slice(12);
    const dekBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      root,
      ct,
    );
    return { dek: new Uint8Array(dekBuf), keyVersion: active.key_version };
  }

  // No live key. If one was destroyed the account was crypto-shredded; minting a
  // fresh DEK would quietly undo that, so refuse instead. Previously this path
  // 500ed forever because the insert collided on the user_id primary key.
  const destroyed = await env.DB.prepare(
    `SELECT 1 AS present FROM user_keys WHERE user_id = ? LIMIT 1`,
  )
    .bind(userId)
    .first<{ present: number }>();
  if (destroyed) {
    throw new UserKeyDestroyedError(userId);
  }

  const dek = await generateUserDek();
  const { wrapped_b64, nonce_b64 } = await wrapDek(dek, root);
  const nonce = Uint8Array.from(atob(nonce_b64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(wrapped_b64), (c) => c.charCodeAt(0));
  const packed = new Uint8Array(nonce.length + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, nonce.length);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at)
     VALUES (?, 1, ?, ?, ?)`,
  )
    .bind(userId, KEK_DERIVATION_VERSION, packed, now)
    .run();

  return { dek, keyVersion: 1 };
}
```

Update the import at the top of `users.ts` to include the new symbol:

```ts
import {
  generateUserDek,
  resolveRootKey,
  wrapDek,
  encryptJson,
  KEK_DERIVATION_VERSION,
} from "../crypto.js";
```

- [ ] **Step 6: Update the existing crypto test for the new signature**

In `apps/api/src/crypto.test.ts`, change line 14 from `const root = await resolveRootKey("test-root");` to:

```ts
    const root = await resolveRootKey({
      ENVIRONMENT: "test",
      ROOT_KEK: "a-test-root-key-long-enough-to-pass-32",
    });
```

- [ ] **Step 7: Wire the guard and split the internal router**

In `apps/api/src/routes/stubs.ts`, remove the `/internal/content-releases` route (lines 53-55) and add a second exported router at the end of the file:

```ts
/** Internal service-to-service surfaces. Mounted behind serviceAuth, not authStub. */
export const internalRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

internalRoutes.post("/internal/content-releases", (c) =>
  c.json(notImplemented("Content release ingestion (M2)"), 501),
);
```

In `apps/api/src/index.ts`, update the imports and mounting:

```ts
import { authStub, serviceAuth, type AppVariables } from "./middleware/auth.js";
import { configGuard } from "./middleware/config-guard.js";
import { stubRoutes, internalRoutes } from "./routes/stubs.js";
```

```ts
app.route("/", healthRoutes);

// Every non-health surface refuses to serve on an insecure configuration.
const api = new Hono<{ Bindings: Env; Variables: AppVariables }>();
api.use("*", configGuard);
api.use("*", authStub);
api.route("/", birthRoutes);
api.route("/", chartRoutes);
api.route("/", stubRoutes);

const internal = new Hono<{ Bindings: Env; Variables: AppVariables }>();
internal.use("*", configGuard);
internal.use("*", serviceAuth);
internal.route("/", internalRoutes);

app.route("/", internal);
app.route("/", api);
```

- [ ] **Step 8: Give the Worker a production environment**

In `apps/api/wrangler.toml`, annotate the default vars and append a production environment. Named environments do not inherit top-level bindings, so the D1 binding is redeclared:

```toml
# Default (development) vars. `wrangler deploy` without --env uses these, which
# is why npm run deploy targets the production environment explicitly and the
# configGuard middleware refuses AUTH_STUB=1 outside development.
[vars]
ENVIRONMENT = "development"
AUTH_STUB = "1"
CALC_SERVICE_URL = "http://127.0.0.1:8080"
SCHEMA_VERSION = "0.2.0"
# M0 decision: AGPL public SE — docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md
SE_LICENSE_MODE = "agpl"

[env.production]
name = "patternlike-api-production"

[env.production.vars]
ENVIRONMENT = "production"
CALC_SERVICE_URL = "https://calc.internal.patternlike.app"
SCHEMA_VERSION = "0.2.0"
SE_LICENSE_MODE = "agpl"
# AUTH_STUB is deliberately absent. Setting it here re-enables header-trusted auth.

[[env.production.d1_databases]]
binding = "DB"
database_name = "patternlike-ops"
database_id = "00000000-0000-0000-0000-000000000001"
migrations_dir = "../../db/d1"

# Secrets (set via `wrangler secret put --env production`):
# ROOT_KEK — envelope encryption root key (required; deploys refuse without it)
# SERVICE_AUTH_TOKEN — internal WordPress → CF release auth
```

In `apps/api/package.json`, change the deploy script:

```json
    "deploy": "wrangler deploy --env production",
```

In `.env.example`, add a `ROOT_KEK` line documenting the requirement. Read the file first and append rather than replacing it.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -w @patternlike/api`
Expected: PASS, 22 tests (2 crypto + 9 birth + 11 config).

Run: `npm run typecheck`
Expected: clean.

Run: `npx wrangler deploy --dry-run --outdir=dist --env production -c apps/api/wrangler.toml` from `apps/api`, or `npm run build -w @patternlike/api` for the default environment.
Expected: bundles without error. A missing `database_id` for a real deploy is expected at this stage; a *parse* error in `wrangler.toml` is not.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/crypto.ts apps/api/src/crypto.test.ts apps/api/src/config.test.ts \
        apps/api/src/middleware/config-guard.ts apps/api/src/db/users.ts \
        apps/api/src/index.ts apps/api/src/routes/stubs.ts \
        apps/api/wrangler.toml apps/api/package.json .env.example
git commit -m "fix(api): fail closed on dev secrets, derive KEK via HKDF, gate internal routes"
```

---

### Task 8: Pin the ephemeris data and fix the image build

**Files:**
- Create: `apps/calc-stub/ephemeris.lock.json`, `apps/calc-stub/.dockerignore`
- Rewrite: `apps/calc-stub/scripts/download-ephe.mjs`
- Modify: `apps/calc-stub/Dockerfile`, `apps/calc-stub/tsconfig.json`
- Modify: `contracts/m0/fixtures/valid/calculation-contract.launch.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `apps/calc-stub/ephemeris.lock.json` as the single source of truth for the upstream commit and per-file digests. The download script and the calculation contract fixture both derive from it.

**Three defects:** the `.se1` files are fetched from a moving `master` ref with no pinned commit, checksum, or signature, and the skip check only tests `size > 1000` so a truncated download caches permanently; the Dockerfile's presence gate checks `data/ephe/` relative to `WORKDIR /app/apps/calc-stub` while `SE_EPHE_PATH` sends the download to `/app/data/ephe`, so a clean clone hard-fails and a dirty context passes with an empty runtime directory; and `tsconfig.json` sets `"noEmit": true`, so `npm run build` exits 0 and emits nothing.

**The pin is verified:** all five files at commit `85e65da01dce506bd0ec044ad3e39ab6d144d82b` byte-match the copies currently in `apps/calc-stub/data/ephe/`.

- [ ] **Step 1: Create the lock file**

Create `apps/calc-stub/ephemeris.lock.json`:

```json
{
  "source": "https://github.com/aloistr/swisseph",
  "commit": "85e65da01dce506bd0ec044ad3e39ab6d144d82b",
  "path": "ephe",
  "note": "Swiss Ephemeris data pinned by commit and SHA-256. Update deliberately: change the commit, re-run with EPHE_UPDATE_LOCK=1, and commit the resulting digests.",
  "files": [
    {
      "name": "sepl_18.se1",
      "bytes": 484061,
      "sha256": "ca1393ceab3a44fbc895887cf789c68819ae6a1cbc9b22225872dbe4ccd99a66",
      "required": true
    },
    {
      "name": "semo_18.se1",
      "bytes": 1304771,
      "sha256": "1ca07bd67c24374d77226180c20a4f9996cba013697894810518e7eb582ca4f7",
      "required": true
    },
    {
      "name": "seas_18.se1",
      "bytes": 223004,
      "sha256": "a2cd8fc33807c78ca9a700c91c2e042258b12fc4796519e00781440b5ad8b2e2",
      "required": false
    },
    {
      "name": "sefstars.txt",
      "bytes": 136618,
      "sha256": "18b0dcafbe5b7240773daba2c038a325f5b3fc4163f61e0a7f4e92abd4f517c6",
      "required": false
    },
    {
      "name": "seorbel.txt",
      "bytes": 6063,
      "sha256": "97b454ff78f4f4716b5cc987a93ca8f33e44ef4b524a165a155a8a4885fd2e18",
      "required": false
    }
  ]
}
```

- [ ] **Step 2: Rewrite the download script**

Replace `apps/calc-stub/scripts/download-ephe.mjs` entirely:

```js
#!/usr/bin/env node
/**
 * Download and verify Swiss Ephemeris data files.
 *
 * Every file is fetched from a pinned commit and checked against the SHA-256 in
 * ephemeris.lock.json. Existing files are re-verified rather than trusted for
 * being non-empty, so a truncated or tampered download cannot cache forever.
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
      `${name}: SHA-256 mismatch\n  expected ${expected}\n  actual   ${actual}\n` +
        `  source   ${BASE}/${name}\n` +
        `If upstream changed intentionally, update ephemeris.lock.json deliberately.`,
    );
  }
  return actual;
}

async function ensure(entry) {
  const dest = path.join(outDir, entry.name);

  if (fs.existsSync(dest)) {
    const existing = fs.readFileSync(dest);
    const actual = sha256(existing);
    if (actual === entry.sha256) {
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
for (const entry of lock.files) {
  try {
    await ensure(entry);
  } catch (err) {
    failed++;
    const fatal = entry.required !== false;
    console.error(`${fatal ? "FATAL" : "warn "} ${entry.name}: ${err.message}`);
    if (fatal) {
      process.exitCode = 1;
    }
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
if (process.exitCode === 1) {
  process.exit(1);
}
console.log(`done (${lock.files.length - failed}/${lock.files.length} verified)`);
```

- [ ] **Step 3: Verify the script against the real upstream**

Run: `npm run ephe:download -w @patternlike/calc-stub`
Expected: five `ok ... (verified, N bytes)` lines using the existing local files, exit 0.

Now prove the verification actually bites — corrupt a file and re-run:

```bash
node -e "const f='apps/calc-stub/data/ephe/seorbel.txt';require('fs').appendFileSync(f,'corrupt')"
npm run ephe:download -w @patternlike/calc-stub
```

Expected: `stale seorbel.txt (digest mismatch, re-downloading)` followed by `ok seorbel.txt`, exit 0. Run once more and confirm it reports `ok ... (verified)`.

- [ ] **Step 4: Fix the Dockerfile**

Replace lines 28-30 of `apps/calc-stub/Dockerfile` with:

```dockerfile
# Ephemeris files are fetched from the commit pinned in ephemeris.lock.json and
# verified by SHA-256. No `|| true`: a failed or tampered download must fail the
# build. The presence gate checks $SE_EPHE_PATH — the directory the downloader
# actually writes to — not a relative path under WORKDIR.
RUN npm run ephe:download
RUN test -f "$SE_EPHE_PATH/sepl_18.se1" && test -f "$SE_EPHE_PATH/semo_18.se1"
```

- [ ] **Step 5: Add a `.dockerignore`**

Create `apps/calc-stub/.dockerignore` (note: the build context is the repository root, so this file is a convenience for context-local builds; also create an identical one at the repository root if builds run from there):

```
node_modules
**/node_modules
**/dist
**/.wrangler
**/data/ephe
.git
*.log
```

- [ ] **Step 6: Make `build` actually emit**

In `apps/calc-stub/tsconfig.json`, delete `"noEmit": true` and exclude tests from the emitted output:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

The `typecheck` script passes `--noEmit` on the command line, so it is unaffected.

- [ ] **Step 7: Verify the build emits**

Run: `npm run build -w @patternlike/calc-stub`
Expected: exit 0.

Run: `ls apps/calc-stub/dist`
Expected: `engine.js`, `ephe-path.js`, `license-mode.js`, `server.js` and their `.d.ts` / `.map` files. No `*.test.js`.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Put the real digests in the calculation contract**

In `contracts/m0/fixtures/valid/calculation-contract.launch.json`, replace the `data_files` array. The schema sets `additionalProperties: false` with only `name` and `sha256` permitted, so no other fields may be added. `seas_18.se1` — an asteroid file the engine does not require — is replaced by the two files it actually loads:

```json
    "data_files": [
      {
        "name": "sepl_18.se1",
        "sha256": "ca1393ceab3a44fbc895887cf789c68819ae6a1cbc9b22225872dbe4ccd99a66"
      },
      {
        "name": "semo_18.se1",
        "sha256": "1ca07bd67c24374d77226180c20a4f9996cba013697894810518e7eb582ca4f7"
      },
      {
        "name": "seas_18.se1",
        "sha256": "a2cd8fc33807c78ca9a700c91c2e042258b12fc4796519e00781440b5ad8b2e2"
      }
    ],
```

Set `wrapper_commit` to the current commit of this repository — the calculation wrapper is `apps/calc-stub`, and until Task 0 there was no commit to name. Get it with `git rev-parse HEAD` and paste the full 40-character SHA. Leave `container_digest` as the placeholder; it is stamped by the image build pipeline (`engine.ts` already reads `process.env.CONTAINER_DIGEST`) and Task 9 escalates it.

- [ ] **Step 9: Verify the contracts still validate**

Run: `npm run test:contracts`
Expected: PASS, `OpenAPI OK v0.2.0 paths=13`.

- [ ] **Step 10: Commit**

```bash
git add apps/calc-stub/ephemeris.lock.json apps/calc-stub/scripts/download-ephe.mjs \
        apps/calc-stub/Dockerfile apps/calc-stub/.dockerignore apps/calc-stub/tsconfig.json \
        contracts/m0/fixtures/valid/calculation-contract.launch.json
git commit -m "fix(calc): pin ephemeris data by commit and SHA-256, fix image build gate"
```

---

### Task 9: Escalate the contract-level defects and correct the README

**Files:**
- Create: `docs/reviews/2026-08-01-spec-escalations.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the outcome of Tasks 1–8.
- Produces: a document listing every reviewed defect that is *not* a code bug, so the next change lands in the spec rather than in a patch that diverges from it.

The review's own step 7 is explicit: reading identity, the cycle model, and crypto-shredding are contract decisions the code currently implements correctly. Patching the code would make it diverge from a frozen contract. These go to the spec.

- [ ] **Step 1: Write the escalation document**

Create `docs/reviews/2026-08-01-spec-escalations.md`:

```markdown
# Spec-level escalations from the 2026-08-01 code review

Items here are **not** code bugs. In each case the code implements the frozen
M0 contract faithfully, so the fix has to land in the spec first. Patching the
code alone would make the implementation diverge from the contract it is
validated against.

Code-level findings from the same review were fixed in commits on `main`
between the baseline (`53847f0`) and this document. See
`docs/superpowers/plans/2026-08-01-code-review-remediation.md`.

## Blocking a contract revision

### 1. Crypto-shredding cannot work while the wrapped DEK shares a database with the ciphertext
`user_keys.wrapped_dek` sits in the same D1 database as `birth_enc` and
`snapshot_json`, so D1 Time Travel retains both. Destroying the key does not
make a point-in-time restore unable to recover the plaintext. The spec mandates
this shape ("store only the wrapped DEK"), so the schema is not the thing to
change — the spec needs to say where the KEK lives (Secrets Store, external KMS)
and what the retention interaction is.

### 2. Daily reading identity has no revision concept
`UNIQUE (user_id, local_date, release_version)` is in the schema verbatim from
the spec. There is no way to correct or reissue a reading for a given day
without either violating the constraint or silently overwriting history. The
spec's uniqueness key needs a revision component before the code can change.

### 3. The cycle model stores one pass per cycle
Singular `start_at` / `exact_at` / `end_at` and a single `phase`, as specified.
Retrograde cycles have multiple passes. `cycle_json TEXT NOT NULL` is an
unconstrained escape hatch that could hold them, but nothing indexed,
constrained, or queryable represents a pass. This is a data-model decision, not
an implementation detail.

### 4. `reading_key` embeds the raw application user id
`readingAssemblyRequest` *requires* `reading_key`, whose pattern embeds the user
id — the canonical fixture is
`"user:usr_01JAMPLEUSER00000001:2026-07-30:release-12"`. Whether that value is
ever forwarded to a model is undefined. The spec needs to state the boundary:
either the key is opaque to the assembly layer, or the contract says explicitly
that it never crosses into a prompt.

## Correctness gaps with no storage model yet

### 5. Cascading revocation has nowhere to land
There is no `derived_features` table, no `feature_dependencies`, and no
`invalidated_at` column anywhere. The data-source registry defines 22 Category F
derived features with no storage model at all, so revoking a source cannot
invalidate what was derived from it.

### 6. Exclusion is enforced by id prefix, but one exclusion is by status
The schema enforces `^(AST|USR|DEV|CLD|AMB|DER)-\d{2}$` and three D1 CHECKs use
`NOT GLOB 'NO-*'`. AMB-12 ("Major news and world events", Category E,
`phase: never`) is excluded by *status*, not prefix, so a signal citing it
passes both gates. Both taxonomies total 139 and the counts reconcile — the
registry is not wrong, the enforcement mechanism is. Nothing in CI keeps the
44-value `allowedUse` enum in sync with the registry either; it happens to be
correct today.

### 7. Release signing is declared but never verified
The frozen bundle fixture carries `key_id: "wp-release-key-1"`. No signature
verification code exists anywhere in the repository, and the validator only
checks that `signed_payload_hash` equals the bundle's own declared
`bundle_hash` — it never recomputes either from content.

### 8. `canonicalJson` has no named standard
`JSON.stringify(sortKeys(v))` with no number-representation rule and no Unicode
normalization. Today it has exactly one caller (the chart fingerprint), so the
risk is latent — it becomes real the moment it is used for the release bundle
hash. Related: `contentHash` makes the `sha256:` prefix optional, giving one
digest two schema-valid encodings that the release policy check compares as raw
strings.

## Contract text that overstates what exists

### 9. `techniques_enabled` declares five unimplemented techniques
`calculation-contract.launch.json` lists `transits`, `stations_ingresses`, and
`lunations_eclipses`. The engine implements none of them. Either the contract
should describe launch scope accurately or it needs a field distinguishing
"declared for the contract version" from "implemented in this container".

### 10. `container_digest` is still a placeholder
`sha256:cccc…` in the frozen fixture. `engine.ts` already reads
`process.env.CONTAINER_DIGEST`, so this resolves the first time the image build
pipeline stamps it. Until then no deployed chart can prove which image produced
it. (`wrapper_commit` was resolved to a real commit in this remediation now that
the repository has history.)

### 11. Encryption boundaries are drawn around the wrong column
`snapshot_json` is stored in clear with cusps and ASC/MC at 1e-6°, which invert
to the birth instant and coordinates. The schema comment calls it "Non-PII
normalized facts". The per-user DEK protecting `birth_enc` in the same row buys
nothing against a reader of that column. Separately, no AAD binds any ciphertext
to a user or record, and there is no rewrap path. Fixing this means deciding
what precision the snapshot needs, which is a product question.

### 12. The M0 quality gate lets a model overwrite its own verdict
`.grok/workflows/verify-m0-contracts.rhai` tallies blockers deterministically at
line 248, then at line 268 replaces that tally with an integer returned by the
synthesis agent and recomputes `overall_pass` from the substituted value. A
miscount flips the gate to PASS. It is currently wired into nothing — CI calls
the Python validators directly — while `SCHEMA_MANIFEST.json` cites this
workflow as the provenance of the contract hardening.

## Surfaces that do not exist yet

Model-editing validation (M3), account deletion timing (M1), relationship data
(M5), and accessibility (no client) were reviewed and found to be genuinely
absent rather than wrong. `audit_events` is never written by any code path.
Thirteen documented routes exist; saved readings, reflections, life events,
notification preferences, connector authorization and callback, and async
workflow status do not, and there is no concurrency contract on any mutation.
```

- [ ] **Step 2: Correct the README's completeness claim**

`README.md` lists "Unknown birth-time mode (no silent noon as stored instant)" as complete. The stored *instant* was indeed null, but the derived facts were noon — a user with no known birth time was told their rising sign. Read `README.md`, find that bullet, and replace it with wording that matches the code after Task 2:

```markdown
- Unknown birth-time mode: noon is a technical epoch only. It is never stored as
  the birth instant, and houses, angles, and time-sensitive Moon claims are
  suppressed whenever no real birth time was supplied — regardless of the
  accuracy label the caller sends.
```

Check the rest of the README's completeness list against what Tasks 1–8 actually changed and correct anything else that overstates the state of the code.

- [ ] **Step 3: Full verification**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run test`
Expected: calc-stub 32 pass, api 22 pass, contracts pass. This is the first end-to-end run of the aggregate script.

Run: `npm run build`
Expected: exit 0, `apps/calc-stub/dist` populated.

- [ ] **Step 4: Commit**

```bash
git add docs/reviews/2026-08-01-spec-escalations.md README.md
git commit -m "docs: escalate contract-level review findings and correct README claims"
```

---

## Self-Review

**Spec coverage.** All seven steps of the review's suggested order map to tasks: step 1 → Task 0 (complete); step 2 → Tasks 1 and 2; step 3 → Task 3; step 4 → Tasks 4, 5, 6; step 5 → Task 7; step 6 → Task 8; step 7 → Task 9. All five ship-blocking findings are covered (fabricated angles → Task 2; applying/separating → Task 3; impossible date → Task 1; global idempotency → Tasks 4 and 5; ROOT_KEK → Task 7).

**Items from "Also reproduced live" folded into the nearest task**, rather than left for step 7: the 500 on resubmission and on key retry, the birthplace-correction 500, orphaned `birth_profiles` rows, and the missing 409 (Task 5); the invalid-timezone silent-UTC computation, the ignored `approximate_window_minutes`, and unchecked coordinates (Tasks 1 and 2); the permanent 500 after `destroyed_at` (Tasks 4 and 7); the plain-text 500 with no `app.onError` (Task 6); `/internal/content-releases` on the consumer router (Task 7); the 502 filesystem-path leak (Tasks 1 and 5); `noEmit` (Task 8).

**Deliberately not fixed in code**, and escalated in Task 9 instead: the fingerprint's omission of latitude and longitude when angles are suppressed (correct given suppression, but it means a birthplace correction is a no-op for an unknown-time user — a product decision); `snapshot_json` plaintext precision; AAD binding; the `.rhai` quality gate; `techniques_enabled`; `container_digest`. Each is named in the escalation document with the reason.

**Known gap — since closed.** Tasks 5, 6, and 7 changed request-handling behaviour that the test setup at the time could not exercise: `apps/api` had no Miniflare harness, so no test bound a real D1. That was addressed after this plan completed, in commit `5f45063` — `@cloudflare/vitest-pool-workers` with real D1 bindings, 41 new tests covering the rewritten handler. See the "Testing posture" section of [`docs/reviews/2026-08-01-spec-escalations.md`](../../reviews/2026-08-01-spec-escalations.md) for what is and is not covered now.
