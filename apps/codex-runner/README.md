# Codex runner

The existing text queue remains the default. Set `CODEX_RUNNER_PORTRAITS=1` to poll the separate portrait queue whenever the text queue is empty. The runner still executes one claim at a time. Portrait generation must also be enabled separately on the API after its migration and compatible release.

Portrait invocations require Codex CLI **0.153.3** and an existing ChatGPT login. The runner checks the CLI version and the explicit `Logged in using ChatGPT` status before launching an ephemeral app-server thread. A different CLI version fails closed until its native-tool and event contracts are reviewed. The claim selects the orchestration model and `xhigh` reasoning; current backend claims use `gpt-5.6-sol`.

Each child receives the existing environment allowlist, excluding OpenAI API keys, the runner bearer, application credentials, and API endpoint overrides. The app-server forces the OpenAI provider and ChatGPT login, uses a read-only shell sandbox, disables shell execution, apps, plugins, hooks, browser/computer use, delegation and memory, and receives only one chapter prompt through stdin. It uses the supported local app-server protocol; there are no direct ChatGPT HTTP calls or alternate image providers.

This CLI's app-server does not expose `codex exec`'s `--ignore-user-config` or `--ignore-rules` switches. The portrait host must therefore have absent or empty `$CODEX_HOME/AGENTS.md` and `AGENTS.override.md`; nonempty files or symlinks stop the runner before Codex starts. The runner never edits these files or copies authentication. It suppresses project instructions, legacy notification commands, developer instructions, and skill discovery through explicit settings. Supported `config/read` and `configRequirements/read` checks run before any chapter is sent; incompatible managed instructions or hooks stop the job. Each inherited MCP server receives an explicit `enabled=false` override, because an empty TOML table does not clear inherited entries. The thread's `mcpServerStatus/list` must then report only disabled servers with no tools. This is a checked host configuration requirement, not a claim that app-server supports a completely isolated config loader.

A result requires exactly one authoritative `item/completed` image-generation item and a successful `turn/completed` for the same thread/turn. Assistant-authored paths cannot establish image success. Native base64 is bounded and decoded; when `savedPath` is present, its managed path and actual bytes must match. Generated content and full native events are never written to the runner log. The final model metadata supplies only the visible-object label and rationale; it does not supply geometry or artifact authority.

`image_model: "gpt-image-2"` records the reviewed native-tool configuration pin. The installed app-server does not expose an independent per-image model attestation or the underlying ImageGen HTTP request ID. `provider_request_id` therefore stores `threadId:turnId`, and `image_request_id` stores the native image tool-call ID. These identifiers must not be described as HTTP request IDs.

The runner decodes one native PNG (at most 32 MiB and 40 million pixels), strips ancillary metadata, creates a PNG up to 512 pixels per side (at most 2 MiB), and makes exactly 128×128 RGBA samples from that saved derivative. Nonsquare images receive transparent letterboxing when sampled. Original and source hashes use raw lowercase SHA-256 hex. The machine completion body is bounded to 3 MiB.

Native Codex image storage is separate from its shell sandbox: even an ephemeral read-only thread can create `$CODEX_HOME/generated_images/<thread-id>/<call-id>.png`. After the child exits, the runner removes only that invocation's validated managed directory and its private temporary directory. Cleanup failure stops polling; a redirected directory is never followed or deleted. Ephemeral execution alone does not perform this cleanup. An explicit `onVerifiedImage` callback exists for authorized local inspection; the production poller does not retain originals.

`codex exec --json` omits native image-generation events in this CLI version. Portrait jobs use `codex app-server --stdio` instead. The parser accepts the installed `imageGeneration` item shape; future image-event changes require review rather than accepting assistant text as a substitute. Missing images, multiple results, failed turns, malformed bytes, unsafe managed paths, timeouts and failed authentication fail closed.

