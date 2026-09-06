# Automated personal 3D portraits

An accepted four-chapter Pattern can now start its own private visual portrait after the reader explicitly enables automatic portraits for that chart. The process generates chapter images, authors solid models from those exact images and complete chapters, checks the rendered geometry, and saves accepted results for the account explorer. There is no operator model-authoring step and reopening the explorer does not regenerate anything.

The earlier explorer preview remains useful for development, but the account integration now loads the reader's own authenticated, source-verified images and models. The complete written reading remains available during generation, failure, graphics loss, and source changes.

## Implementation

- **Consent and durable start:** a separate versioned chart preference discloses chapter/image processing by Codex. It can be saved before Pattern creation; accepted Pattern publication records start work atomically. Opting in for an existing eligible Pattern records equivalent work. A repair pass on runner claims and the existing scheduled job starts images and fills missing mesh jobs. Three-attempt budgets and leases bound automatic retries.
- **Geometry authoring:** isolated ChatGPT-authenticated Codex turns receive the complete accepted chapter and verified saved image. They return a closed numeric geometry program, never executable code. The trusted compiler produces a self-contained GLB with authoritative source metadata. Limits are 64 KiB of program, 128 declared parts, 512 expanded parts, 20,000 triangles, 750,000 GLB bytes, and four material groups per chapter.
- **Visual acceptance:** the trusted renderer creates front, rear, side, and three-quarter PNG views from the same geometry. A separate isolated Codex turn must accept recognizability, substantial depth, source correspondence, and absence of severe intersections. Invalid programs, excessive geometry, and failed visual checks do not publish a model.
- **Private persistence:** additive migration 0027 and the new `portrait-mesh-v1` contract retain existing image/graph contracts. Program, model, and accepted audit are encrypted under the existing Pattern artifact boundary. Owner, exact source, active grants, lease, and artifact hashes are checked before and after storage. Deletion inventory catches late uploads even after account erasure.
- **Account experience:** a native checkbox controls automation; saving it blocks an overlapping Pattern-generation submission. Progress counts actual saved images/models. The explorer opens saved personal assets on demand, verifies hashes and embedded source identity, preserves full prose, and releases private object URLs on source replacement or unmount. The complete download includes the full reading, four saved PNG derivatives, four GLBs, and source records; it is a data archive, not an offline viewer or the separate account data export.
- **Compatibility:** production configuration enables both Worker feature flags; both runner polling flags are enabled only after the compatible Worker serves all traffic. Every chart still requires explicit reader opt-in. Missing/disabled mesh delivery retains the legacy reader/portrait path. This initial contract supports exactly four chapters; other chapter counts show the limitation, retain their reading, and keep the automation preference reachable.

## Review corrections

Independent review and real provider probes found and corrected the following issues:

1. Consent withdrawal originally removed accepted partial images through legacy cancellation behavior. Withdrawal now stops unfinished work while retaining accepted artifacts. A fresh explicit grant resumes remaining work within the original attempt budget.
2. A stale outbox repair could cancel a newly enabled grant sharing the same entry ID. Every terminal repair update now checks the snapshotted grant ID and pending state; two injected timing regressions cover the race.
3. Worker GLB acceptance was broader than browser identity validation. Publication now requires one baked, correctly named root and disallows reused mesh instances.
4. Degenerate rounded boxes and reversing/repeated paths could create invalid geometry. The compiler rejects those cases and zero-area triangles while retaining valid cones and capped paths.
5. The pinned Codex CLI omits some disabled tools from its typed merged configuration. Isolation verification now checks their exact effective session-layer overrides rather than assuming absent merged fields mean enabled tools.
6. Personal account explorer copy still said “fictional” in two places. Personal bundles now display private portrait copy, covered by a regression.
7. A successful TypeScript build was not a runnable standalone runner: the shared workspace package exported TypeScript sources. The release build now bundles workspace code and supplies a production manifest for external runtime dependencies; an isolated plain-Node artifact check guards this boundary.

8. A real 390px browser test found that the disabled camera toolbar covered the graphics-retry button. The fallback now uses content-driven layout, including expanded scenes, so wrapped copy and controls cannot occupy the same fixed overlay space. Ordinary pointer retries pass at all three tested widths, both within the account and in the expanded scene.

