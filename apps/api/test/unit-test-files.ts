/**
 * Test files that run in the plain Node Vitest project
 * (`vitest.unit.config.ts`) instead of the Cloudflare Workers pool.
 *
 * A file belongs here only if neither it nor anything it imports needs
 * workerd: no `cloudflare:test`, no `SELF`/`env` bindings, no outbound-fetch
 * mock. These files used to pay the full per-file Workers pool cost (D1
 * migration setup, workerd startup) for tests that never touch a binding;
 * in Node they run in parallel in seconds.
 *
 * The two publisher suites are deliberately NOT listed: their hermetic
 * outbound-service seam only exists inside the Workers pool
 * (`test/mock-calc-service.ts`), so they stay in `vitest.config.ts`.
 *
 * New pure tests should be added here. If a file is listed here but starts
 * using a binding, its Node run fails loudly and it must move back.
 */
export const UNIT_TEST_FILES: string[] = [
  "src/routes/birth.test.ts",
  "src/config.test.ts",
  "src/middleware/config-guard.test.ts",
  "src/middleware/crypto-operator-auth.test.ts",
  "src/aead.test.ts",
  "src/services/reading-schedule.test.ts",
  "src/services/birth-command.test.ts",
  "src/services/reader-relationship-support.test.ts",
  "src/services/openai-responses-envelope.test.ts",
  "src/services/reading-evaluation.test.ts",
  "src/services/pattern-prompt-offline.test.ts",
  "src/services/pattern-publication-proof.test.ts",
  "src/services/pattern-prompt.test.ts",
  "src/services/timezone.test.ts",
  "src/services/local-day.test.ts",
  "src/services/tzdb.test.ts",
  "src/services/admin-access.test.ts",
  "src/services/release-attestation.test.ts",
  "src/services/content-release.test.ts",
  "src/services/ontology-prompt.test.ts",
  "src/services/reading-rollout.test.ts",
  "src/services/location-uncertainty.test.ts",
  "src/services/openai-responses-adapter.test.ts",
  "src/services/safe-log.test.ts",
  "src/services/root-kek-keyring.test.ts",
  "src/services/reading-feedback-compiler.test.ts",
  "src/services/ontology-candidate-validation.test.ts",
  "src/services/reading-product-projection.test.ts",
  "src/services/daily-sky-client.test.ts",
  "src/services/identity.test.ts",
  "src/services/portrait-mesh-glb.test.ts",
  "src/services/reading-publisher.test.ts",
  "src/services/ontology-evaluation.test.ts",
  "src/services/generation-failures.test.ts",
  "src/services/reader-relationship-resolver.test.ts",
  "src/services/pattern-packet.test.ts",
  "src/services/release-bundle.test.ts",
  "src/services/codex-publisher.test.ts",
  "src/services/codex-provider-contract.test.ts",
  "src/services/birth-operational-config.test.ts",
  "src/services/reading-feedback-policy.test.ts",
  "src/services/calc-client.test.ts",
  "src/services/pattern-publisher.test.ts",
  "src/services/geocoder/geoapify.test.ts",
  "src/services/natal-features.test.ts",
  "src/services/ontology-regression.test.ts",
  "src/services/reading-prompt.test.ts",
  "src/services/pattern-publication-safety.test.ts",
  "src/services/reading-history-cursor.test.ts",
  "src/services/time-travel-config.test.ts",
  "src/services/ontology-packet.test.ts",
  "src/crypto.test.ts",
];
