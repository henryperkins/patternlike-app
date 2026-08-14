# Your Pattern candidates

**Nothing in this directory is approved, reviewed, or shippable.**

`candidates.json` holds draft Pattern families written to be reviewed. Every
record carries `state: "review_candidate"` and no signature metadata, and the
runtime has no code path that reads this directory. A reader never sees these
words unless a human reviews them, a human approves them, someone signs the
resulting release with a real key, and an operator ingests and activates it.

## Why this is not a fallback

`GET /v1/pattern` reads the active signed release and nothing else. When no M4
release is active it answers `503 pattern_release_not_active` and the client
says so. That refusal is the product working correctly: substituting draft prose
for reviewed prose would make "reviewed" mean nothing.

`scripts/pattern-release/build.test.mjs` asserts that no runtime source file
references this path.

## What a candidate is

One JSON object per Pattern family, in one array so a reviewer reads the whole
catalog in one diff. Each record carries:

| Field | Meaning |
| --- | --- |
| `candidate_id` | Stable id for review correspondence. Never shipped. |
| `content_id` | The `id` the object will carry inside a release. |
| `content_version`, `locale` | Version and language of this draft. |
| `state` | Always `review_candidate` here. |
| `title`, `summary`, `body` | The reader-facing prose under review. |
| `resources`, `tensions`, `counter_expression` | The three required framings. |
| `prohibited_claims` | Claims this family must never make. |
| `evidence_requirements` | Human-readable statement of what must be calculated for this to be eligible. Reviewed against `match`. |
| `match` | The exact M4 predicate object the matcher evaluates. |
| `minimum_accuracy`, `requires_houses`, `required_bodies`, `required_aspects` | Coarse eligibility gates run before `match`. |
| `display_priority`, `tags` | Editorial ordering and grouping. |
| `reviewer_notes` | Notes for the reviewer. Stripped by the builder; never shipped. |

## Coverage

The 24 families are distributed across the four groups the design calls for:

- **Integrated aspect structures** — a single calculated aspect between two
  bodies, or a small set of them.
- **Elemental and modal emphasis** — several bodies sharing element or modality,
  expressed as sign predicates over calculated positions.
- **Calculated multi-body patterns** — configurations that need two or three
  calculated aspects at once (grand trine, T-square, and similar), written as
  aspect predicates because those are the facts the calculation actually
  produces today.
- **Accuracy-gated angular and house patterns** — families that require a real
  birth time, and are therefore ineligible whenever houses and angles are
  suppressed.

The `pattern` predicate type exists in the M4 contract and the matcher
implements it, but `apps/calc-stub` currently emits `patterns: []`. A candidate
written against `type: "pattern"` would be permanently ineligible, so none is.
When the engine begins emitting multi-body patterns, those families can be
rewritten against it under a new content version.

## Promotion

```bash
node scripts/pattern-release/build.mjs \
  --review-manifest <path to the human review manifest> \
  --version release-<n> \
  --out build/release-<n>.unsigned.json

node scripts/pattern-release/sign.mjs \
  --release build/release-<n>.unsigned.json \
  --key-id <id> --alg Ed25519 \
  --private-key-file <path outside this repository> \
  --out build/release-<n>.signed.json
```

The builder refuses to emit anything unless a review manifest approves every
included candidate, names a distinct human author and approver per approval, and
matches the reviewed content and match-rule hashes. **No review manifest is
committed to this repository**, because committing one would be this repository
asserting that a human review happened. Write one, or the builder refuses — that
refusal is the gate.

Private signing keys are never written here, to `build/`, to logs, or to test
snapshots. The signing command reads a key file from a path you supply.
