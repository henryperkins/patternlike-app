import {
  canonicalJson, newId, requireIdempotencyKey, sha256Hex,
  READING_FEEDBACK_CATEGORIES, READING_FEEDBACK_EFFECT_WINDOW_DAYS,
  READING_FEEDBACK_RETENTION_MONTHS, READING_FEEDBACK_USE_POLICY_VERSION,
  type ReadingFeedbackEventExport, type ReadingFeedbackEventReceipt, type ReadingFeedbackEventRequest,
  type ReadingFeedbackOptionsResponse, type ReadingFeedbackTarget,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import { b64, decryptJson, fromB64 } from "../crypto.js";
import { decryptPayload, encryptPayload, loadUserKey, type UserIdentity } from "./users.js";
import { buildCryptoWriteFence } from "./crypto-write-fence.js";
import { USR12_ALLOWED_USES, USR12_PERMISSION_TIER, USR12_POLICY_VERSION } from "./first-party-sources.js";
import { loadReadableReadingById, loadReadingEvidence } from "./readings.js";
import { isStoredReadingV5 } from "../services/stored-reading.js";
import { resolvePublisherConfiguration } from "../services/reading-publisher.js";
import { CATEGORIZED_FEEDBACK_PROMPT_VERSION, CATEGORIZED_FEEDBACK_SELECTION_VERSION } from "../services/reading-feedback-policy.js";

export interface ReadingFeedbackEventPayload {
  request: ReadingFeedbackEventRequest;
  receipt: ReadingFeedbackEventReceipt;
  grant: { consent_id: string; consent_version: number; policy_version: string };
  targets: { fact_ids: string[]; theme_ids: string[] };
}

interface EventRow {
  id: string;
  reading_id: string;
  event_enc: ArrayBuffer;
  event_key_version: number;
  event_nonce: string;
  created_at: string;
  effect_expires_at: string | null;
  retention_expires_at: string;
}

const EVENT_COLUMNS = "f.id,f.reading_id,f.event_enc,f.event_key_version,f.event_nonce,f.created_at,f.effect_expires_at,f.retention_expires_at";
// Bound decryption and target validation independently of the packet's twenty
// admitted feedback records. A candidate rejected later must not spend that
// admission budget. Events beyond this newest-100 window remain unexamined.
const MAX_READING_FEEDBACK_CANDIDATES = 100;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const positiveRevision = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 2_147_483_647;

export function parseReadingFeedbackEventRequest(value: unknown): ReadingFeedbackEventRequest | null {
  if (!object(value) || Object.keys(value).some((key) => ![
    "schema_version", "category", "revision", "content_hash", "paragraph_id", "note",
    "feedback_use_policy_version", "expected_grant_state", "confirm_feedback_use",
  ].includes(key)) || value.schema_version !== "reading-feedback-event/v1" ||
    !READING_FEEDBACK_CATEGORIES.includes(value.category as never) || !positiveRevision(value.revision) || !hash(value.content_hash) ||
    (value.paragraph_id !== undefined && value.paragraph_id !== null && !validId(value.paragraph_id)) ||
    (value.note !== undefined && value.note !== null && (typeof value.note !== "string" || value.note.length > 2000)) ||
    value.feedback_use_policy_version !== READING_FEEDBACK_USE_POLICY_VERSION || value.confirm_feedback_use !== true ||
    typeof value.expected_grant_state !== "string" || !/^feedback-grant:[a-f0-9]{64}$/.test(value.expected_grant_state)) return null;
  return {
    schema_version: "reading-feedback-event/v1", category: value.category as ReadingFeedbackEventRequest["category"],
    revision: value.revision, content_hash: value.content_hash, paragraph_id: value.paragraph_id as string | null | undefined ?? null,
    note: typeof value.note === "string" ? value.note.trim() || null : null,
    feedback_use_policy_version: READING_FEEDBACK_USE_POLICY_VERSION,
    expected_grant_state: value.expected_grant_state, confirm_feedback_use: true,
  };
}

// The exact same SQL snapshot is compared inside the mutation batch before any
// grant creation/renewal. Operational last_signal_id changes do not alter consent.
const GRANT_STATE_SQL = `SELECT json_object(
  'permission', (SELECT json_object('enabled',p.enabled,'state',p.permission_state,'uses',p.allowed_uses_json,
    'tier',p.permission_tier,'consent_id',p.consent_id,'scopes',p.scopes_json,'connector',p.connector_status)
    FROM context_source_permissions p WHERE p.user_id = ? AND p.source_id = 'USR-12'),
  'consent', (SELECT json_object('id',c.id,'kind',c.kind,'source_id',c.source_id,'status',c.status,'version',c.version,
    'uses',c.allowed_uses_json,'tier',c.permission_tier,'policy',c.policy_version,'expires_at',c.expires_at,
    'granted_at',c.granted_at,'revoked_at',c.revoked_at,'paused_at',c.paused_at,'updated_at',c.updated_at)
    FROM context_source_permissions p JOIN consents c ON c.id = p.consent_id AND c.user_id = p.user_id
    WHERE p.user_id = ? AND p.source_id = 'USR-12'),
  'latest', (SELECT json_object('id',id,'version',version) FROM consents
    WHERE user_id = ? AND kind = 'product_source' AND source_id = 'USR-12'
    ORDER BY version DESC,created_at DESC,id DESC LIMIT 1))`;

interface GrantState {
  serialized: string;
  tag: string;
  action: ReadingFeedbackOptionsResponse["grant_action"];
  consentId: string | null;
  consentVersion: number;
  latestId: string | null;
  latestVersion: number;
}

async function loadGrantState(env: Env, userId: string, now: Date): Promise<GrantState> {
  const row = await env.DB.prepare(`${GRANT_STATE_SQL} AS state`).bind(userId, userId, userId).first<{ state: string }>();
  if (!row) throw new Error("feedback grant state unavailable");
  const state = JSON.parse(row.state);
  const p = state.permission;
  const c = state.consent;
  const wantedUses = JSON.stringify(USR12_ALLOWED_USES);
  const active = p && c && p.enabled === 1 && p.state === "active" && p.consent_id === c.id &&
    p.uses === wantedUses && c.uses === wantedUses && p.tier === USR12_PERMISSION_TIER && c.tier === USR12_PERMISSION_TIER &&
    c.kind === "product_source" && c.source_id === "USR-12" && c.status === "granted" && c.policy === USR12_POLICY_VERSION &&
    Number.isInteger(c.version) && c.version > 0 && (!c.expires_at || Date.parse(c.expires_at) > now.getTime());
  const action = active ? "reuse" : p || c || state.latest ? "renew" : "create";
  return {
    serialized: row.state,
    tag: `feedback-grant:${await sha256Hex(canonicalJson({ userId, policy: READING_FEEDBACK_USE_POLICY_VERSION, action, state }))}`,
    action,
    consentId: active ? c.id : null, consentVersion: active ? c.version : 0,
    latestId: state.latest?.id ?? null, latestVersion: state.latest?.version ?? 0,
  };
}

interface ArtifactFence { reading_enc: ArrayBuffer; reading_key_version: number; reading_nonce: string }
async function loadTarget(env: Env, identity: UserIdentity, readingId: string, revision: number, paragraphId: string | null, expectedHash?: string) {
  const fence = await env.DB.prepare(`SELECT reading_enc,reading_key_version,reading_nonce FROM daily_readings
    WHERE id = ? AND user_id = ? AND revision = ? AND reading_enc IS NOT NULL
      AND status IN ('published','superseded','invalidated')`).bind(readingId, identity.userId, revision).first<ArtifactFence>();
  if (!fence) return null;
  const published = await loadReadableReadingById(env, identity, readingId);
  if (!published || published.record.revision !== revision || published.stored.reading.revision !== revision ||
    published.stored.reading.reading_id !== readingId || published.stored.evidence_header.reading_id !== readingId ||
    published.stored.evidence_header.revision !== revision ||
    (paragraphId !== null && !published.stored.reading.paragraphs.some((part) => part.paragraph_id === paragraphId))) return null;
  const contentHash = isStoredReadingV5(published.stored) ? published.stored.evidence_header.content_hash : published.stored.content_hash;
  if (!hash(contentHash) || (expectedHash !== undefined && contentHash !== expectedHash)) return null;
  const target: ReadingFeedbackTarget = { reading_id: readingId, revision, content_hash: contentHash, paragraph_id: paragraphId };
  return { target, fence };
}

async function decryptEvent(env: Env, identity: UserIdentity, row: EventRow, dek?: Uint8Array): Promise<ReadingFeedbackEventPayload> {
  const payload = { key_version: row.event_key_version, nonce: row.event_nonce, ciphertext: b64(row.event_enc) };
  const context = { subject: identity.cryptoSubject, field: "reading_feedback_events.event_enc", recordId: row.id };
  const value = dek ? await decryptJson<ReadingFeedbackEventPayload>(payload, dek, context)
    : await decryptPayload<ReadingFeedbackEventPayload>(env, identity, payload, context);
  const receipt = value?.receipt;
  const request = parseReadingFeedbackEventRequest(value?.request);
  if (!request || !receipt || receipt.schema_version !== "reading-feedback-event-receipt/v1" ||
    receipt.id !== row.id || receipt.target?.reading_id !== row.reading_id ||
    receipt.target.revision !== request.revision || receipt.target.content_hash !== request.content_hash ||
    receipt.target.paragraph_id !== (request.paragraph_id ?? null) || receipt.category !== request.category ||
    receipt.created_at !== row.created_at || receipt.effect_expires_at !== row.effect_expires_at ||
    receipt.retention_expires_at !== row.retention_expires_at || receipt.feedback_use_policy_version !== READING_FEEDBACK_USE_POLICY_VERSION ||
    !value.grant || !validId(value.grant.consent_id) || !positiveRevision(value.grant.consent_version) || value.grant.policy_version !== USR12_POLICY_VERSION ||
    !value.targets || !Array.isArray(value.targets.fact_ids) || !Array.isArray(value.targets.theme_ids) ||
    value.targets.fact_ids.length > 64 || value.targets.theme_ids.length > 64 ||
    [...value.targets.fact_ids, ...value.targets.theme_ids].some((id) => typeof id !== "string" || !id || id.length > 256) ||
    !Number.isFinite(Date.parse(receipt.created_at)) || !Number.isFinite(Date.parse(receipt.retention_expires_at)) ||
    receipt.retention_expires_at !== retentionEnd(new Date(receipt.created_at)) ||
    (receipt.category === "unclear" ? receipt.effect_expires_at !== null :
      Date.parse(receipt.effect_expires_at) !== Date.parse(receipt.created_at) + READING_FEEDBACK_EFFECT_WINDOW_DAYS * 86_400_000)) {
    throw new Error("stored categorical feedback is invalid");
  }
  return value;
}

async function retainedRows(env: Env, identity: UserIdentity, now: Date, candidateLimit?: number): Promise<ReadingFeedbackEventPayload[]> {
  const query = env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM reading_feedback_events f
    JOIN daily_readings r ON r.id = f.reading_id AND r.user_id = f.user_id
    WHERE f.user_id = ? AND f.retention_expires_at > ? AND r.reading_enc IS NOT NULL
      AND r.status IN ('published','superseded','invalidated')
      ${candidateLimit === undefined ? "" : "AND f.effect_expires_at IS NOT NULL AND f.effect_expires_at > ? AND f.created_at <= ?"}
    ORDER BY f.created_at DESC,f.id ${candidateLimit === undefined ? "DESC" : "ASC LIMIT ?"}`);
  const nowIso = now.toISOString();
  const rows = await (candidateLimit === undefined ? query.bind(identity.userId, nowIso) : query.bind(identity.userId, nowIso, nowIso, nowIso, candidateLimit)).all<EventRow>();
  if (rows.results.length === 0) return [];
  // Export reads every retained event; unwrap once rather than spending one D1
  // key lookup per authored response in a multi-year account history.
  const { dek } = await loadUserKey(env, identity);
  const events = await Promise.all(rows.results.map((row) => decryptEvent(env, identity, row, dek)));
  if (candidateLimit === undefined) return events;
  const valid = await Promise.all(events.map(async (event) => {
    const target = event.receipt.target;
    return await loadTarget(env, identity, target.reading_id, target.revision, target.paragraph_id, target.content_hash) ? event : null;
  }));
  return valid.filter((event): event is ReadingFeedbackEventPayload => event !== null);
}

/**
 * Offer all valid targets inside the bounded candidate window in packet order.
 * Category/grant checks follow; the engine then caps admitted feedback across
 * both formats. Never apply its admission cap before those eligibility checks.
 */
export async function loadRetainedReadingFeedbackEvents(env: Env, identity: UserIdentity, now: Date): Promise<ReadingFeedbackEventPayload[]> {
  return retainedRows(env, identity, now, MAX_READING_FEEDBACK_CANDIDATES);
}

/** Execute-time lookup never substitutes a newer event or another edition. */
export async function loadReadingFeedbackEvent(env: Env, identity: UserIdentity, eventId: string, now: Date): Promise<ReadingFeedbackEventPayload | null> {
  const row = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM reading_feedback_events f
    WHERE f.user_id = ? AND f.id = ? AND f.retention_expires_at > ?`)
    .bind(identity.userId, eventId, now.toISOString()).first<EventRow>();
  if (!row) return null;
  const value = await decryptEvent(env, identity, row);
  const target = value.receipt.target;
  return await loadTarget(env, identity, target.reading_id, target.revision, target.paragraph_id, target.content_hash) ? value : null;
}

