import type { Env } from "../env.js";
import {
  OntologyCorpusError,
  ontologyCorpusObjectKey,
  readStoredOntologyCorpusManifest,
  type OntologyCorpusLicenseClass,
} from "./ontology-corpus.js";

/**
 * Compatibility boundary for the already-landed ingestion verifier. The
 * canonical schema/hash/license reader is owned by ontology-corpus.ts; keeping
 * this adapter thin prevents ingestion and runtime corpus rules drifting.
 */
export type VerifiedCorpusLicenseClass = OntologyCorpusLicenseClass;

export interface VerifiedPatternOntologyCorpus {
  releaseId: string;
  releaseHash: string;
  locale: string;
  licenseClass: VerifiedCorpusLicenseClass;
  publicCapable: boolean;
  objectKey: string;
}

export { OntologyCorpusError as PatternOntologyCorpusError };

export function patternOntologyCorpusObjectKey(releaseId: string): string {
  return ontologyCorpusObjectKey(releaseId);
}

export async function readVerifiedPatternOntologyCorpus(
  env: Env,
  releaseId: string,
): Promise<VerifiedPatternOntologyCorpus> {
  const corpus = await readStoredOntologyCorpusManifest(env, releaseId);
  return {
    releaseId: corpus.release.corpus_release_id,
    releaseHash: corpus.release.corpus_hash,
    locale: corpus.release.locale,
    licenseClass: corpus.licenseClass,
    publicCapable: corpus.publicCapable,
    objectKey: corpus.objectKey,
  };
}
