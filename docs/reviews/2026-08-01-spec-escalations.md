# Spec-level escalations from the 2026-08-01 code review

Items here are **not** code bugs. In each case the code implements the frozen M0
contract faithfully, so the fix has to land in the spec first — patching the
code alone would make the implementation diverge from the contract it is
validated against.

Code-level findings from the same review were fixed on `main` between the
baseline commit (`53847f0`) and this document. The work is recorded in
[`docs/superpowers/plans/2026-08-01-code-review-remediation.md`](../superpowers/plans/2026-08-01-code-review-remediation.md).

Every claim below was re-confirmed against the tree at the time of writing.

---

## Blocking a contract revision

### 1. Crypto-shredding cannot work while the wrapped DEK shares a database with the ciphertext

`user_keys.wrapped_dek` sits in the same D1 database as `chart_snapshots.birth_enc`
and `birth_profiles.payload_enc`, so D1 Time Travel retains both. Destroying the
key does not stop a point-in-time restore from recovering the plaintext.

The spec mandates this shape ("store only the wrapped DEK"), so the schema is not
the thing to change. The spec needs to say where the KEK lives — Cloudflare
Secrets Store, an external KMS — and what the Time Travel retention interaction
is.

Related and now partly addressed in code: `ensureUserKey` refuses to mint a fresh
DEK for a user whose keys have all been destroyed, so a crypto-shred is no longer
silently undone by the next request.

### 2. Daily reading identity has no revision concept

`UNIQUE (user_id, local_date, release_version)` is in `0001_m0_core.sql` verbatim
from the spec. There is no way to correct or reissue a reading for a given day
without either violating the constraint or silently overwriting history. The
spec's uniqueness key needs a revision component before the code can change.

### 3. The cycle model stores one pass per cycle

Singular `start_at` / `exact_at` / `end_at` and a single `phase`, as specified.
Retrograde cycles have multiple passes. `cycle_json TEXT NOT NULL` is an
unconstrained escape hatch that could hold them, but nothing indexed,
constrained, or queryable represents a pass. This is a data-model decision, not
an implementation detail.

### 4. `reading_key` embeds the raw application user id

`readingAssemblyRequest` **requires** `reading_key`, whose pattern embeds the user
id. The canonical fixture is literally:

```
"reading_key": "user:usr_01JAMPLEUSER00000001:2026-07-30:release-12"
```

Whether that value is ever forwarded to a model is undefined. The spec needs to
state the boundary: either the key is opaque to the assembly layer, or the
contract says explicitly that it never crosses into a prompt.

---

## Correctness gaps with no storage model yet

### 5. Cascading revocation has nowhere to land

There is no `derived_features` table, no `feature_dependencies`, and no
`invalidated_at` column anywhere in `db/d1/` or `contracts/m0/` — confirmed by
search. The data-source registry defines Category F derived features with no
storage model at all, so revoking a source cannot invalidate what was derived
from it.

### 6. Exclusion is enforced by id prefix, but one exclusion is by status

The schema enforces `^(AST|USR|DEV|CLD|AMB|DER)-\d{2}$` and three D1 CHECKs use
`NOT GLOB 'NO-*'`. **AMB-12** — "Major news and world events", Category E — is
excluded by *status*, not by prefix, so a signal citing it passes both gates.

The registry itself is not wrong; the enforcement mechanism is. Nothing in CI
keeps the `allowedUse` enum in sync with the registry either — it happens to be
correct today, which is not the same as being kept correct.

### 7. Release signing is declared but never verified

The frozen bundle fixture carries `"key_id": "wp-release-key-1"` and
`"signed_payload_hash": "sha256:aaaa…"`. No signature verification code exists
anywhere in the repository — confirmed by search — and the validator only checks
that `signed_payload_hash` equals the bundle's own declared `bundle_hash`. It
never recomputes either from content, so a bundle can attest to itself.

### 8. `canonicalJson` has no named standard

`packages/shared/src/index.ts` defines it as `JSON.stringify(sortKeys(v))` — no
number-representation rule, no Unicode normalization. Today it has exactly one
caller (the chart fingerprint), so the risk is latent. It becomes real the moment
it is used for the release bundle hash.

