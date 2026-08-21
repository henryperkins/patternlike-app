import type { Env } from "../env.js";

export type RegisteredCorpusLicenseClass =
  | "licensed_excerpt"
  | "internal_synthetic";

export interface RegisteredOntologyCorpusRow {
  corpus_release_id: string;
  corpus_hash: string;
  locale: string;
  object_key: string;
  fragment_count: number;
  license_class: RegisteredCorpusLicenseClass;
  public_capable: number;
  created_at: string;
  registered_at: string;
}

export interface RegisteredOntologyCorpusIdentity {
  corpusReleaseId: string;
  corpusHash: string;
  locale: string;
  objectKey: string;
  fragmentCount: number;
  licenseClass: RegisteredCorpusLicenseClass;
  publicCapable: boolean;
}

const SELECT_COLUMNS = `corpus_release_id, corpus_hash, locale, object_key,
  fragment_count, license_class, public_capable, created_at, registered_at`;

/**
 * All three values are immutable UNIQUE identities. Looking up their union is
 * intentional: a caller cannot reuse the same canonical corpus under a new id
 * and report it as an unrelated conflict-free registration.
 */
export async function findRegisteredOntologyCorpusIdentity(
  env: Env,
  identity: Pick<
    RegisteredOntologyCorpusIdentity,
    "corpusReleaseId" | "corpusHash" | "objectKey"
  >,
): Promise<RegisteredOntologyCorpusRow | null> {
  return env.DB.prepare(
    `SELECT ${SELECT_COLUMNS}
     FROM pattern_source_corpus_releases
     WHERE corpus_release_id = ? OR corpus_hash = ? OR object_key = ?
     ORDER BY CASE WHEN corpus_release_id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
  )
    .bind(
      identity.corpusReleaseId,
      identity.corpusHash,
      identity.objectKey,
      identity.corpusReleaseId,
    )
    .first<RegisteredOntologyCorpusRow>();
}

export async function findRegisteredOntologyCorpus(
  env: Env,
  corpusReleaseId: string,
): Promise<RegisteredOntologyCorpusRow | null> {
  return env.DB.prepare(
    `SELECT ${SELECT_COLUMNS}
     FROM pattern_source_corpus_releases
     WHERE corpus_release_id = ?`,
  )
    .bind(corpusReleaseId)
    .first<RegisteredOntologyCorpusRow>();
}

export function registeredOntologyCorpusMatches(
  row: RegisteredOntologyCorpusRow,
  identity: RegisteredOntologyCorpusIdentity,
): boolean {
  return (
    row.corpus_release_id === identity.corpusReleaseId &&
    row.corpus_hash === identity.corpusHash &&
    row.locale === identity.locale &&
    row.object_key === identity.objectKey &&
    row.fragment_count === identity.fragmentCount &&
    row.license_class === identity.licenseClass &&
    row.public_capable === (identity.publicCapable ? 1 : 0)
  );
}

/**
 * This deliberately remains a plain INSERT. The migration owns the immutable
 * identity guard, while callers recover a duplicate only after comparing every
 * immutable field in the stored row.
 */
export async function insertRegisteredOntologyCorpus(
  env: Env,
  identity: RegisteredOntologyCorpusIdentity,
  now = new Date().toISOString(),
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pattern_source_corpus_releases (
       corpus_release_id, corpus_hash, locale, object_key, fragment_count,
       license_class, public_capable, created_at, registered_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      identity.corpusReleaseId,
      identity.corpusHash,
      identity.locale,
      identity.objectKey,
      identity.fragmentCount,
      identity.licenseClass,
      identity.publicCapable ? 1 : 0,
      now,
      now,
    )
    .run();
}
