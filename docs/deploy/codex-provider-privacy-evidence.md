# Codex provider privacy evidence — 2026-09-06

This record separates current source inspection from a bounded September 6
host check and fresh fictional provider evaluation. No production reader,
Worker/D1 job, or portrait lifecycle was exercised. Account-specific training,
retention, and contractual privacy settings remain `unverified`.

| Boundary | Observed repository behavior | Limit of the evidence |
| --- | --- | --- |
| Worker to text runner | `client.ts` obtains a bounded JSON claim and sends completions over the configured HTTPS origin with a bearer credential, `no-store`, and redirect rejection. The claim contains the plaintext prompt and output schema. | Encryption at rest does not remove plaintext from Worker processing, the authenticated transport endpoint, runner memory, or upstream inference. Derived facts and private reading prose can still be personal data. |
| Ordinary Daily/Pattern/ontology text invocation | `codex-cli.ts` uses `isolated-codex-json.ts`: fresh app-server process and ephemeral thread, private temporary directory, strict JSON schema, read-only sandbox, no execution environments, and verified disabled host instructions/skills/MCP/tools. It verifies CLI `0.153.3`, model/effort, priority configuration, matching thread/turn usage, and rejects model rerouting. Output is bounded to 1 MiB; timeout/abort stops the process; failed cleanup is fatal. | The inherited Codex home supplies authentication. Tool and host isolation minimizes local context; it does not establish upstream non-retention or non-training. Provider-observed token usage is not a contractual output-token ceiling or proof of model implementation. |
| Text authentication and process logs | `checkCodexAuthentication()` requires bounded exact `Logged in using ChatGPT` status and successful exit. Each isolated attempt repeats authentication and pinned CLI checks. `codex-environment.ts` omits application bearer secrets and API-key environment variables; ordinary logs remain bounded events and safe codes. | ChatGPT authentication distinguishes the route, but not account/workspace category, training settings, administrator policy, or applicable agreement. Host log/backup retention was not inspected. |
| Native portrait image | `portrait-invocation.ts` requires CLI `0.153.3` and ChatGPT login, rejects inherited host instructions, checks effective app-server configuration, disables unrelated capabilities/MCP, and permits the native image tool. It verifies native image bytes and any saved file against the expected thread path, prepares bounded PNG/pixel output, and cleans the attempt and owned `generated_images` directory; cleanup failure is fatal. | The complete chapter prompt reaches upstream processing. The native tool label/CLI pin is not an independently observed underlying image-model identifier. Local image cleanup does not prove upstream image deletion or retention policy. |
| Mesh authoring and visual check | `portrait-mesh-invocation.ts` sends complete accepted chapter text, chapter identity and source hashes, plus the reference image, to a tool-free authoring turn. The local compiler creates the mesh and previews. A separate tool-free check receives the source/reference and four rendered views. `isolated-codex-json.ts` verifies ChatGPT authentication, CLI pin, read-only/ephemeral execution, empty execution environments, disabled MCP/tool configuration, and temporary-directory cleanup. | Source text and images, and then locally rendered previews, cross the provider boundary. The compiled model's internal source revision is deliberately not sent in the prompt. None of this proves upstream retention settings. |
| Cloudflare persistence and erasure | `codex-provider-artifacts.ts` encrypts provider request/response artifacts and binds hashes and coordinates. D1 retains job/lease/status metadata and encrypted artifact pointers. `codex-provider-maintenance.ts` checks owner state before cleanup: terminal Daily exchanges become eligible only after owner completion, terminal Pattern exchanges after 30 days, and failed ontology artifacts at their recorded expiry. User-owned provider artifacts participate in account erasure. | These are repository policies and tested code paths. They are not fresh evidence that production maintenance ran, all objects were removed, backups expired, or upstream copies were erased. Successful ontology artifact retention follows its separate policy. |

The [provider runbook](./codex-production-provider.md) records an intended
ChatGPT-authenticated, non-AGPL runner and a Sol/xhigh profile. Those are
repository declarations and dated operational observations. The local release
receipt binds their source bytes; it does not establish that this new runner
transport is installed or deployed.

On September 6, read-only host inspection identified the service user as
`patternlike-codex`, its working directory as
`/var/lib/patternlike-codex-runner/workspace`, and its executable under release
`ce524431ee18f955a7105bfb2ba573000eb5b625.boundary-fix-uncommitted-20260906T075044Z`.
The configured CLI reported `0.153.3`; `AGENTS.md` and `AGENTS.override.md` were
absent from that service account's Codex home. Only whitelisted environment
fields were read; no credentials were copied or recorded.

A private copy of the new source, run as that service user with the installed
CLI, completed six isolated fictional Daily requests with matching usage
notifications. This establishes that the checked path can authenticate and
process those samples. The first evaluation accepted four and rejected two;
the follow-up review records the validator regressions and any later runs. It
does not establish installed service adoption, production publication, or
account data-use settings. See the [fresh evaluation runbook](./fresh-reading-evaluation.md).

The source isolation controls are documented in the official
[app-server reference](https://learn.chatgpt.com/docs/app-server) and
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
Ephemeral thread behavior is not an upstream retention agreement.

Before making account-specific claims about provider privacy, retain the
following evidence in an access-controlled operator record. The repository may
hold a content-free summary with date, evidence source, opaque record reference,
and checksum. Do not store login tokens, account email, prompts, readings, images,
or exports here.

| Required external evidence | Current status |
| --- | --- |
| Actual runner service account/workspace category and the category used by each text/image/mesh path, confirmed by an authorized account owner | `unverified` |
| Applicable data-use/training controls and workspace administrator policy, with an observation date and source | `unverified` |
| Applicable retention and deletion behavior for text prompts/output, native images, files, and image inputs/previews; any contractual exceptions | `unverified` |
| Applicable service terms or contractual privacy basis for that exact account category; any claimed no-training, zero-retention, or regional-processing commitment | `unverified` |
| Complete installed runner artifact/configuration and restrictive storage, plus log/backup retention | `partial`: service identity, CLI version, and absence of Codex-home instruction files observed below; remaining inventory and policy `unverified` |
| A separately authorized test account exercise showing generation, saved-asset reuse, consent withdrawal during unfinished work, deletion, and rejection/cleanup of late uploads | `unverified` |

That lifecycle exercise must capture before/after durable state, terminal
publication and asset identity, reader visibility, consent/deletion transitions,
and cleanup results. Provider completion, a healthy runner, an HTTP 200, or an
encrypted R2 object alone is insufficient. The exercise must use an authorized
test account and stop short of copying any private content into evidence.

These open records are separate from the corpus's missing historical
generation/account provenance in
[`pattern-corpus/provenance.json`](../../pattern-corpus/provenance.json).
Observing today's runner account cannot recover how the old corpus was made.
