import {
  canonicalJson,
  sha256Hex,
  contentHash,
  PORTRAIT_AUTOMATION_CONSENT_POLICY_VERSION,
  PORTRAIT_MESH_AUTHORING,
  PORTRAIT_MESH_PROMPT_VERSION,
  PORTRAIT_MESH_COMPILER_VERSION,
  isCodexPortraitMeshClaim,
  isCodexPortraitMeshCompletion,
  parsePortraitMeshProgram,
  type PortraitAutomationPreference,
  type PortraitAutomationRequest,
  type CodexPortraitMeshClaim,
  type CodexPortraitMeshCompletion,
  type CodexPortraitMeshFailure,
  type PatternPortraitExplorerResponse,
  type PatternPortraitExplorerDownload,
  type PortraitMeshModel,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import { b64, fromB64 } from "../crypto.js";
import { loadUserIdentity } from "../db/users.js";
import {
  loadLiveAccountProcessingGrant,
  assertExactCurrentAccountProcessingGrant,
} from "../db/account-processing-consents.js";
import { loadPatternGenerationGrant } from "../db/pattern-consents.js";
import { hashChartFingerprint } from "../db/pattern-claims.js";
import { loadActiveChart } from "./pattern-state.js";
import { randomNonce } from "./pattern-crypto.js";
import {
  PortraitError,
  PORTRAIT_LEASE_MS,
  portraitEnabled,
  portraitEmpty,
  currentPattern,
  authorizedCurrent,
  guards,
  patternKey,
  portraitById,
  assetById,
  readAsset,
  readPortrait,
  startPortrait,
  portraitDownload,
  type PortraitRow,
  type Current,
} from "./pattern-portrait.js";
import { validatePortraitMeshGlb } from "./portrait-mesh-glb.js";

interface Grant {
  id: string;
  user_id: string;
  chart_id: string;
  chart_fingerprint_hash: string;
  enabled: number;
}
interface MeshJob {
  id: string;
  user_id: string;
  portrait_id: string;
  grant_id: string;
  image_asset_id: string;
  processing_consent_id: string;
  pattern_consent_id: string;
  chapter_index: number;
  source_text_sha256: string;
  source_image_sha256: string;
  document_revision: string;
  compiler_version: string;
  status: "pending" | "running" | "complete" | "failed" | "cancelled";
  attempts: number;
  lease_hash: string | null;
  lease_expires_at: string | null;
  completion_hash: string | null;
  model_asset_id: string | null;
  provenance_asset_id: string | null;
}
interface MeshAsset {
  id: string;
  user_id: string;
  portrait_id: string;
  job_id: string;
  role: "model" | "provenance";
  object_key: string;
  plaintext_sha256: string;
  byte_length: number;
  cleanup_at: string | null;
}
interface Provenance {
  program: CodexPortraitMeshCompletion["program"];
  audit: CodexPortraitMeshCompletion["audit"];
  provider_request_id: string;
  audit_request_id: string;
  model: PortraitMeshModel;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const opaque = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
export const meshEnabled = (env: Env) =>
  portraitEnabled(env) && env.PATTERN_PORTRAIT_MESH_ENABLED === "1";
async function migrated(env: Env) {
  return !!(await env.DB.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='portrait_mesh_jobs'",
  ).first());
}
async function available(env: Env) {
  return meshEnabled(env) && (await migrated(env));
}
const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
const grantFence = (env: Env, id: string, userId: string, chartId: string) =>
  env.DB.prepare(
    `INSERT INTO assertion_probe(id,reason) SELECT 1,'portrait automation withdrawn' WHERE NOT EXISTS(SELECT 1 FROM portrait_automation_grants WHERE id=? AND user_id=? AND chart_id=? AND enabled=1 AND policy_version='1.1.0')`,
  ).bind(id, userId, chartId);
async function liveGrant(env: Env, userId: string, chartId: string) {
  return env.DB.prepare(
    "SELECT * FROM portrait_automation_grants WHERE user_id=? AND chart_id=? AND enabled=1",
  )
    .bind(userId, chartId)
    .first<Grant>();
}
export async function readPortraitAutomation(
  env: Env,
  userId: string,
): Promise<PortraitAutomationPreference> {
  const enabled = await available(env);
  const chart = enabled ? await loadActiveChart(env, userId) : null;
  const grant = chart ? await liveGrant(env, userId, chart.id) : null;
  return {
    schema_version: "portrait-automation/v1",
    available: enabled,
    chart_id: chart?.id ?? null,
    enabled: !!grant,
    consent_policy_version: PORTRAIT_AUTOMATION_CONSENT_POLICY_VERSION,
  };
}
export async function setPortraitAutomation(
  env: Env,
  userId: string,
  input: PortraitAutomationRequest,
) {
  if (!(await available(env)))
    throw new PortraitError(503, "portrait_unavailable");
  const chart = await loadActiveChart(env, userId);
  const identity = await loadUserIdentity(env, userId);
  const now = new Date();
  if (!chart || chart.id !== input.chart_id || identity?.status !== "active")
    throw new PortraitError(409, "portrait_revision_conflict");
  if (!input.enabled) {
    await env.DB.prepare(
      "UPDATE portrait_automation_grants SET enabled=0,updated_at=? WHERE user_id=? AND chart_id=? AND enabled=1",
    )
      .bind(now.toISOString(), userId, chart.id)
      .run();
    return readPortraitAutomation(env, userId);
  }
  const processing = await loadLiveAccountProcessingGrant(env, userId, now);
  if (!processing) throw new PortraitError(409, "portrait_consent_required");
  const fingerprint = await hashChartFingerprint(chart.fingerprint);
  const grantId = opaque("ppgrant");
  try {
    await env.DB.batch([
      assertExactCurrentAccountProcessingGrant(
        env,
        userId,
        processing.consentId,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO assertion_probe(id,reason) SELECT 1,'portrait chart changed' WHERE NOT EXISTS(SELECT 1 FROM chart_snapshots c JOIN birth_profiles b ON b.user_id=c.user_id AND b.version=c.profile_version JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.user_id=? AND c.status='active' AND c.fingerprint=? AND b.status='active' AND u.status='active' AND u.crypto_write_fence IS NULL)`,
      ).bind(chart.id, userId, chart.fingerprint),
      env.DB.prepare(
        `INSERT OR IGNORE INTO portrait_automation_grants(id,user_id,chart_id,chart_fingerprint_hash,policy_version,enabled,created_at,updated_at) VALUES(?,?,?,?,'1.1.0',1,?,?)`,
      ).bind(
        grantId,
        userId,
        chart.id,
        fingerprint,
        now.toISOString(),
        now.toISOString(),
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO portrait_start_outbox(id,user_id,pattern_id,grant_id,chart_id,status,created_at) SELECT ?,d.user_id,d.id,g.id,g.chart_id,'pending',? FROM pattern_documents d JOIN pattern_generation_claims c ON c.id=d.claim_id AND c.status='accepted' JOIN portrait_automation_grants g ON g.user_id=d.user_id AND g.chart_fingerprint_hash=d.chart_fingerprint_hash AND g.enabled=1 WHERE d.user_id=? AND g.chart_id=? ON CONFLICT(pattern_id) DO UPDATE SET grant_id=excluded.grant_id,status='pending',checked_at='1970-01-01T00:00:00.000Z' WHERE portrait_start_outbox.grant_id!=excluded.grant_id`,
      ).bind(opaque("ppstart"), now.toISOString(), userId, chart.id),
    ]);
  } catch {
    throw new PortraitError(409, "portrait_revision_conflict");
  }
  return readPortraitAutomation(env, userId);
}
async function context(env: Env, job: MeshJob, now: Date) {
  const parent = await portraitById(env, job.portrait_id);
  if (!parent) return null;
  const row = {
    ...parent,
    processing_consent_id: job.processing_consent_id,
    pattern_consent_id: job.pattern_consent_id,
  };
  const current = await authorizedCurrent(env, row, now);
  if (!current) return null;
  const grant = await liveGrant(env, job.user_id, row.chart_id);
  const image = await assetById(env, job.image_asset_id);
  const accepted = await env.DB.prepare(
    "SELECT 1 FROM pattern_portrait_jobs WHERE portrait_id=? AND chapter_index=? AND image_asset_id=? AND status='complete'",
  )
    .bind(row.id, job.chapter_index, job.image_asset_id)
    .first();
  if (
    !grant ||
    grant.id !== job.grant_id ||
    !image ||
    !accepted ||
    image.plaintext_sha256 !== job.source_image_sha256 ||
    current.revision !== job.document_revision ||
    (await sha256Hex(current.sources[job.chapter_index]!)) !==
      job.source_text_sha256
  )
    return null;
  return { row, current, image };
}
function fences(
  env: Env,
  job: MeshJob,
  row: PortraitRow,
  current: Current,
  now: Date,
) {
  return [
    ...guards(env, row, current, now),
    grantFence(env, job.grant_id, job.user_id, row.chart_id),
    env.DB.prepare(
      `INSERT INTO assertion_probe(id,reason) SELECT 1,'mesh source changed' WHERE NOT EXISTS(SELECT 1 FROM pattern_portrait_jobs j JOIN pattern_portrait_assets a ON a.id=j.image_asset_id WHERE j.portrait_id=? AND j.chapter_index=? AND j.status='complete' AND a.id=? AND a.plaintext_sha256=? AND a.cleanup_at IS NULL)`,
    ).bind(
      row.id,
      job.chapter_index,
      job.image_asset_id,
      job.source_image_sha256,
    ),
  ];
}
async function jobById(env: Env, id: string) {
  return env.DB.prepare("SELECT * FROM portrait_mesh_jobs WHERE id=?")
    .bind(id)
    .first<MeshJob>();
}
async function cancelJob(env: Env, job: MeshJob) {
  await env.DB.prepare(
    "UPDATE portrait_mesh_jobs SET status='cancelled',lease_hash=NULL,lease_expires_at=NULL WHERE id=? AND status!='complete' AND NOT EXISTS(SELECT 1 FROM users WHERE id=? AND status='frozen')",
  )
    .bind(job.id, job.user_id)
    .run();
}
async function repair(env: Env, now: Date) {
  const starts = (
    await env.DB.prepare(
      "UPDATE portrait_start_outbox SET checked_at=? WHERE id IN(SELECT id FROM portrait_start_outbox WHERE status='pending' ORDER BY checked_at,id LIMIT 30) RETURNING *",
    )
      .bind(now.toISOString())
      .all<{
        id: string;
        user_id: string;
        pattern_id: string;
        grant_id: string;
        chart_id: string;
      }>()
  ).results;
  for (const entry of starts) {
    try {
      const identity = await loadUserIdentity(env, entry.user_id);
      if (identity?.status === "frozen") continue;
      const current = await currentPattern(env, entry.user_id);
      const grant = await liveGrant(env, entry.user_id, entry.chart_id);
      if (
        !current ||
        current.document.id !== entry.pattern_id ||
        grant?.id !== entry.grant_id
      ) {
        await env.DB.prepare(
          "UPDATE portrait_start_outbox SET status=? WHERE id=? AND grant_id=? AND status='pending'",
        )
          .bind(!current && grant ? "unsupported" : "cancelled", entry.id, entry.grant_id)
          .run();
        continue;
      }
      await startPortrait(
        env,
        current.identity,
        {
          pattern_id: current.document.id,
          generated_at: current.document.generated_at,
          chart_id: current.chart.id,
          confirm: "CREATE MY PORTRAIT",
          consent_policy_version: "1.0.0",
        },
        entry.grant_id,
      );
      await env.DB.batch([
        grantFence(env, entry.grant_id, entry.user_id, entry.chart_id),
        env.DB.prepare(
          "UPDATE portrait_start_outbox SET status='complete' WHERE id=? AND grant_id=? AND status='pending'",
        ).bind(entry.id, entry.grant_id),
      ]);
    } catch (error) {
      if (
        error instanceof PortraitError &&
        ["portrait_consent_required", "portrait_revision_conflict"].includes(
          error.code,
        )
      )
        await env.DB.prepare(
          "UPDATE portrait_start_outbox SET status='cancelled' WHERE id=? AND grant_id=? AND status='pending'",
        )
          .bind(entry.id, entry.grant_id)
          .run();
    }
  }
  const rows = (
    await env.DB.prepare(
      `SELECT j.id image_job_id,j.image_asset_id,j.chapter_index,j.source_sha256,p.*,g.id automation_grant_id,a.plaintext_sha256 image_sha FROM pattern_portrait_jobs j JOIN pattern_portraits p ON p.id=j.portrait_id JOIN portrait_automation_grants g ON g.user_id=p.user_id AND g.chart_id=p.chart_id AND g.enabled=1 JOIN pattern_portrait_assets a ON a.id=j.image_asset_id AND a.cleanup_at IS NULL WHERE j.status='complete' AND p.status IN('generating','ready','failed') AND NOT EXISTS(SELECT 1 FROM portrait_mesh_jobs m WHERE m.portrait_id=p.id AND m.chapter_index=j.chapter_index AND m.compiler_version=? AND NOT(m.status='cancelled' AND m.attempts<3 AND m.grant_id!=g.id)) ORDER BY j.created_at LIMIT 100`,
    )
      .bind(PORTRAIT_MESH_COMPILER_VERSION)
      .all<
        PortraitRow & {
          automation_grant_id: string;
          image_asset_id: string;
          processing_consent_id: string;
          pattern_consent_id: string;
          chapter_index: number;
          source_sha256: string;
          image_sha: string;
        }
      >()
  ).results;
  for (const row of rows) {
    try {
      const processing = await loadLiveAccountProcessingGrant(
        env,
        row.user_id,
        now,
      );
      const pattern = await loadPatternGenerationGrant(env, row.user_id, now);
      if (!processing || !pattern) continue;
      const authorization = {
        ...row,
        processing_consent_id: processing.consentId,
        pattern_consent_id: pattern.consentId,
      };
      const current = await authorizedCurrent(env, authorization, now);
      if (!current) continue;
      if (
        (await sha256Hex(current.sources[row.chapter_index]!)) !==
        row.source_sha256
      )
        continue;
      await env.DB.batch([
        ...guards(env, authorization, current, now),
        grantFence(env, row.automation_grant_id, row.user_id, row.chart_id),
        env.DB.prepare(
          `INSERT OR IGNORE INTO portrait_mesh_jobs(id,user_id,portrait_id,grant_id,image_asset_id,processing_consent_id,pattern_consent_id,chapter_index,source_text_sha256,source_image_sha256,document_revision,compiler_version,status,retry_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?) ON CONFLICT(portrait_id,chapter_index,compiler_version) DO UPDATE SET grant_id=excluded.grant_id,processing_consent_id=excluded.processing_consent_id,pattern_consent_id=excluded.pattern_consent_id,status='pending',retry_at=excluded.retry_at,lease_hash=NULL,lease_expires_at=NULL,completion_hash=NULL,failure_code=NULL,updated_at=excluded.updated_at WHERE portrait_mesh_jobs.status='cancelled' AND portrait_mesh_jobs.attempts<3 AND portrait_mesh_jobs.grant_id!=excluded.grant_id AND portrait_mesh_jobs.source_text_sha256=excluded.source_text_sha256 AND portrait_mesh_jobs.source_image_sha256=excluded.source_image_sha256 AND portrait_mesh_jobs.document_revision=excluded.document_revision`,
        ).bind(
          opaque("ppmesh"),
          row.user_id,
          row.id,
          row.automation_grant_id,
          row.image_asset_id,
          processing.consentId,
          pattern.consentId,
          row.chapter_index,
          row.source_sha256,
          row.image_sha,
          current.revision,
          PORTRAIT_MESH_COMPILER_VERSION,
          now.toISOString(),
          now.toISOString(),
          now.toISOString(),
        ),
      ]);
    } catch {
      /* Another source/consent transition wins. */
    }
  }
}
async function recover(env: Env, now: Date) {
  await env.DB.prepare(
    "UPDATE portrait_mesh_jobs SET status=CASE WHEN attempts<3 THEN 'pending' ELSE 'failed' END,lease_hash=NULL,lease_expires_at=NULL,retry_at=?,failure_code='lease_expired',updated_at=? WHERE status='running' AND lease_expires_at<=?",
  )
    .bind(now.toISOString(), now.toISOString(), now.toISOString())
    .run();
}
export async function claimPortraitMesh(
  env: Env,
  now = new Date(),
): Promise<CodexPortraitMeshClaim | null> {
  if (!(await available(env))) return null;
  await repair(env, now);
  await recover(env, now);
  const jobs = (
    await env.DB.prepare(
      "SELECT j.* FROM portrait_mesh_jobs j JOIN users u ON u.id=j.user_id AND u.status='active' WHERE j.status='pending' AND j.attempts<3 AND j.retry_at<=? ORDER BY j.created_at,j.chapter_index LIMIT 8",
    )
      .bind(now.toISOString())
      .all<MeshJob>()
  ).results;
  for (const job of jobs) {
    const auth = await context(env, job, now);
    if (!auth) {
      await cancelJob(env, job);
      continue;
    }
    let image: Uint8Array;
    try {
      image = await readAsset(
        env,
        auth.image,
        await patternKey(env, auth.current),
      );
    } catch (error) {
      if (
        (error instanceof PortraitError && error.status === 404) ||
        (error instanceof Error &&
          ([
            "portrait artifact missing",
            "portrait artifact hash mismatch",
          ].includes(error.message) ||
            error.name === "OperationError"))
      )
        await env.DB.prepare(
          "UPDATE portrait_mesh_jobs SET status='failed',failure_code='source_unavailable' WHERE id=? AND status='pending'",
        )
          .bind(job.id)
          .run();
      continue;
    }
    const lease = crypto.randomUUID();
    const claim: CodexPortraitMeshClaim = {
      schema_version: "codex-portrait-mesh-claim/v1",
      job_id: job.id,
      portrait_id: job.portrait_id,
      chapter_index: job.chapter_index,
      chapter_id: `chapter-${job.chapter_index + 1}`,
      lease_token: lease,
      model: "gpt-5.6-sol",
      reasoning_effort: "xhigh",
      prompt_version: PORTRAIT_MESH_PROMPT_VERSION,
      timeout_ms: 900000,
      source_text: auth.current.sources[job.chapter_index]!,
      source_text_sha256: job.source_text_sha256,
      source_image_sha256: job.source_image_sha256,
      document_revision: job.document_revision,
      image_base64: b64(image),
      compiler_version: job.compiler_version,
    };
    if (!isCodexPortraitMeshClaim(claim)) {
      await env.DB.prepare(
        "UPDATE portrait_mesh_jobs SET status='failed',failure_code='source_invalid' WHERE id=? AND status='pending'",
      )
        .bind(job.id)
        .run();
      continue;
    }
    try {
      const result = await env.DB.batch([
        ...fences(env, job, auth.row, auth.current, now),
        env.DB.prepare(
          "UPDATE portrait_mesh_jobs SET status='running',attempts=attempts+1,lease_hash=?,lease_expires_at=?,updated_at=? WHERE id=? AND status='pending' AND attempts<3",
        ).bind(
          await contentHash(lease),
          new Date(now.getTime() + PORTRAIT_LEASE_MS).toISOString(),
          now.toISOString(),
          job.id,
        ),
      ]);
      if (result.at(-1)?.meta.changes === 1) return claim;
    } catch {
      /* Lost admission race. */
    }
  }
  return null;
}
const aad = (asset: MeshAsset) =>
  encoder.encode(
    JSON.stringify([
      "patternlike.portrait-mesh",
      1,
      asset.portrait_id,
      asset.id,
      asset.role,
    ]),
  );
async function readMeshAsset(env: Env, asset: MeshAsset, current: Current) {
  const object = await env.ARTIFACTS!.get(asset.object_key);
  if (!object || object.size !== asset.byte_length + 28 || asset.cleanup_at)
    throw new PortraitError(404, "portrait_model_not_found");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const key = await crypto.subtle.importKey(
    "raw",
    await patternKey(env, current),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: aad(asset) },
      key,
      bytes.slice(12),
    ),
  );
  if ((await digest(plain)) !== asset.plaintext_sha256)
    throw new PortraitError(404, "portrait_model_not_found");
  return plain;
}
async function save(
  env: Env,
  job: MeshJob,
  row: PortraitRow,
  current: Current,
  role: MeshAsset["role"],
  plain: Uint8Array,
  leaseHash: string,
  now: Date,
) {
  const id = `ppmodel_${(await sha256Hex(`${job.id}:${leaseHash}:${role}`)).slice(0, 32)}`;
  const asset: MeshAsset = {
    id,
    user_id: job.user_id,
    portrait_id: job.portrait_id,
    job_id: job.id,
    role,
    object_key: `portrait-meshes/${job.portrait_id}/${id}.enc`,
    plaintext_sha256: await digest(plain),
    byte_length: plain.length,
    cleanup_at: null,
  };
  try {
    await env.DB.batch([
      ...fences(env, job, row, current, now),
      leaseFence(env, job.id, leaseHash, now),
      env.DB.prepare(
        "INSERT OR IGNORE INTO portrait_mesh_assets(id,user_id,portrait_id,job_id,role,object_key,plaintext_sha256,byte_length,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        job.user_id,
        job.portrait_id,
        job.id,
        role,
        asset.object_key,
        asset.plaintext_sha256,
        plain.length,
        now.toISOString(),
      ),
    ]);
  } catch {
    throw new PortraitError(409, "portrait_mesh_conflict");
  }
  const registered = await env.DB.prepare(
    "SELECT * FROM portrait_mesh_assets WHERE id=?",
  )
    .bind(id)
    .first<MeshAsset>();
  if (
    !registered ||
    registered.cleanup_at ||
    registered.plaintext_sha256 !== asset.plaintext_sha256
  )
    throw new PortraitError(409, "portrait_mesh_conflict");
  const key = await crypto.subtle.importKey(
    "raw",
    await patternKey(env, current),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const nonce = randomNonce();
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad(asset) },
      key,
      plain,
    ),
  );
  const envelope = new Uint8Array(nonce.length + cipher.length);
  envelope.set(nonce);
  envelope.set(cipher, nonce.length);
  try {
    const put = await env.ARTIFACTS!.put(asset.object_key, envelope, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: "application/octet-stream",
        cacheControl: "private, no-store",
      },
    });
    if (!put) await readMeshAsset(env, asset, current);
  } catch {
    throw new PortraitError(503, "portrait_storage_unavailable");
  }
  return asset;
}
const leaseFence = (env: Env, id: string, lease: string, now: Date) =>
  env.DB.prepare(
    "INSERT INTO assertion_probe(id,reason) SELECT 1,'mesh lease changed' WHERE NOT EXISTS(SELECT 1 FROM portrait_mesh_jobs WHERE id=? AND status='running' AND lease_hash=? AND lease_expires_at>?)",
  ).bind(id, lease, now.toISOString());