Run `npm test -w @patternlike/codex-runner` and `npm run typecheck -w @patternlike/codex-runner` after changes. The deterministic process fixtures cover the protocol and image processing without generating paid images. Real provider smoke tests are separate and require authorized, non-personal chapter inputs.

Four fictional chapter smoke invocations succeeded on 2026-09-05 using CLI 0.153.3, ChatGPT auth, and `gpt-5.6-sol`/`xhigh`. After the host configuration checks were finished, a content-free preflight confirmed both inherited MCP servers were disabled with zero tools. One final native invocation then passed the complete finished runner, including its strict tool-item filter, generated a new compass image, verified its decoded PNG and samples, and cleaned its task files. That compatibility image is excluded from the four-image preview set; the original four images remained unchanged. The sanitized final receipt is `docs/superpowers/artifacts/pattern-portrait/native-final-provider-probe.json`.


## Standalone release artifact

Build on Node 22, as pinned by the repository's `.nvmrc`:

```bash
npm ci
npm run build -w @patternlike/codex-runner
```

The build typechecks first, removes stale generated output, and bundles two Node ESM entry points: `dist/index.js` and `dist/portrait-mesh-canary.js`. Workspace shared code is included in those bundles. The generated `dist/package.json` declares only the pinned public production dependencies, Sharp and Three; it does not require a private workspace package or TypeScript loader.

Copy the **contents of `dist/`**, including its generated package manifest, into a fresh release directory. Install dependencies on the target host so Sharp receives the correct native packages. For example, from the release checkout on the approved host:

```bash
runner_release=/opt/patternlike-codex-runner/releases/VERIFIED_COMMIT
install -d "$runner_release/dist"
cp -R apps/codex-runner/dist/. "$runner_release/dist/"
npm install --prefix "$runner_release/dist" --omit=dev
```