/** Portability survives revocation and effect expiry; retention still limits it. */
export async function loadReadingFeedbackEventExports(env: Env, identity: UserIdentity, now: Date): Promise<ReadingFeedbackEventExport[]> {
  const events = await retainedRows(env, identity, now);
  return events.map((event) => ({ ...event.receipt, note: event.request.note ?? null }));
}

export async function loadReadingFeedbackOptions(env: Env, identity: UserIdentity, readingId: string, revision: number, paragraphId: string | null, now = new Date()): Promise<ReadingFeedbackOptionsResponse | null> {
  const loaded = await loadTarget(env, identity, readingId, revision, paragraphId);
  if (!loaded) return null;
  const grant = await loadGrantState(env, identity.userId, now);
  const events = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM reading_feedback_events f
    WHERE f.user_id = ? AND f.reading_id = ? AND f.retention_expires_at > ? ORDER BY f.created_at DESC,f.id DESC`)
    .bind(identity.userId, readingId, now.toISOString()).all<EventRow>();
  let latest: ReadingFeedbackEventReceipt | null = null;
  const key = events.results.length ? await loadUserKey(env, identity) : null;
  for (const row of events.results) {
    const event = await decryptEvent(env, identity, row, key!.dek);
    if (canonicalJson(event.receipt.target) === canonicalJson(loaded.target)) { latest = event.receipt; break; }
  }
  const publisher = resolvePublisherConfiguration(env);
  const active = publisher.ok && publisher.config?.pin.prompt_version === CATEGORIZED_FEEDBACK_PROMPT_VERSION &&
    publisher.config.pin.selection_policy_version === CATEGORIZED_FEEDBACK_SELECTION_VERSION;
  return {
    schema_version: "reading-feedback-options/v1", target: loaded.target,
    feedback_use_policy_version: READING_FEEDBACK_USE_POLICY_VERSION, expected_grant_state: grant.tag,
    grant_action: grant.action, categories: [...READING_FEEDBACK_CATEGORIES],
    effect_window_days: READING_FEEDBACK_EFFECT_WINDOW_DAYS, retention_months: READING_FEEDBACK_RETENTION_MONTHS,
    generation_effects_active: !!active, latest_event: latest,
  };
}

type StoreOutcome = { ok: true; receipt: ReadingFeedbackEventReceipt } | { ok: false; reason: "missing_idempotency_key" | "reading_not_found" | "idempotency_conflict" | "feedback_use_changed" };

async function replayEvent(env: Env, identity: UserIdentity, readingId: string, key: string, request: ReadingFeedbackEventRequest, now: Date): Promise<StoreOutcome | null> {
  const row = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM reading_feedback_events f WHERE f.user_id = ? AND f.idempotency_key = ?`)
    .bind(identity.userId, key).first<EventRow>();
  if (!row) return null;
  if (row.retention_expires_at <= now.toISOString()) return { ok: false, reason: "idempotency_conflict" };
  const stored = await decryptEvent(env, identity, row);
  if (row.reading_id !== readingId || canonicalJson(stored.request) !== canonicalJson(request)) return { ok: false, reason: "idempotency_conflict" };
  const target = stored.receipt.target;
  return await loadTarget(env, identity, target.reading_id, target.revision, target.paragraph_id, target.content_hash)
    ? { ok: true, receipt: stored.receipt } : { ok: false, reason: "reading_not_found" };
}