export async function completePortraitMesh(
  env: Env,
  id: string,
  input: CodexPortraitMeshCompletion,
  now = new Date(),
) {
  if (!(await available(env)))
    throw new PortraitError(503, "portrait_unavailable");
  if (
    !isCodexPortraitMeshCompletion(input) ||
    !parsePortraitMeshProgram(input.program)
  )
    throw new PortraitError(400, "invalid_mesh");
  const job = await jobById(env, id);
  if (!job) throw new PortraitError(409, "portrait_mesh_conflict");
  const completionHash = await contentHash(canonicalJson(input));
  const leaseHash = await contentHash(input.lease_token);
  if (
    job.status === "complete" &&
    job.lease_hash === leaseHash &&
    job.completion_hash === completionHash
  )
    return;
  const auth = await context(env, job, now);
  if (
    !auth ||
    job.status !== "running" ||
    job.lease_hash !== leaseHash ||
    !job.lease_expires_at ||
    job.lease_expires_at <= now.toISOString()
  )
    throw new PortraitError(409, "portrait_mesh_conflict");
  const glb = fromB64(input.glb_base64);
  const programHash = await sha256Hex(canonicalJson(input.program));
  const identity = {
    chapterId: `chapter-${job.chapter_index + 1}`,
    documentRevision: job.document_revision,
    sourceImageSha256: job.source_image_sha256,
    sourceTextSha256: job.source_text_sha256,
    programSha256: programHash,
    compilerVersion: job.compiler_version,
    authoring: PORTRAIT_MESH_AUTHORING,
  };
  if (
    input.compiler_version !== job.compiler_version ||
    input.program_sha256 !== programHash ||
    (await digest(glb)) !== input.glb_sha256 ||
    !validatePortraitMeshGlb(glb, identity)
  )
    throw new PortraitError(400, "invalid_mesh");
  try {
    const model = await save(
      env,
      job,
      auth.row,
      auth.current,
      "model",
      glb,
      leaseHash,
      now,
    );
    const metadata: PortraitMeshModel = {
      chapter_id: identity.chapterId,
      reference_id: model.id,
      sha256: model.plaintext_sha256,
      source_image_sha256: job.source_image_sha256,
      source_text_sha256: job.source_text_sha256,
      source_text: auth.current.sources[job.chapter_index]!,
      program_sha256: programHash,
      compiler_version: job.compiler_version,
      authoring: PORTRAIT_MESH_AUTHORING,
      document_revision: job.document_revision,
    };
    const provenance: Provenance = {
      program: input.program,
      audit: input.audit,
      provider_request_id: input.provider_request_id,
      audit_request_id: input.audit_request_id,
      model: metadata,
    };
    const receipt = await save(
      env,
      job,
      auth.row,
      auth.current,
      "provenance",
      encoder.encode(canonicalJson(provenance)),
      leaseHash,
      now,
    );
    const adoptedAt = new Date(Math.max(now.getTime(), Date.now()));
    await env.DB.batch([
      ...fences(env, job, auth.row, auth.current, adoptedAt),
      leaseFence(env, id, leaseHash, adoptedAt),
      env.DB.prepare(
        "UPDATE portrait_mesh_jobs SET status='complete',completion_hash=?,model_asset_id=?,provenance_asset_id=?,completed_at=?,updated_at=? WHERE id=? AND status='running' AND lease_hash=?",
      ).bind(
        completionHash,
        model.id,
        receipt.id,
        adoptedAt.toISOString(),
        adoptedAt.toISOString(),
        id,
        leaseHash,
      ),
    ]);
  } catch (error) {
    const accepted = await jobById(env, id);
    if (
      accepted?.status === "complete" &&
      accepted.completion_hash === completionHash &&
      accepted.lease_hash === leaseHash
    )
      return;
    if (error instanceof PortraitError && error.status === 503) throw error;
    await env.DB.prepare(
      "UPDATE portrait_mesh_assets SET cleanup_at=COALESCE(cleanup_at,?) WHERE job_id=? AND id NOT IN(SELECT model_asset_id FROM portrait_mesh_jobs WHERE id=? AND status='complete' UNION SELECT provenance_asset_id FROM portrait_mesh_jobs WHERE id=? AND status='complete')",
    )
      .bind(now.toISOString(), id, id, id)
      .run();
    if (error instanceof PortraitError) throw error;
    throw new PortraitError(409, "portrait_mesh_conflict");
  }
}
export async function failPortraitMesh(
  env: Env,
  id: string,
  input: CodexPortraitMeshFailure,
  now = new Date(),
) {
  if (!(await available(env)))
    throw new PortraitError(503, "portrait_unavailable");
  const job = await jobById(env, id);
  if (!job) throw new PortraitError(409, "portrait_mesh_conflict");
  const auth = await context(env, job, now);
  const lease = await contentHash(input.lease_token);
  const failureHash = await contentHash(canonicalJson(input));
  if (
    auth &&
    (job.status === "pending" || job.status === "failed") &&
    job.lease_hash === lease &&
    job.completion_hash === failureHash
  )
    return;
  if (!auth || job.status !== "running" || job.lease_hash !== lease)
    throw new PortraitError(409, "portrait_mesh_conflict");
  const retry =
    job.attempts < 3 &&
    !["authentication_failed", "generation_refused"].includes(input.code);
  try {
    await env.DB.batch([
      ...fences(env, job, auth.row, auth.current, now),
      leaseFence(env, id, lease, now),
      env.DB.prepare(
        "UPDATE portrait_mesh_jobs SET status=?,retry_at=?,lease_expires_at=NULL,failure_code=?,completion_hash=?,updated_at=? WHERE id=?",
      ).bind(
        retry ? "pending" : "failed",
        new Date(now.getTime() + 30000 * job.attempts).toISOString(),
        input.code,
        failureHash,
        now.toISOString(),
        id,
      ),
    ]);
  } catch {
    throw new PortraitError(409, "portrait_mesh_conflict");
  }
}
async function acceptedModel(env: Env, userId: string, referenceId: string) {
  const current = await currentPattern(env, userId);
  if (!current) throw new PortraitError(404, "portrait_model_not_found");
  const asset = await env.DB.prepare(
    `SELECT a.* FROM portrait_mesh_assets a JOIN portrait_mesh_jobs j ON j.id=a.job_id AND j.status='complete' AND j.model_asset_id=a.id JOIN pattern_portraits p ON p.id=a.portrait_id AND p.status='ready' WHERE a.id=? AND a.user_id=? AND p.user_id=? AND p.pattern_id=? AND p.chart_id=? AND p.document_revision=? AND p.document_hash=? AND a.cleanup_at IS NULL AND a.role='model'`,
  )
    .bind(
      referenceId,
      userId,
      userId,
      current.document.id,
      current.chart.id,
      current.revision,
      current.documentHash,
    )
    .first<MeshAsset>();
  if (!asset) throw new PortraitError(404, "portrait_model_not_found");
  const job = await jobById(env, asset.job_id);
  if (!job?.provenance_asset_id)
    throw new PortraitError(404, "portrait_model_not_found");
  const receipt = await env.DB.prepare(
    "SELECT * FROM portrait_mesh_assets WHERE id=? AND cleanup_at IS NULL",
  )
    .bind(job.provenance_asset_id)
    .first<MeshAsset>();
  if (!receipt) throw new PortraitError(404, "portrait_model_not_found");
  const image = await assetById(env, job.image_asset_id);
  const imageJob = await env.DB.prepare(
    "SELECT 1 FROM pattern_portrait_jobs WHERE portrait_id=? AND chapter_index=? AND image_asset_id=? AND status='complete'",
  )
    .bind(job.portrait_id, job.chapter_index, job.image_asset_id)
    .first();
  if (!image || !imageJob || image.plaintext_sha256 !== job.source_image_sha256)
    throw new PortraitError(404, "portrait_model_not_found");
  await readAsset(env, image, await patternKey(env, current));
  const provenance = JSON.parse(
    decoder.decode(await readMeshAsset(env, receipt, current)),
  ) as Provenance;
  const model = provenance.model;
  const bytes = await readMeshAsset(env, asset, current);
  if (
    model.chapter_id !== `chapter-${job.chapter_index + 1}` ||
    model.document_revision !== current.revision ||
    model.source_image_sha256 !== job.source_image_sha256 ||
    model.source_text_sha256 !== job.source_text_sha256 ||
    model.compiler_version !== job.compiler_version ||
    model.authoring !== PORTRAIT_MESH_AUTHORING ||
    model.reference_id !== asset.id ||
    model.sha256 !== asset.plaintext_sha256 ||
    model.source_text !== current.sources[job.chapter_index] ||
    (await sha256Hex(model.source_text)) !== job.source_text_sha256 ||
    model.program_sha256 !==
      (await sha256Hex(canonicalJson(provenance.program))) ||
    !validatePortraitMeshGlb(bytes, {
      chapterId: `chapter-${job.chapter_index + 1}`,
      documentRevision: current.revision,
      sourceImageSha256: job.source_image_sha256,
      sourceTextSha256: job.source_text_sha256,
      programSha256: model.program_sha256,
      compilerVersion: job.compiler_version,
      authoring: PORTRAIT_MESH_AUTHORING,
    })
  )
    throw new PortraitError(404, "portrait_model_not_found");
  return { bytes, provenance };
}
export async function portraitModel(
  env: Env,
  userId: string,
  referenceId: string,
) {
  if (!(await available(env)))
    throw new PortraitError(404, "portrait_model_not_found");
  try {
    return (await acceptedModel(env, userId, referenceId)).bytes;
  } catch {
    throw new PortraitError(404, "portrait_model_not_found");
  }
}
export async function readPortraitExplorer(
  env: Env,
  userId: string,
): Promise<PatternPortraitExplorerResponse> {
  const enabled = await available(env);
  const portrait = enabled ? await readPortrait(env, userId) : portraitEmpty();
  const response: PatternPortraitExplorerResponse = {
    schema_version: "pattern-portrait-explorer/v1",
    status: enabled ? "not_started" : "unavailable",
    portrait,
    completed_models: 0,
    retryable: false,
    models: [],
  };
  if (!enabled) return response;
  const current = await currentPattern(env, userId);
  if (!current) return { ...response, status: "unavailable" };
  if (!portrait.portrait_id) {
    const start = await env.DB.prepare(
      "SELECT status FROM portrait_start_outbox WHERE user_id=? AND pattern_id=?",
    )
      .bind(userId, current.document.id)
      .first<{ status: string }>();
    const cancelled = await env.DB.prepare(
      "SELECT 1 FROM pattern_portraits WHERE user_id=? AND pattern_id=? AND status='cancelled'",
    )
      .bind(userId, current.document.id)
      .first();
    return {
      ...response,
      status:
        cancelled || start?.status === "cancelled"
          ? "failed"
          : start?.status === "unsupported"
            ? "unavailable"
            : (await liveGrant(env, userId, current.chart.id))
              ? "generating"
              : "not_started",
    };
  }
  const jobs = (
    await env.DB.prepare(
      "SELECT * FROM portrait_mesh_jobs WHERE portrait_id=? AND compiler_version=? ORDER BY chapter_index",
    )
      .bind(portrait.portrait_id, PORTRAIT_MESH_COMPILER_VERSION)
      .all<MeshJob>()
  ).results;
  response.completed_models = jobs.filter(
    (j) => j.status === "complete",
  ).length;
  response.retryable = jobs.some(
    (j) => j.status === "pending" || j.status === "running",
  );
  response.status =
    response.retryable || portrait.status === "generating"
      ? "generating"
      : jobs.some((j) => j.status === "failed" || j.status === "cancelled") ||
          portrait.status === "failed"
        ? "failed"
        : jobs.length || (await liveGrant(env, userId, current.chart.id))
          ? "generating"
          : "not_started";
  if (response.completed_models === 4 && portrait.status === "ready") {
    try {
      for (const job of jobs)
        response.models.push(
          (await acceptedModel(env, userId, job.model_asset_id!)).provenance
            .model,
        );
      response.status = "ready";
      response.retryable = false;
    } catch {
      response.status = "failed";
      response.models = [];
      response.retryable = false;
    }
  }
  return response;
}
export async function portraitExplorerDownload(
  env: Env,
  userId: string,
  expected: URLSearchParams,
): Promise<PatternPortraitExplorerDownload> {
  const explorer = await readPortraitExplorer(env, userId);
  if (explorer.status !== "ready")
    throw new PortraitError(409, "portrait_not_ready");
  const legacy = await portraitDownload(env, userId, expected);
  const current = await currentPattern(env, userId);
  if (!current || current.revision !== explorer.portrait.document_revision)
    throw new PortraitError(409, "portrait_revision_conflict");
  const models: PatternPortraitExplorerDownload["models"] = [];
  for (const item of explorer.models) {
    const { bytes, provenance } = await acceptedModel(
      env,
      userId,
      item.reference_id,
    );
    models.push({
      reference_id: item.reference_id,
      content_type: "model/gltf-binary",
      sha256: item.sha256,
      data_base64: b64(bytes),
      program: provenance.program,
      audit: provenance.audit,
      provider_request_id: provenance.provider_request_id,
      audit_request_id: provenance.audit_request_id,
    });
  }
  return {
    schema_version: "pattern-portrait-explorer-download/v1",
    reading: current.published,
    explorer,
    images: legacy.images as PatternPortraitExplorerDownload["images"],
    models,
  };
}
export async function maintainPortraitMeshes(env: Env, now = new Date()) {
  if (!(await migrated(env))) return;
  if (meshEnabled(env)) {
    await repair(env, now);
    await recover(env, now);
  }
  const jobs = (
    await env.DB.prepare(
      "SELECT * FROM portrait_mesh_jobs WHERE status IN('pending','running') ORDER BY updated_at LIMIT 100",
    ).all<MeshJob>()
  ).results;
  for (const job of jobs) {
    try {
      if (!(await context(env, job, now))) await cancelJob(env, job);
      await env.DB.prepare(
        "UPDATE portrait_mesh_jobs SET updated_at=? WHERE id=?",
      )
        .bind(now.toISOString(), job.id)
        .run();
    } catch {
      /* Retry transient failures. */
    }
  }
  await env.DB.prepare(
    `UPDATE portrait_mesh_assets SET cleanup_at=? WHERE cleanup_at IS NULL AND created_at<? AND NOT EXISTS(SELECT 1 FROM portrait_mesh_jobs j WHERE j.status='complete' AND (j.model_asset_id=portrait_mesh_assets.id OR j.provenance_asset_id=portrait_mesh_assets.id)) AND NOT EXISTS(SELECT 1 FROM portrait_mesh_jobs j WHERE j.id=portrait_mesh_assets.job_id AND j.status='running' AND j.lease_expires_at>?)`,
  )
    .bind(
      now.toISOString(),
      new Date(now.getTime() - PORTRAIT_LEASE_MS).toISOString(),
      now.toISOString(),
    )
    .run();
  if (!env.ARTIFACTS) return;
  const assets = (
    await env.DB.prepare(
      "SELECT id,object_key FROM portrait_mesh_assets WHERE cleanup_at IS NOT NULL ORDER BY COALESCE(deleted_at,''),id LIMIT 100",
    ).all<{ id: string; object_key: string }>()
  ).results;
  for (const asset of assets) {
    try {
      await env.ARTIFACTS.delete(asset.object_key);
      if (!(await env.ARTIFACTS.head(asset.object_key)))
        await env.DB.prepare(
          "UPDATE portrait_mesh_assets SET deleted_at=? WHERE id=?",
        )
          .bind(now.toISOString(), asset.id)
          .run();
    } catch {
      /* Inventory survives and late uploads are deleted again. */
    }
  }
}
