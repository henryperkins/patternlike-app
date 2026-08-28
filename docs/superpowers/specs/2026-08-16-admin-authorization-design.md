# Administrator Authorization Boundary (M7 Slice C, §31.9 / §24)

**Date:** 2026-08-16

**Status:** Approved. Cloudflare Access selected by the operator on 2026-08-28.

**Scope:** Replace the shared `PATTERN_ADMIN_TOKEN` with a
role-separated administrator session, and implement the three admin
documents the 2026-08-16 amendment specified. Ontology activation and
recall stay service-token internal routes.

Companion:
[`2026-08-16-m7-spec-artifact-amendments.md`](2026-08-16-m7-spec-artifact-amendments.md)
decision 10, and the in-place §24 amendments in the 2026-08-14 design.

## Decision summary

- Slice C is not “add OIDC in front of the existing routes.” The
  metadata-versus-open-content split, the `purpose` query parameter, and
  the session do not exist as implementable contracts until this design
  and the additive schemas that landed with the amendment.
- The shipped `purpose_class` list is authoritative:
  `quality_review`, `safety_investigation`, `incident_response`,
  `retention_audit`. Do not implement the six-value §24.4 draft list.
- `adminSession` (`pl_admin_session`, `HttpOnly` / `Secure` /
  `SameSite=Strict`, `Path=/admin`) is the specified scheme. The OpenAPI
  `adminToken` bearer is transitional and is deleted with the token.
- Adding the identity flow is not enough. The in-route
  `PATTERN_ADMIN_TOKEN` comparison is removed, the deployed secret is
  revoked, and a rejection test proves the old bearer cannot authorize
  a request. Fail closed when the identity flow is unavailable.
- `/admin/*` on the same Worker is an acceptable path. §24.2 permits
  “a separate protected hostname **or path**.”

## Operator identity decision

§24.1 sanctions two ways to assign `pattern_generation_auditor`:

1. **Cloudflare Access** in front of `/admin/*`, with the Access JWT
   identity becoming `admin_subject` and the Access policy encoding the
   role.
2. **A separate administrator OIDC tenant**, with an authorization-code
   + PKCE redirect that is not the consumer Auth0 application, minting
   `pl_admin_session` the way `pl_session` is minted for readers.

The operator declined Access **for the AI Gateway**. That is a different
application and does not decide this one. If Access is off the table
account-wide, this slice is the OIDC route and is materially larger
(callback, session table, CSRF on any future mutation, a second set of
`OIDC_*` bindings that must not silently reuse the consumer issuer).

**Decision answered 2026-08-28:** use Cloudflare Access. The Worker validates
`Cf-Access-Jwt-Assertion` against the team certs endpoint and the dedicated
application AUD on every request, then binds the verified subject to a
short-lived opaque `pl_admin_session` stored by digest in D1.

## Goal

An auditor with the role can list generation metadata and, in a second
audited action, open an exact artifact. A consumer session, a service
token, a repository collaborator, and a bearer `PATTERN_ADMIN_TOKEN`
cannot.

Success means:

1. every admin route requires `purpose` from the shipped list and writes
   an access-intent row before decrypting;
2. metadata and inventory routes do not return artifact ciphertext or
   reader prose;
3. the decrypt route returns `pattern-admin-artifact` and `410` after
   the 30-day exact-artifact window;
4. `admin_subject` is the authenticated administrator identity, not the
   literal `"admin"`;
5. `GET /admin/pattern-ontology-releases/{version}` returns metadata
   (version, hashes, provenance origin, evaluation booleans, record
   count) and not record bodies;
6. acceptance criterion 18 is evidenced by role separation, not by a
   shared secret.

## Current state

`routes/admin-pattern.ts` implements metadata and inventory behind a
shared bearer token, hardcodes `purpose_class` to `'quality_review'`,
and sets `admin_subject` to `"admin"`. Inventory is absent from
OpenAPI. Decrypt and the admin ontology-release route do not exist.
The metadata response is a thin wrapper around job columns and was
pointed at the consumer status schema.

The 2026-08-16 contract amendment specifies the three documents and
the five previously missing OpenAPI paths. Implement against those
documents. Do not keep returning `patternGenerationStatus` from an
admin URL.

## Identity — shared rules

Regardless of Access versus OIDC:

- no bearer token is returned to browser JavaScript;
- no cross-origin access from the consumer application;
- `pl_admin_session` is not `pl_session` and is not valid on `/v1/*`;
- `pl_session` is not valid on `/admin/*`;
- role and audience are checked on every request;
- sessions are short-lived and server-side;
- `configGuard` fails closed if the admin identity bindings look
  development-shaped outside development, the same way consumer OIDC
  already does.

Access-shaped bindings, if chosen: Access team/domain, policy AUD,
and JWT validation against the Access certs endpoint.

OIDC-shaped bindings, if chosen: a second `ADMIN_OIDC_ISSUER` /
`ADMIN_OIDC_AUDIENCE` / `ADMIN_OIDC_JWKS_URL` triple that must not
equal the consumer triple. Reusing `OIDC_ISSUER` would let a consumer
identity inherit the auditor role.

## Routes

All require `purpose` as a query parameter from the shipped enum.

| Method | Path | Document | Opens content |
|---|---|---|---|
| GET | `/admin/pattern-generations/{generation_id}` | `pattern-admin-generation` | No |
| GET | `/admin/pattern-generations/{generation_id}/artifacts` | `pattern-admin-artifact-inventory` | No |
| GET | `/admin/pattern-generations/{generation_id}/artifacts/{artifact_id}` | `pattern-admin-artifact` | Yes |
| GET | `/admin/pattern-ontology-releases/{version}` | `pattern-admin-ontology-release` | No |

`run_worker_first` already lists `/admin/*`.

## Token removal

In the same change that accepts the first valid admin session:

1. delete `requireAdmin`’s `Authorization: Bearer` comparison;
2. fail closed with `503 admin_auth_not_configured` when the chosen
   identity flow is unconfigured outside development;
3. revoke the deployed `PATTERN_ADMIN_TOKEN` secret;
4. add a test that a request carrying the old bearer, and no cookie,
   is `401`;
5. remove `adminToken` from the current M8 OpenAPI security schemes. M7 is a
   byte-frozen historical contract and retains its deprecated declaration.

A deployment that lands identity and leaves the token is a failed
Slice C, even if the happy path uses the cookie.

## Out of scope

- Ontology ingest and recall buttons in the admin UI.
- Bulk export, “download all,” or clipboard instrumentation.
- Adding `legal_privacy_request` to `purpose_class`.
- Changing `PATTERN_AI_ROLLOUT`.
