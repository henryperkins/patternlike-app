# Daily uncertainty successor, 2026-09-28

This package versions the Daily provider request and encrypted V2 command at
`schema_version: 0.5.1`. The original M0, M3, and M5 schemas and fixtures remain
unchanged. Published `daily-reading-v5`, candidate output, and reading evidence
still use the M5 `0.5.0` wire format.

The command's normalized uncertainty accepts exactly the pairs emitted by the
calculation service: `moon/low_confidence_moon`, `houses/approximate_only`,
`birthplace/technique_specific`, and `birth_instant/technique_specific`. This
successor avoids widening the frozen M3 assembly identity. Unknown features,
qualification pairs, and suppression reasons fail before provider work.

The provider request requires `uncertainty_disclosure`, a typed plan with
`policy_version: 1.0.0`. The engine derives it once from the stored report,
includes it in the input identity and manifest, and uses the same plan for
candidate validation. Every planned statement must appear exactly once. A
generic disclaimer cannot replace a reason. Omitted, invented, or duplicate
disclosures fail validation. Suppressed facts remain ineligible.

No unreviewed `user_facing_summary`, birth instant, coordinates, place label,
timezone name, or raw location qualifier code is added to the provider packet.
The closed values `birth_time`, `birth_instant`, and `birthplace` name categories;
they carry no personal values. Privacy validation checks object keys instead
of mistaking these enum values for leaked fields.

The stored `birth_instant/technique_specific` pair merges historical-zone,
zone-boundary, ambiguous-local-time, and nonexistent-local-time conditions.
It supports a disclosure that the local birth time's time-zone mapping needs
confirmation. It cannot support a claim about which particular condition
occurred. Exact birth time remains exact, including in this qualified state.

Policy pins advance together:

| Mode | Prompt | Selection | Candidate validation |
| --- | --- | --- | --- |
| Ordinary Daily | `1.1.0` | `1.5.0` | `1.2.0` |
| Categorical feedback | `1.1.1` | `1.6.0` | `1.2.0` |

Old commands fail `policy_unsupported`; their identity and stored publication
evidence are never reinterpreted. Existing scheduler replacement limits still
apply. An exhausted historical generation is not reset or recovered by this
change. Source configuration updates the ordinary prompt pin only; this package
does not change rollout flags, grants, deployed configuration, or production data.

Schemas reuse unchanged M0/M3/M5 subschemas. Fixtures cover unqualified exact,
qualified exact, approximate, and unknown inputs, plus missing plans, unsupported
reason pairs, invented statements, private fields, and old request versions.
Engine and API tests additionally enforce completeness, actual stored reasons,
suppression, command replay, and publication behavior.
