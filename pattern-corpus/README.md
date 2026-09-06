# Edition 0.1 provenance

This is a corpus of 60 model-generated first-party fragments. The source label
`Pattern editorial (model-generated)` is retained in every fragment. A
`licensed_excerpt` rights classification does not assert human authorship,
independent external interpretation sources, or completed editorial review.

[`provenance.json`](./provenance.json) records the current UTF-8 file hash and
one canonical full-fragment hash per `ref`. Canonical fragment JSON sorts object
keys, preserves array order, and includes all fields, including `ref` and the
source metadata. The packaged pipeline corpus hash in the rights decision
belongs to a different, ID-injected artifact; it is not this raw file hash.

The sidecar binds the existing rights decision by path and hash. Its historical
generation fields are explicitly `unverified` with `null` values: provider,
model, model version, account context, and generation date. The current runtime
model and account must not be substituted for these missing historical records.
Zero fragments have a recorded human certification. That means certification
evidence is incomplete; it does not assert that no person has ever read them.

Run the repository-side integrity gate from the repository root:

```bash
node pattern-corpus/validate-fragments.mjs pattern-corpus/fragments.json
npm run test:content
```

The fragment validator requires the adjacent provenance sidecar. It rejects
changed content, missing or duplicate inventory entries, metadata drift, a
changed rights decision, relabelled origin, and unsupported review claims.
The test file is in `scripts/pattern-release/` so the existing `test:content`
and full `ci:local` lanes execute it. A pass establishes consistency with the
recorded, incomplete provenance; it does not grant public activation.

Version `pattern-corpus-provenance.v1` is the unresolved historical inventory
for this edition. It deliberately refuses replacing unknown generation fields
with current runtime values or turning an empty certification list into a
completed review. Recovering the actual generation record or accepting human
certifications must use separate evidence with reviewed attribution. A new
edition with complete generation records does not retroactively establish this
edition's history. Fragment edits also require a new hash record and fresh review
of the edited bytes.

## Attributable review evidence

[`review.mjs`](./review.mjs) prepares complete review packets and blank review
forms, verifies externally supplied Ed25519 signatures, and records the supplied
review bytes without overwriting an existing record. It does not generate
judgments, keys, signatures, reviewer enrollment, or public-activation approval.
[`reviewers.json`](./reviewers.json) starts empty. No real human review records
have been supplied by this implementation.

From the repository root, prepare all fragments or a manageable subset:

```bash
node pattern-corpus/review.mjs packet --out /tmp/pattern-corpus-review
node pattern-corpus/review.mjs packet --out /tmp/pattern-corpus-mars --refs mars-body-initiation
```

The output directory must be new. `packet.md` contains every field of the
selected fragments, their canonical hashes, and explicit copying, stereotyping
and protected-characteristic, safety, voice, and source-fidelity/uncertainty
criteria. `packet.json` binds the exact corpus bytes, historical provenance,
criteria, and selected fragment hashes. `review-draft.json` leaves the identity,
date, attestations, outcomes, notes, and evidence references incomplete.

Before importing a real review, an authorized operator must verify the named
reviewer's identity and independence from this edition's generation, obtain
their Ed25519 public key, and add an entry to `reviewers.json` in a reviewed
change. The required fields are `reviewer_id` (a lowercase hyphenated ID),
`name`, `kind: "human"`, `independent_of_generation: true`, `public_key_pem`
(SPKI public PEM only), `identity_evidence_reference`,
`identity_evidence_sha256`, `enrolled_by`, and `enrolled_at` (UTC ISO timestamp).
Keep identity documents and private keys outside the repository; the reference
and checksum bind the access-controlled enrollment evidence. Do not enroll an
AI assistant or manufacture an identity record to make coverage pass.
Treat enrollment entries as immutable evidence: a new key needs a new enrollment
ID. Changing or removing a referenced enrollment makes its old records invalid.

The reviewer must read the full packet and personally complete each criterion
for each fragment as `pass`, `fail`, or `needs_followup`, with a rationale.
Copying review also requires references to comparison sources or documented
review-method evidence and its limits. A copying pass is not a legal warranty
and cannot establish that unknown historical inputs contained no third-party
material. The reviewer supplies their enrolled ID/name, `reviewer_kind: "human"`,
`independent_of_generation: true`, `personally_reviewed: true`, and `reviewed_at`.
They sign the final UTF-8 JSON bytes using their own key and signing process.
Changing whitespace after signing invalidates the signature. There is no
signing command in this tool.

Import that supplied review and its raw 64-byte Ed25519 detached signature:

```bash
node pattern-corpus/review.mjs record --packet /tmp/pattern-corpus-review/packet.json --review /path/to/completed-review.json --signature /path/to/completed-review.sig
node pattern-corpus/review.mjs status
npm run test:content
```

Records are appended as `pattern-corpus/reviews/<review-sha256>.json`; optional
`--registry FILE` and `--records DIRECTORY` support an explicit external evidence
location. A record preserves the signed review bytes, signature, packet, and
enrollment/key hashes. The status command revalidates every record against the
current corpus, criteria, and registry; it does not count duplicate submissions
twice. Invalid records produce `signed_review_coverage: "invalid"` and exit 1.

Valid signed coverage is `open` with no reviewed fragments, `partial` while
fragments are missing or any recorded criterion fails/needs follow-up, and
`complete` only when every fragment has passing coverage with no contradictory
record. A later pass never silently erases an earlier adverse review. Resolve
an adverse finding through an attributable, reviewed adjudication or a corrected
edition; this version has no adjudication or deletion shortcut.

**A valid signature proves control of the operator-enrolled key.** Enrollment
is the operator's identity/independence assertion, not independent proof that a
human authored the judgments. Accordingly, status separately reports
`human_authorship_status: "operator_attested_not_independently_proven"` once
signed evidence exists. Historical generation and public activation stay
`unverified` even with complete signed coverage. No script closes those external
requirements or turns model review into independent human certification.

This is review of reusable corpus material, not a human gate on individual
Pattern generation. The immutable historical `provenance.json` continues to
record the original unknowns and zero certifications recorded at inventory time;
new signed reviews are additional evidence and never rewrite that history.

Public activation conditions remain in
[`ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md`](./ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md)
and the [source-manual SOW](./pattern-ontology-source-manual-SOW.md): historical
generation/account terms evidence, counsel review, attributable human review
of every fragment for copying, stereotyping, protected-characteristic claims,
safety and voice, plus the applicable release and lifecycle gates. The dated
[reading assurance review](../docs/reviews/2026-09-06-reading-assurance.md)
separates these open steps from local deterministic checks.