function retentionEnd(now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + READING_FEEDBACK_RETENTION_MONTHS, 1));
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(now.getUTCDate(), last));
  start.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
  return start.toISOString();
}

async function supportedTargets(env: Env, identity: UserIdentity, target: ReadingFeedbackTarget): Promise<ReadingFeedbackEventPayload["targets"]> {
  // An old readable artifact may have no surviving usable associations. Store
  // the response without reconstructing them from labels, note prose or a chart.
  try {
    const evidence = await loadReadingEvidence(env, identity, target.reading_id);
    if (!evidence || evidence.record.revision !== target.revision) return { fact_ids: [], theme_ids: [] };
    const factIds = evidence.schemaVersion === "0.5.0"
      ? evidence.paragraphs.filter((part) => target.paragraph_id === null || part.paragraph_id === target.paragraph_id).flatMap((part) => part.fact_refs.map((ref) => ref.fact_id))
      : evidence.paragraphs.filter((part) => target.paragraph_id === null || part.paragraph_id === target.paragraph_id).flatMap((part) => part.facts.map((ref) => ref.id));
    // These evidence formats retain calculated fact references, not theme IDs.
    const ids = [...new Set(factIds)].sort();
    return { fact_ids: ids.length <= 64 && ids.every((id) => id.length <= 256) ? ids : [], theme_ids: [] };
  } catch { return { fact_ids: [], theme_ids: [] }; }
}

