# Pattern writer recovery, prompt 1.0.5

The writer now receives explicit claim-grounding and per-unit citation guidance.
Corrections retain prior sanitized findings for the same frozen plan, so a later
rewrite can avoid reintroducing earlier failures. Historical section keys locate
prior drafts; they do not assert that reorganized current sections fail.

History is read from the exact writing stage and attempt, including the existing
bounded fallback after a provider/shape retry. Each newly retained correction is
cumulative. Prior plan hashes and attempt order must match; items are reprojected
and deduplicated. Rejected prose and verifier rationales are never forwarded.
The existing serialized packet byte cap still refuses oversized requests.

Only new generations use writer prompt 1.0.5. Historical writer 1.0.1–1.0.3 and
offline 1.0.4 instruction bytes remain unchanged. The source fingerprint changes
with the new implementation. No in-flight frozen plan or response is edited.

Unchanged: validation policy 1.0.0, candidate/semantic/publication checks, frozen
M7 output schemas, model pins, privacy controls, and three-writer-attempt ceiling.
No D1 migration is required. The accepted Pattern is retained until the normal
guarded publication transaction accepts its replacement.

Release verification: packet/history and execution-protocol regressions, prompt
compatibility, publisher configuration, publication safety, and `npm run ci:local`.
Production success additionally requires the fresh generation and generic job to
be succeeded, its replacement document current, pending regeneration cleared,
and the authenticated reader displaying the new Pattern. Tests alone do not prove
that a generated replacement has been accepted.
