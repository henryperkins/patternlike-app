# Portrait mesh protocol v1

This additive contract leaves all existing portrait v1 endpoints unchanged. Machine requests use the existing dedicated runner bearer authority, with no consumer-auth fallback. Routes are `POST /codex-provider/v1/portrait-meshes/claim`, `/:jobId/complete`, and `/:jobId/fail`. Empty claim requests receive a claim or HTTP 204. Terminal acknowledgments are `{ "schema_version": "codex-portrait-mesh-terminal/v1", "status": "accepted" }`.

Claims contain only one accepted chapter, its complete exact source JSON, and its bounded verified image. Transport is capped at 3 MiB; images at 2 MiB; programs at 64 KiB; GLB at 750000 bytes. Runtime validation additionally enforces chapter index/ID correspondence, exact source identity, canonical JSON program SHA-256, GLB SHA-256 and compiler identity. All SHA-256 values are lowercase unprefixed hexadecimal. The closed program vocabulary has structural and aggregate runtime constraints beyond JSON Schema. No generated code executes.

Consumer routes are `GET/PUT /v1/pattern-portrait/automation`, `GET /v1/pattern-portrait/explorer`, `GET /v1/pattern-portrait/models/:referenceId`, and `GET /v1/pattern-portrait/explorer/download?chart_id=...&pattern_id=...&generated_at=...`. The shared TypeScript module defines exact response and complete-download shapes. Models are opaque `ppmodel_` IDs served with authenticated current-owner/revision checks and private no-store headers.

Automation policy 1.1.0 is a separate explicit active-chart grant. It covers future accepted Patterns for that chart until withdrawal; it does not infer or replace account-processing or written-Pattern consent. Withdrawal stops unfinished/future work while accepted artifacts retain existing source/account erasure semantics. The complete download includes the accepted reading (including uncertainty and additional signatures), all source images, all models, the viewing metadata, declarative programs, visual audit receipts and provider request identities.

Source images and the explorer's saved chapters include the optional versioned
`image_model_provenance` projection defined by the portrait contract. New image
receipts state that observed image-model identity was not exposed; legacy images
remain `legacy_unrecorded`. No current model or CLI version is substituted into
historical receipts. The complete download preserves these fields directly from
the authenticated image download; no browser reconstruction supplies provenance.

A new explicit grant after withdrawal resumes only unfinished work within its original three-attempt budget. Repeating an already enabled grant is idempotent. Accepted images/models are retained; accepted source/account erasure still removes them. While any automatic chapter work remains, explorer status is `generating`; once all work settles, any terminal chapter failure produces `failed`.
