import { newId, type ReaderRelationshipSupport } from "@patternlike/shared";
import { b64 } from "../crypto.js";
import type { Env } from "../env.js";
import { decryptPayload, encryptPayload, type UserIdentity } from "./users.js";

export interface ReaderRelationshipDocument {
  documentKind: "daily" | "pattern";
  documentId: string;
  revisionKey: string;
  contentHash: string;
}

export interface PreparedReaderRelationshipSupport extends ReaderRelationshipDocument {
  id: string;
  userId: string;
  ciphertext: Uint8Array;
  keyVersion: number;
  nonce: string;
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const instant = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const hash = (value: unknown): value is string => text(value) && /^(?:sha256:)?[a-f0-9]{64}$/.test(value);

/** Reject corrupt payloads and coordinates from another edition before use. */
export function isReaderRelationshipSupport(
  value: unknown,
  document: ReaderRelationshipDocument,
): value is ReaderRelationshipSupport {
  if (!text(document.documentId) || !text(document.revisionKey) || !hash(document.contentHash) ||
    !object(value) || value.schema_version !== "reader-relationship-support/v1" ||
    !Array.isArray(value.units) || value.units.length > 64) return false;
  const coordinates = new Set<string>();
  return value.units.every((unit) => {
    if (!object(unit) || typeof unit.eligible !== "boolean" ||
      !["exact", "approximate", "unknown"].includes(String(unit.birth_time)) ||
      !Array.isArray(unit.features) || !Array.isArray(unit.participants) ||
      unit.features.length > 1024 || unit.participants.length > 128 || !object(unit.target)) return false;
    const target = unit.target;
    if (target.kind !== document.documentKind || target.content_hash !== document.contentHash) return false;
    if (target.kind === "daily") {
      if (target.reading_id !== document.documentId || String(target.revision) !== document.revisionKey ||
        !Number.isInteger(target.revision) || Number(target.revision) < 1 || !text(target.paragraph_id)) return false;
    } else if (target.pattern_id !== document.documentId || target.document_revision !== document.revisionKey ||
      !Number.isInteger(target.chapter_index) || Number(target.chapter_index) < 0 || !hash(target.chapter_source_sha256)) return false;
    const key = target.kind === "daily" ? String(target.paragraph_id) : String(target.chapter_index);
    if (coordinates.has(key)) return false;
    coordinates.add(key);
    if (!unit.features.every((feature) => object(feature) && hash(feature.chart) && text(feature.policy) &&
      ["natal_position", "natal_aspect", "natal_house", "transit_aspect"].includes(String(feature.kind)) &&
      ["tropical_geocentric", "sidereal_geocentric"].includes(String(feature.frame)) &&
      text(feature.coordinate) && text(feature.uncertainty_policy) && typeof feature.requires_birth_time === "boolean" &&
      Array.isArray(feature.participants) && feature.participants.length > 0 && feature.participants.every((participant) =>
        object(participant) && text(participant.body) &&
        ["natal_subject", "natal_object", "transiting", "natal_target"].includes(String(participant.role))))) return false;
    if (!unit.participants.every((participant) => object(participant) && hash(participant.chart) && text(participant.body) &&
      text(participant.policy) && ["tropical_geocentric", "sidereal_geocentric"].includes(String(participant.frame)) &&
      ["natal_interpretation", "transit_target"].includes(String(participant.role)) &&
      typeof participant.requires_birth_time === "boolean")) return false;
    if (unit.day !== undefined && (!object(unit.day) || !hash(unit.day.chart) || !text(unit.day.local_date) ||
      !text(unit.day.time_zone) || !instant(unit.day.starts_at) || !instant(unit.day.ends_at) ||
      Date.parse(unit.day.starts_at) >= Date.parse(unit.day.ends_at))) return false;
    if (unit.cycle_refs !== undefined && (!Array.isArray(unit.cycle_refs) || unit.cycle_refs.length > 1024 ||
      !unit.cycle_refs.every((cycle) => object(cycle) && cycle.kind === "timing" && text(cycle.cycle_id) &&
        hash(cycle.cycle_hash) && Number.isInteger(cycle.pass_index) && Number(cycle.pass_index) >= 1 &&
        instant(cycle.starts_at) && instant(cycle.ends_at) && instant(cycle.exact_at) &&
        Date.parse(cycle.starts_at) <= Date.parse(cycle.exact_at) && Date.parse(cycle.exact_at) <= Date.parse(cycle.ends_at) &&
        text(cycle.local_date) && text(cycle.time_zone) && text(cycle.policy_version)))) return false;
    return true;
  });
}

export async function prepareReaderRelationshipSupport(
  env: Env,
  identity: UserIdentity,
  input: ReaderRelationshipDocument & { support: ReaderRelationshipSupport },
): Promise<PreparedReaderRelationshipSupport> {
  if (!isReaderRelationshipSupport(input.support, input)) throw new Error("Invalid reader relationship support");
  const id = newId("rrs");
  const document: ReaderRelationshipDocument = {
    documentKind: input.documentKind, documentId: input.documentId,
    revisionKey: input.revisionKey, contentHash: input.contentHash,
  };
  const sealed = await encryptPayload(env, identity, { document, support: input.support }, {
    subject: identity.cryptoSubject, field: "reader_relationship_supports.support_enc", recordId: id,
  });
  return {
    id, userId: identity.userId, documentKind: input.documentKind, documentId: input.documentId,
    revisionKey: input.revisionKey, contentHash: input.contentHash,
    ciphertext: Uint8Array.from(atob(sealed.ciphertext), (character) => character.charCodeAt(0)),
    keyVersion: sealed.keyVersion, nonce: sealed.nonce,
  };
}

/** The caller includes this statement in the document's guarded publication batch. */
export function buildReaderRelationshipSupportInsert(
  env: Env,
  row: PreparedReaderRelationshipSupport,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO reader_relationship_supports
      (id, user_id, document_kind, document_id, reading_id, pattern_id,
       support_enc, support_key_version, support_nonce, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.userId, row.documentKind, row.documentId,
    row.documentKind === "daily" ? row.documentId : null,
    row.documentKind === "pattern" ? row.documentId : null,
    row.ciphertext, row.keyVersion, row.nonce, now);
}

/** Caller authorizes the exact document; absent historical support stays absent. */
export async function loadReaderRelationshipSupport(
  env: Env,
  identity: UserIdentity,
  document: ReaderRelationshipDocument,
): Promise<ReaderRelationshipSupport | null> {
  const row = await env.DB.prepare(
    `SELECT id, support_enc, support_key_version, support_nonce FROM reader_relationship_supports
     WHERE user_id = ? AND document_kind = ? AND document_id = ?`,
  ).bind(identity.userId, document.documentKind, document.documentId)
    .first<{ id: string; support_enc: ArrayBuffer; support_key_version: number; support_nonce: string }>();
  if (!row) return null;
  try {
    const value = await decryptPayload(env, identity, {
      key_version: row.support_key_version, nonce: row.support_nonce, ciphertext: b64(row.support_enc),
    }, { subject: identity.cryptoSubject, field: "reader_relationship_supports.support_enc", recordId: row.id });
    if (!object(value) || !object(value.document) || value.document.documentKind !== document.documentKind ||
      value.document.documentId !== document.documentId || value.document.revisionKey !== document.revisionKey ||
      value.document.contentHash !== document.contentHash) return null;
    return isReaderRelationshipSupport(value.support, document) ? value.support : null;
  } catch {
    return null;
  }
}
