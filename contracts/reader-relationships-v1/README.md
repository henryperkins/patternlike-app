# Reader relationships v1

Additive source discovery, supported connections, exact destination reads, and retained Timing details. Existing Daily, Pattern, History, and feedback responses stay on their frozen schemas. No provider request or consent policy changes.

All operations use existing authenticated account state and ownership checks, return private responses without caching, and reject unknown or duplicate coordinates. Destination opens recompute the source-bound graph; browser-held relationship IDs confer no access. The Worker retains factual support encrypted per accepted passage, bound to the exact document revision/hash. The public response contains digest identities, never raw chart coordinates or arbitrary prose explanations.

Migration `0030_reader_relationship_supports.sql` and compatible publication code must precede rollout. Old readings remain readable; missing retained support yields no supported connection, with no backfill from current chart data. Derived support follows account key rotation and erasure and document deletion/replacement. It is classified as nonportable alongside existing reading source indexes; existing portable reading prose and frozen export shapes are preserved.

JSON Schema fixtures cover public shape. Runtime tests establish ownership, same-document hashes, exact Timing pass/date/zone, evidence agreement, graph bounds, and lifecycle behavior. These fixtures extend the existing contract command; there is no additional verification stage.
