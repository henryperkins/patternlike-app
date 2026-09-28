# Portrait state compatibility amendment

Added September 28, 2026. `capabilities` on portrait responses and `state` on
automation responses are optional additive projections with dedicated schema
definitions. Existing v1/v2 required fields, schema identities, policy versions,
requests, claims, terminals and accepted artwork are unchanged. Historical
responses without these additions remain valid.

`supported_protocols` describes the protocols understood by this server. It does
not assert rollout, storage, runner compatibility, or permission. Generation
availability additionally requires the applicable deployment switches and
storage schema for new reservations. Existing reservations retain their original
protocol and retry policy: `retry` can remain allowed with new-generation
availability false. `allowed_actions` describes actions permitted by the current scoped
observation; the server rechecks authority when a mutation arrives.

`state.grant_status` is the authoritative permission observation. `enabled` means
an actual active grant, including its original policy. `disabled` requires a
successful read with no active grant. `unknown` means permission could not be
read; it offers no mutation and must never be presented as permission withdrawn.
The historical booleans remain protocol-specific compatibility projections:
`enabled` on v2 excludes a legacy grant, while `legacy_enabled` identifies it.
When `grant_status` is unknown, false booleans carry no permission claim.

Withdrawal depends on readable grant storage, the cancellation trigger and its
tables, current chart ownership, and the account write fence. Generation flags,
artifact storage, and the adaptive chapter migration do not authorize or prevent
withdrawal. The existing trigger cancels unfinished image/model work and retains
completed assets. Failure to store or confirm withdrawal returns an error.

The browser treats this metadata as scoped, temporary evidence and still obtains
an explicit user choice before mutation. A v1 client cannot replace an active v2
grant; protocol negotiation alone never expands consent.
