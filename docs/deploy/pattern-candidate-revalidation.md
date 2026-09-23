# Retained final Pattern candidate revalidation

Use this read-only diagnostic to explain a terminal `candidate_invalid` result
without returning private candidate prose. It does not unstick, retry, regenerate,
publish or change a generation, and preserves the accepted Pattern. The only
writes are the existing administrator session/access audit records.

## Request

Authenticate through the deployment's existing Cloudflare Access application for
`/admin/*` as a `pattern_generation_auditor`. Start at the protected URL so Access
preserves the application audience and return URL; complete its configured
identity-provider login. Do not substitute reader, runner or service credentials,
disable Access, or use an administrator session cookie alone. API requests require
the valid `Cf-Access-Jwt-Assertion` supplied by that existing boundary. Never paste
assertions or cookies into incident notes.

Issue one GET, with no body, to the API origin:

```text
/admin/pattern-generations/pgen_11111111111111111111111111111111/candidate-revalidation?purpose=incident_response
```

The identifier above is synthetic; replace it with the exact failed generation
ID. Supply exactly one existing purpose: `quality_review`, `safety_investigation`,
`incident_response`, or `retention_audit`. All `/admin/*` responses are
`Cache-Control: no-store`, set on the admin mount.

`apps/api/scripts/runtime-health.ts` offers `aggregate` and
`pattern <generation_id> <purpose>` only. The `pattern` subcommand calls
diagnostics; it does not wrap candidate revalidation. Call this GET directly
through the existing Access boundary.

## Eligibility and interpretation

The route records the scoped access decision durably before opening any key or
artifact. The audit row records the intended classes (`generation_command`,
`fact_packet`, `validated_plan`, `writer_request`, `writer_response`) even if
the generation is subsequently refused as `generation_not_revalidatable`.
An audit grant means access was authorized, not that replay succeeded.
The generation must be terminal failed with `candidate_invalid` and have a
completed writer job at `(stage_generation - 1, writer_attempts)`, using the
failed `pattern_generation_jobs` row's values. A nearby timestamp, an earlier
correction document, or a different attempt is not a substitute. Multiple
provider rows at that coordinate are `integrity_conflict`.

Required inputs and keys must still be retained. Replay checks ownership,
coordinates, frozen command, plan, fact packet, ontology and request/response
integrity, then uses the existing deterministic candidate validator pinned to
policy `1.0.0`. No M7 schema IDs, validation bounds or policy are changed.

A `200` response uses `schema_version: pattern-candidate-revalidation/v1` and
identifies the exact generation, provider job and writer coordinate. The seven
hashes identify the provider response/request, retained writer request, validated
plan, fact packet, frozen plan and ontology bundle. Provider hashes refer to the
verified retained bytes; they are not hashes of the diagnostic response.

`ok: false` reports the replay's closed failure codes. Paths use fixed field names
and zero-based numeric indexes; `/plan/...` points into the frozen plan, other
paths into the candidate. An empty path means the root or no unambiguous location,
not a missing failure. `actual_count` appears only where a safe count is available.
There are no prose messages, source keys, aliases or storage locations.
`schema_invalid` means the retained response cannot be replayed as a supported
writer shape. `ok: true` means only that this deterministic replay passed; it does
not overturn the recorded failure, approve semantics or authorize publication.

## Fail-closed outcomes

| Status | Meaning and next step |
| --- | --- |
| 400 | Correct the malformed ID or missing, repeated or unsupported purpose. |
| 401 | Complete the existing Access auditor login; do not weaken the boundary. |
| 404 | The exact generation was not found; verify the ID. |
| 409 | `generation_not_revalidatable`, `integrity_conflict` or `unsupported_validation_policy`. Stop and investigate metadata/policy; do not choose another attempt as evidence. |
| 410 | `artifact_unavailable`. Retention, erasure or missing keys/material prevents exact replay; do not reconstruct or regenerate as a substitute. |
| 503 | Authentication, audit or replay unavailable (`admin_auth_not_configured`, `revalidation_audit_unavailable`, `revalidation_unavailable`). Restore that existing dependency before a deliberate retry. |

Keep incident evidence limited to authorized response fields and generic error
codes. This endpoint provides no semantic-verifier result and no recovery action.