Related: `contentHash` emits a `sha256:` prefix while the schema's `sha256Hex`
accepts the bare form, giving one digest two schema-valid encodings that the
release policy check compares as raw strings.

---

## Contract text that overstates what exists

### 9. `techniques_enabled` declares five unimplemented techniques

`calculation-contract.launch.json` lists `transits`, `stations_ingresses`, and
`lunations_eclipses` alongside the three the engine implements. Either the
contract should describe launch scope accurately, or it needs a field
distinguishing "declared for the contract version" from "implemented in this
container".

Left unchanged deliberately: this is a frozen contract, and narrowing it is a
scope decision rather than a defect fix.

### 10. `container_digest` and `wrapper_commit` should be stamped, not hand-maintained

`container_digest` is still the placeholder `sha256:cccc…`. `engine.ts` already
reads `process.env.CONTAINER_DIGEST`, so it resolves the first time the image
build pipeline stamps it; until then no deployed chart can prove which image
produced it.

`wrapper_commit` was `deadbeefcafebabe0123456` and has been set to a real commit
now that the repository has history — but a hand-written SHA in a frozen fixture
goes stale on the next commit. Both fields belong to the build, not to a
checked-in file.

### 11. Encryption boundaries are drawn around the wrong column

`snapshot_json` is stored in clear with cusps and ASC/MC at 1e-6°, which invert to
the birth instant and coordinates. The schema comment calls it "Non-PII normalized
facts only … Must NOT contain birth date/time/place plaintext" — but the derived
values are equivalent to the plaintext. The per-user DEK protecting `birth_enc` in
the same row buys nothing against a reader of that column.

Separately: no AAD binds any ciphertext to a user or record, and there is no
rewrap path. Fixing the first requires deciding what precision the snapshot needs,
which is a product question. AAD binding and rewrap are implementable now and are
the obvious next crypto task.

### 12. The M0 quality gate lets a model overwrite part of its own verdict

`.grok/workflows/verify-m0-contracts.rhai` tallies blockers deterministically at
lines 248–255, then at line 268 replaces that tally with an integer returned by
the synthesis agent, and at lines 273–277 recomputes `overall_pass` from the
substituted value under a comment claiming the "authoritative" rule.

`auto_passed` still gates independently, so a model cannot turn a failing
validator run into a pass — but it can zero out the blocker count and flip the
blocker half of the gate. The workflow is currently wired into nothing (CI calls
the Python validators directly) while `SCHEMA_MANIFEST.json` cites it as the
provenance of the contract hardening.

---

## Surfaces that do not exist yet

Reviewed and found genuinely absent rather than wrong: model-editing validation
(M3), account deletion timing (M1), relationship data (M5), and accessibility (no
client exists). `audit_events` is never written by any code path.

Thirteen documented routes exist. Absent: saved readings, reflections, life
events, notification preferences, connector authorization and callback, and async
workflow status. There is no concurrency contract on any mutation.

---

## Testing posture

**Resolved.** `apps/api` now runs its tests inside workerd via
`@cloudflare/vitest-pool-workers`, with a real local D1 bound from
`wrangler.toml` and `0001_m0_core.sql` applied per test file. The rewritten
request handling — idempotency scoping, batched writes, 409 on a duplicate
fingerprint, failed-job retry and recovery, the lifecycle invariants — is
verified by execution rather than by construction. 67 api tests, 33 calc-stub
tests, plus the contract validators.

Outbound calls to the calculation service are intercepted by a deterministic
mock (`apps/api/test/mock-calc-service.ts`) wired through miniflare's
`outboundService`, so the suite is hermetic. The real engine's behaviour is
covered separately by the 33 tests in `apps/calc-stub`.

Remaining gaps, smaller than before:

- **No end-to-end test across both services.** Nothing exercises the real
  Worker against the real Swiss Ephemeris container. The mock mirrors the
  engine's contract by hand, so a divergence between them would go unnoticed.
- **The config guard's production 503 is unit-tested, not driven through a
  request.** `ENVIRONMENT` comes from `wrangler.toml` at config time and cannot
  be varied per test without a second vitest project.
- **CI has still never executed.** The workflow is well-formed and now has more
  to run, but no git remote is configured, so nothing has been validated on a
  clean Linux checkout.