export async function storeReadingFeedbackEvent(env: Env, identity: UserIdentity, readingId: string, idempotencyKey: string | null, request: ReadingFeedbackEventRequest, now = new Date()): Promise<StoreOutcome> {
  if (!idempotencyKey || !requireIdempotencyKey(idempotencyKey)) return { ok: false, reason: "missing_idempotency_key" };
  const replay = await replayEvent(env, identity, readingId, idempotencyKey, request, now);
  if (replay) return replay;
  const loaded = await loadTarget(env, identity, readingId, request.revision, request.paragraph_id ?? null, request.content_hash);
  if (!loaded) return { ok: false, reason: "reading_not_found" };
  const grant = await loadGrantState(env, identity.userId, now);
  if (grant.tag !== request.expected_grant_state) {
    // A same-key first submission may have committed the event and changed the
    // grant since our opening replay read. Its receipt wins without a renewal.
    return await replayEvent(env, identity, readingId, idempotencyKey, request, now)
      ?? { ok: false, reason: "feedback_use_changed" };
  }
  const id = newId("rfe");
  const createdAt = now.toISOString();
  const receipt: ReadingFeedbackEventReceipt = {
    schema_version: "reading-feedback-event-receipt/v1", id, target: loaded.target, created_at: createdAt,
    retention_expires_at: retentionEnd(now), feedback_use_policy_version: READING_FEEDBACK_USE_POLICY_VERSION,
    ...(request.category === "unclear" ? { category: "unclear", effect_expires_at: null } : {
      category: request.category, effect_expires_at: new Date(now.getTime() + READING_FEEDBACK_EFFECT_WINDOW_DAYS * 86_400_000).toISOString(),
    }),
  };
  const consentId = grant.consentId ?? newId("cns");
  const consentVersion = grant.consentId ? grant.consentVersion : grant.latestVersion + 1;
  const payload: ReadingFeedbackEventPayload = {
    request, receipt, grant: { consent_id: consentId, consent_version: consentVersion, policy_version: USR12_POLICY_VERSION },
    targets: await supportedTargets(env, identity, loaded.target),
  };
  const sealed = await encryptPayload(env, identity, payload, { subject: identity.cryptoSubject, field: "reading_feedback_events.event_enc", recordId: id });
  const statements = [
    buildCryptoWriteFence(env, { userId: identity.userId, keyVersion: sealed.keyVersion, allowedStatuses: ["active"] }),
    env.DB.prepare(`INSERT INTO assertion_probe (id,reason) SELECT 1,'feedback grant changed' WHERE (${GRANT_STATE_SQL}) != ?`)
      .bind(identity.userId, identity.userId, identity.userId, grant.serialized),
    env.DB.prepare(`INSERT INTO assertion_probe (id,reason) SELECT 1,'feedback artifact changed' WHERE NOT EXISTS (
      SELECT 1 FROM daily_readings WHERE id = ? AND user_id = ? AND revision = ?
        AND status IN ('published','superseded','invalidated') AND reading_enc = ? AND reading_key_version = ? AND reading_nonce = ?)`)
      .bind(readingId, identity.userId, request.revision, loaded.fence.reading_enc, loaded.fence.reading_key_version, loaded.fence.reading_nonce),
  ];
  if (!grant.consentId) {
    statements.push(env.DB.prepare(`INSERT INTO consents (id,user_id,kind,status,source_id,permission_tier,allowed_uses_json,scopes_json,policy_version,
      ui_surface,granted_at,version,supersedes_consent_id,created_at,updated_at)
      VALUES (?,?,'product_source','granted','USR-12',?,?,'[]',?,'reading_feedback',?,?,?,?,?)`)
      .bind(consentId, identity.userId, USR12_PERMISSION_TIER, JSON.stringify(USR12_ALLOWED_USES), USR12_POLICY_VERSION,
        createdAt, consentVersion, grant.latestId, createdAt, createdAt));
    statements.push(env.DB.prepare(`INSERT INTO context_source_permissions (user_id,source_id,enabled,permission_state,allowed_uses_json,
      permission_tier,consent_id,scopes_json,connector_status,last_signal_id,updated_at)
      VALUES (?,'USR-12',1,'active',?,?,?,'[]','not_applicable',NULL,?)
      ON CONFLICT(user_id,source_id) DO UPDATE SET enabled=1,permission_state='active',allowed_uses_json=excluded.allowed_uses_json,
        permission_tier=excluded.permission_tier,consent_id=excluded.consent_id,scopes_json=excluded.scopes_json,
        connector_status=excluded.connector_status,updated_at=excluded.updated_at`)
      .bind(identity.userId, JSON.stringify(USR12_ALLOWED_USES), USR12_PERMISSION_TIER, consentId, createdAt));
  }
  statements.push(env.DB.prepare(`INSERT INTO reading_feedback_events
    (id,user_id,reading_id,idempotency_key,event_enc,event_key_version,event_nonce,created_at,effect_expires_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, identity.userId, readingId, idempotencyKey, fromB64(sealed.ciphertext), sealed.keyVersion,
    sealed.nonce, createdAt, receipt.effect_expires_at, receipt.retention_expires_at));
  statements.push(env.DB.prepare(`UPDATE context_source_permissions SET last_signal_id = ?,updated_at = ?
    WHERE user_id = ? AND source_id = 'USR-12' AND consent_id = ?`).bind(id, createdAt, identity.userId, consentId));
  try { await env.DB.batch(statements); }
  catch {
    const raced = await replayEvent(env, identity, readingId, idempotencyKey, request, now);
    if (raced) return raced;
    if ((await loadGrantState(env, identity.userId, now)).tag !== request.expected_grant_state) return { ok: false, reason: "feedback_use_changed" };
    if (!(await loadTarget(env, identity, readingId, request.revision, request.paragraph_id ?? null, request.content_hash))) return { ok: false, reason: "reading_not_found" };
    throw new Error("categorical feedback transaction did not commit");
  }
  return { ok: true, receipt };
}