Do not omit optional dependencies: Sharp needs its platform packages. Do not replace the generated manifest with `apps/codex-runner/package.json`; that source manifest includes development and workspace dependencies. Do not copy a developer machine's `node_modules` across operating systems or architectures. The repository's systemd unit uses `/opt/patternlike-codex-runner/dist/index.js`; while the service is stopped, publish a real directory copy of the verified release at that stable `dist` path and retain the previous directory for rollback. Do not use a directory symlink: the current direct-entry guard compares the module URL with the invoked filename. See the [production installation procedure](../../docs/deploy/codex-production-provider.md#6-install-the-runner).

`npm test -w @patternlike/codex-runner` includes an offline deployment-artifact regression. It stages the bundles and installed production dependencies outside the repository, imports both entry points, checks their direct-execution guards, exercises native PNG processing and Three addons, and runs the bundled canary against a deterministic local fake Codex process. It compiles a real GLB and renders all four inspection views without contacting a provider.

## Automated 3D portraits

Set `CODEX_RUNNER_MESHES=1` together with `CODEX_RUNNER_PORTRAITS=1` after the compatible API has migration 0027. Dispatch priority remains text, image, then mesh, with one invocation at a time. An empty mesh claim also drains the durable portrait-start outbox and repairs missing mesh jobs. The scheduled API maintenance performs the same recovery, so work is not tied to an open browser.

Automatic generation is authorized by a separate, explicit chart-scoped portrait preference. Pattern publication records pending start work atomically, and opting in after publication records equivalent work for the existing Pattern. No account is opted in by migration or feature enablement. The existing written-Pattern consent is unchanged. New image and model work additionally requires the applicable live Pattern and account-processing grants.

A mesh invocation receives a complete accepted chapter and its verified saved PNG. A fresh Codex thread returns a constrained `portrait-mesh-program/v1` JSON object; the trusted compiler builds the solid GLB. Another fresh thread receives the original reference plus front, rear, side, and three-quarter images rendered from that geometry and must accept the visual check. Author and reviewer do not share a conversation. Their identifiers are Codex thread/turn identities, not upstream HTTP request IDs.

The model never supplies executable code. Geometry is restricted to bounded boxes, ellipsoids, cylinders, tori, closed revolved profiles, extrusions, paths, braids, and repetitions. Programs are limited to 64 KiB, 128 parts and 512 expanded parts; compiled chapters are limited to 20,000 triangles, 750,000 GLB bytes and four material groups. Source text/image hashes, program hash, compiler version and chapter/revision identity bind the saved model. The private API and browser check the saved bytes before rendering.

Malformed output, invalid geometry and rejected visual checks fail the attempt. The API provides at most three mesh attempts with expiring leases and bounded backoff. Completed images/models are retained independently. Turning the portrait preference off cancels unfinished/future work; source or account erasure also schedules saved artifacts for durable deletion. A failed model does not erase the reading or change the legacy graph-ready contract.

The account polls visible in-progress work and opens saved models through the personal explorer. The complete portrait JSON download includes all accepted reading prose, uncertainty and additional signatures, the four saved 512-pixel PNG derivatives, four GLBs and their program/audit records. It is a data archive, not a standalone offline viewer. Full-resolution native image originals are not retained in the account archive.

### Fictional provider canary

Use the pinned CLI and the existing ChatGPT login; never pass account content to a local diagnostic. The output directory must be new:

```bash
node apps/codex-runner/dist/portrait-mesh-canary.js \
  --fictional --image /absolute/fictional-reference.png \
  --source /absolute/complete-fictional-chapter.txt \
  --out /absolute/new-canary-directory \
  --codex-bin /absolute/pinned-codex-0.153.3
```

The command captures untouched authored JSON, compiled GLB, four rendered views, the independent visual check and a sanitized receipt. Failure exits nonzero and retains available fictional evidence. Production polling does not install those inspection hooks or retain temporary source-bearing output. A passing canary establishes that particular model and check, not a guarantee that every automatically generated model will pass.

### Enablement order

1. Complete the final local gate and verify the standalone release artifact.
2. Apply additive migrations 0026 and 0027 to the target database, following the backup/integrity procedure.
3. Install this runner and pinned CLI with both runner polling flags set to `0`; verify the existing ChatGPT login and isolated host preflight before restarting it.
4. Release the compatible API and frontend. This production configuration sets `PATTERN_PORTRAIT_ENABLED=1` and `PATTERN_PORTRAIT_MESH_ENABLED=1`, so the migrations must precede its first traffic. Verify the expected version receives 100% of traffic. Migration and feature flags do not grant reader consent.
5. Set runner `CODEX_RUNNER_PORTRAITS=1` and `CODEX_RUNNER_MESHES=1` and verify healthy text and portrait polling against the compatible API.
6. Opt in a dedicated authorized canary account and verify publication → image jobs → mesh jobs → saved account explorer without manually enqueueing jobs.

Keep exact Worker version/traffic, runner revision, migration ledger and canary identities in the release record. Disabling feature flags pauses generation/delivery; it does not erase stored artifacts. Scheduled cleanup must remain running. A pushed commit alone does not prove that the runner, migrations, flags or live generation are active.

### Adaptive artwork v2

This runner advertises `X-Patternlike-Portrait-Protocol: v2` and accepts either
v1 claims from an older Worker or count-bound v2 claims. V2 covers each chapter
of a three-to-six-chapter Pattern, with the same per-job limits and four-view
mesh audit. Completion and failure receipts bind the claim's protocol, chapter,
count and document revision. Mesh authoring uses the distinct v2 program,
compiler and artifact identity; saved v1 artifacts retain their original format.

Follow the [adaptive rollout](../../docs/deploy/adaptive-portrait-artwork.md).
Migration 0033 and compatible Worker/runner/client support must precede adaptive
producer enablement. `PATTERN_ADAPTIVE_PORTRAITS_ENABLED` remains `0` in the
committed Worker configuration. Policy 2.0.0 requires an explicit reader action;
neither installation nor protocol capability grants generation permission.