The suspected late-write leak after full account deletion was disproved by the existing durable deletion tombstone. A new regression demonstrates that its retained inventory removes the late model bytes.

## Real provider evidence

All provider probes used fictional text/images, the pinned Codex CLI 0.153.3, `gpt-5.6-sol`, and `xhigh` reasoning. No authored program or model was manually edited. Accepted programs are recompiled unchanged against the final compiler and their GLB hashes compared with the original receipts.

| Object | Result | Triangles | GLB bytes |
| --- | --- | ---: | ---: |
| Compass | Authored, compiled, independently accepted | 10,188 | 206,084 |
| Rocking bench | Authored, compiled, independently accepted | 7,676 | 170,688 |
| Nautical lantern | New native image and mesh, independently accepted | 12,752 | 257,716 |
| Spyglass | Authored, compiled, independently accepted | 16,608 | 316,436 |

The lantern was generated specifically for this probe and was not one of the explorer's four pre-authored objects. Its image generation, model program, actual GLB, four inspection views, and audit receipts demonstrate the unfamiliar-object route.

Rejected evidence is also retained. One rope program exceeded the triangle budget. A later rope program compiled but produced thin strands, oversized masses, and a floating part; the independent visual check rejected it. An earlier compass program failed schema validation, and an early bench attempt exposed the configuration-verification defect corrected above. These small development probes establish execution and rejection behavior; they do not establish a production success rate or guarantee that every object completes within three attempts.

Sanitized evidence is under [artifacts/2026-09-06-portrait-automation](./artifacts/2026-09-06-portrait-automation/). Provider receipts and generated geometry are real. Browser account fixtures use intercepted API responses and do not represent a live signed-in production account.

## Verification and release status

The actual `PatternExperience` and generated GLBs passed 146 browser checks: 50 at 1440px and 48 each at 390px and 320px. All widths had zero console errors or warnings. Checks cover explicit opt-in, durable progress, four private image/model requests, real WebGL rendering, chapter/facet/comparison/guide interaction, keyboard and dialog focus, normal and expanded graphics-loss recovery, complete prose, downloaded byte equality, asset reuse, and all nine object-URL revocations. See the [browser evidence](./artifacts/2026-09-06-portrait-automation/browser/README.md). These are intercepted fictional account responses, not a live account generation claim.

The standalone release artifact passed 117 runner tests on Node 22.23.2 and its runtime regression on production Node 24.19.0. A fresh installation outside the workspace imported both entry points, exercised Sharp and Three, and compiled a real model through a local fake provider. A separate content-free real provider turn under the actual service account passed all isolation checks and returned `{ "ok": true }` using the candidate CLI 0.153.3. The legacy text path separately passed a content-free real `runCodexInvocation` turn under the same service account and candidate CLI, preserving Sol/xhigh, priority and fast settings. A third service-account probe generated a real fictional lantern image through the unchanged native-image helper: one authoritative completed image event, verified source/bytes, and successful managed-image and temporary-directory cleanup. This proves actual image capability under the service login. The live runner had not been replaced at the time of those probes.

The production preflight found Worker version 296 at 100% traffic, no portrait feature flags, and migrations through 0025. A private production backup restored successfully; applying unchanged 0026 and 0027 locally preserved all 57 existing table counts and produced clean foreign-key and integrity checks. The backup and restored data remain outside the repository; only sanitized hashes and results are recorded.

The first completed clean aggregate run passed 13 lanes and failed one API regression because it compared D1 timing metadata (1 ms versus 0 ms) along with unchanged stored rows. The assertion now checks successful queries and exact retained rows; the fresh final clean aggregate gate passed all 14 lanes with exit code 0 after that correction. All 1,183 frozen source/configuration/test files remained unchanged throughout the passing run. Main API tests passed 2,305/2,305, web tests 556/556, and runner tests 117/117. The local Python was 3.14.4 versus CI's pinned 3.12. Vitest/workerd printed teardown diagnostics but all suites and the aggregate command exited successfully. See [the exact gate summary](./artifacts/2026-09-06-portrait-automation/ci-local-summary.txt) and [verification receipt](./artifacts/2026-09-06-portrait-automation/verification.json). This is the verification record before release. Live migrations, runner replacement, Worker deployment, and polling activation follow this gate and are recorded separately in private operator receipts. The fictional browser/provider checks do not establish completion of a live reader's private portrait.
