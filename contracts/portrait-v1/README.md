# Personalized portrait contract v1

These additive endpoints bind four generated object images and a saved constellation to the authenticated current chart and published Pattern revision. Each native Codex image request receives only its own full chapter. The image-model name identifies the configured native-tool pin; native completion records do not independently attest the model identifier.

`ready` requires all four immutable references and a validated `constellation-v1` graph. The API also verifies same-owner current-revision association, complete RGBA lengths, slot identity, artifact hashes, claim ownership and publication state. The renderer validates graph connectivity and source attribution before allocating buffers. JSON Schema covers the bounded wire shapes; these cross-field and causal checks remain runtime invariants with focused tests.

Image and download routes require the active account session and return private, noncached data. The separate portrait download includes all four saved PNG images and their graph; it supplements the existing account export without altering its frozen format. R2 storage keys and authentication material never appear in this contract.

The machine claim/completion/failure definitions describe the outbound runner's dedicated portrait transport. Existing text-generation claims retain their existing protocol. No API key or provider fallback is accepted by this portrait workflow.

This milestone admits an accepted Pattern only when it contains exactly four full core chapters. Three-, five-, and six-chapter Patterns keep their existing reader; no chapter is truncated or invented to fit the portrait.

Creation is opt-in behind `PATTERN_PORTRAIT_ENABLED=1`; runner image polling separately requires `CODEX_RUNNER_PORTRAITS=1`. Creation requires an 8–128 character `Idempotency-Key`, while uniqueness of the accepted Pattern enforces one resumable four-slot budget across keys. Claims expire after twenty minutes and each native image turn has a fifteen-minute timeout, with at most three attempts per slot.

The completion and download fixtures exercise JSON wire structure. Their small placeholder base64 values deliberately do not assert valid image decoding: real PNG structure, exact 128×128 RGBA byte count, and original-to-derivative sampling are checked by runner/API tests and the native generation canary.
