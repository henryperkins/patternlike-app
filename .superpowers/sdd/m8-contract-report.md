# Unified M8 consumer contract freeze report

## Status

Complete on `cursor/p0-p1-hardening-core-loop-f7dd`. The validator-only RED
revision was committed and pushed before the failing contract run. The unified
M8 package and shared types were then committed and pushed before GREEN
verification. No runtime, database, migration, or UI file changed.

## Commits

1. `27b284a test(contracts): require unified M8 package`
   - Registers M8, all seven fixture prefixes, the complete fixture inventory,
     exact predecessor hashes, recursive object closure, account-export
     supersession, all required OpenAPI methods, immutable geocoder consent,
     frozen reading detail, and the birth `429`.
   - Committed and pushed before RED execution.
2. `405261d contracts: add M8 core-loop amendments`
   - Adds the single complete M8 package, shared public types/exports, and
     focused shared tests.
   - Strengthens M7 OpenAPI retention from status-set equality to structural
     equality for every existing operation, global security/server declaration,
     and component.
   - Committed and pushed before GREEN execution.

Both commits are pushed to
`origin/cursor/p0-p1-hardening-core-loop-f7dd`.

## RED evidence

Command:

```bash
npm run test:contracts
```

Exit code: `1`.

The intended RED reported that `contracts/m8` had no manifest, schemas,
fixtures, or OpenAPI document. In particular, the new validator declarations
failed on the required 9 valid fixtures, 11 invalid fixtures, 7 schema files,
M8 predecessor freeze, and all new route/method projections. No implementation
file existed at this point.

## GREEN evidence

The requested commands were run in order after `405261d` was pushed:

```text
$ npm run test:contracts
OK  openapi       openapi.yaml v0.8.0 paths=19
OK  normative     openapi.yaml: 26 schema pointer(s) resolve
OK  inventory     contracts/m8 has 9 valid and 11 invalid required fixture(s)
OK  projection    M8 schemas close every object, bound search/history, pin consent, and isolate provider identity
OK  manifest      contracts/m8 declares 7 schema(s), pins all six predecessors, and supersedes only M7 account export
OK  projection    M8 OpenAPI retains M7, adds every consumer method, pins geocoder consent, M3/M5 detail, and birth 429
All contract package checks passed.
Migration smoke checks passed.
exit 0

$ npm test -w @patternlike/shared
1..61
# tests 64
# pass 64
# fail 0
exit 0

$ npm run typecheck -w @patternlike/shared
> tsc -p tsconfig.json --noEmit
exit 0

$ git diff --check b9056fb..HEAD
exit 0

$ git diff --exit-code b9056fb -- contracts/m0 contracts/m1 contracts/m2 contracts/m3 contracts/m4 contracts/m5 contracts/m6 contracts/m7
exit 0
```

## Files

Created:

- `contracts/m8/common.schema.json`
- `contracts/m8/place-search.schema.json`
- `contracts/m8/place-resolution.schema.json`
- `contracts/m8/geocoder-consent.schema.json`
- `contracts/m8/reading-history.schema.json`
- `contracts/m8/reading-save-state.schema.json`
- `contracts/m8/account-export.schema.json`
- `contracts/m8/openapi/openapi.yaml`
- `contracts/m8/SCHEMA_MANIFEST.json`
- 9 files under `contracts/m8/fixtures/valid`
- 11 files under `contracts/m8/fixtures/invalid`
- `packages/shared/src/m8-place-types.ts`
- `packages/shared/src/m8-reading-history-types.ts`
- `packages/shared/src/m8-types.test.ts`

Modified:

- `contracts/validate_schemas.py`
- `packages/shared/src/index.ts`

## Exact predecessor hashes

The M8 manifest records and validation recomputes:

```text
contracts/m0  75b447fedca2824543f8e304a7bdcc0c83766786f33cb93135b1887de73d8226
contracts/m3  c63af426f6213be034546cee10a34acfd80bcad3bf297ffb41bf5a48fd0feb52
contracts/m4  c65c6f2b5cf02cda91b0cdc062f12783e8c775f46be1756d55ae86e8976e311c
contracts/m5  57aadef51a6eca825866865c4cb0e75503cb29f497f998dc2a56b8971cc6674e
contracts/m6  4ead039fd6a264555c2712f1eb950352eccfb9ca78e10a8d9f03c1e00159c148
contracts/m7  15dda8c063d22d94bb6b9fd1000ccff9a05e90f27ece8c115a3a9ab58bf023bc
```

M1 and M2 do not have package manifests in the validated predecessor chain;
the explicit baseline diff proves all files under `contracts/m0` through
`contracts/m7` are byte-identical to `b9056fb`.

## Contract coverage

- Place search freezes trimmed 2..120-code-point queries, 8..128-character
  app session tokens, and at most 8 provider-neutral candidates.
- Place resolution freezes app-owned `plc_` ids, coordinate bounds, three
  confidence levels, and at most 2 closed qualifiers.
- Geocoder consent pins `AST-02`, permission tier `0`, the ordered two-use
  tuple, empty scopes, null connector account, provider, policy version,
  disclosure text, and all four links. Its `oneOf` makes granted timestamp/UI
  state and not-granted null state mutually exclusive.
- Reading history freezes the two views, readable terminal statuses, revision
  metadata, list maximum 50, cursor maximum 2048, canonical base64url
  mode-binding policy, and `saved`/`saved_at` invariants.
- Save state is closed and rejects both extra properties and an unsaved
  non-null timestamp.
- M8 account export preserves the complete M7 section structure, remains
  closed at M8-owned object boundaries, defines existing reading
  metadata/artifact/evidence, and declares `saved_at` exactly once on exported
  daily-reading items. It supersedes exactly M7 account export, not M3/M5
  reading artifacts.
- The birth acceptance fixture pins
  `birth_calc_budget_exhausted`, the generic message, request id, and RFC3339
  `details.resets_at`; the rejection fixture omits `resets_at`.
- OpenAPI retains every M7 operation and component unchanged and adds all
  required place, consent, reading history/detail/Save methods plus the birth
  POST `429`. Reading detail is the ordered frozen M3/M5 success `oneOf`.

## Fixture and leakage self-review

- Inventory is exact: 9 valid and 11 invalid fixtures, with every filename
  prefix registered.
- The explicit plan-gap fixtures are present:
  `reading-history.pending-status.json`,
  `reading-save-state.unsaved-with-timestamp.json`,
  `birth-profile.budget-exhausted.json`, and
  `birth-profile.budget-exhausted-missing-reset.json`.
- The geocoder provider id occurs only in the geocoder consent schema,
  consent OpenAPI component, consent fixtures, and the consent response member
  in shared types.
- Place request/response schemas contain no provider name/id, score, raw
  address components, or attribution field. The only `provider_place_id`
  occurrence is the deliberate invalid fixture proving rejection.
- M8 account-export `saved_at` has one schema declaration, under
  `exportedDailyReading`.

## Concerns

No remaining contract correctness concern was found. Runtime, D1, and UI
consumers intentionally remain unimplemented in this freeze and are follow-on
tasks, not omissions from this change.
