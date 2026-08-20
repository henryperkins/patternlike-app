import {
  canonicalJson,
  contentHash,
  type PatternTransformationClass,
} from "@patternlike/shared";

export type TestCorpusLicenseClass =
  | "licensed_excerpt"
  | "internal_synthetic";

export interface TestCorpusManifest {
  schema_version: "0.7.0";
  corpus_release_id: string;
  corpus_hash: string;
  locale: string;
  license_resolved: true;
  fragments: Array<{
    id: string;
    corpus_release_id: string;
    locale: string;
    normalized_proposition: string;
    excerpt: string;
    license_class: TestCorpusLicenseClass;
    allowed_transformations: PatternTransformationClass[];
  }>;
}

export interface TestEvaluationArtifactEnvelope {
  schema_version: "ontology-evaluation-artifact/v1";
  artifact_class: "evaluation_report";
  run_id: string;
  ontology_version: string;
  plaintext_hash: string;
  ciphertext_hash: string;
  encryption: {
    alg: "AES-256-GCM";
    key_id: string;
    nonce: string;
  };
  ciphertext: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function buildTestCorpusManifest(
  corpusReleaseId: string,
  locale: string,
  licenseClass: TestCorpusLicenseClass,
): Promise<TestCorpusManifest> {
  const body = {
    schema_version: "0.7.0" as const,
    corpus_release_id: corpusReleaseId,
    locale,
    license_resolved: true as const,
    fragments: [
      {
        id: `srcf_${"b".repeat(32)}`,
        corpus_release_id: corpusReleaseId,
        locale,
        normalized_proposition:
          "A source-backed proposition used only by the ontology pipeline tests.",
        excerpt: "A licensed test excerpt with a closed source identity.",
        license_class: licenseClass,
        allowed_transformations: [
          "intersection" as PatternTransformationClass,
        ],
      },
    ],
  };
  return {
    ...body,
    corpus_hash: await contentHash(canonicalJson(body)),
  };
}

export async function putTestCorpusManifest(
  bucket: R2Bucket,
  manifest: TestCorpusManifest,
  bytes = canonicalJson(manifest),
): Promise<string> {
  const objectKey =
    `pattern-ontology-corpora/${manifest.corpus_release_id}.json`;
  await bucket.put(objectKey, bytes);
  return objectKey;
}

export async function buildTestEvaluationArtifact(
  runId: string,
  ontologyVersion: string,
  evaluationReport: string,
): Promise<{
  envelope: TestEvaluationArtifactEnvelope;
  bytes: string;
  envelopeHash: string;
  ciphertextHash: string;
  plaintextHash: string;
}> {
  const plaintextHash = await contentHash(evaluationReport);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = (await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  )) as CryptoKey;
  const authenticatedIdentity = canonicalJson({
    artifact_class: "evaluation_report",
    ontology_version: ontologyVersion,
    plaintext_hash: plaintextHash,
    run_id: runId,
  });
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: new TextEncoder().encode(authenticatedIdentity),
      },
      key,
      new TextEncoder().encode(evaluationReport),
    ),
  );
  const ciphertextHash = await hashBytes(ciphertext);
  const envelope: TestEvaluationArtifactEnvelope = {
    schema_version: "ontology-evaluation-artifact/v1",
    artifact_class: "evaluation_report",
    run_id: runId,
    ontology_version: ontologyVersion,
    plaintext_hash: plaintextHash,
    ciphertext_hash: ciphertextHash,
    encryption: {
      alg: "AES-256-GCM",
      key_id: "test-evaluation-envelope-key",
      nonce: toBase64Url(nonce),
    },
    ciphertext: toBase64Url(ciphertext),
  };
  const bytes = canonicalJson(envelope);
  return {
    envelope,
    bytes,
    envelopeHash: await contentHash(bytes),
    ciphertextHash,
    plaintextHash,
  };
}

export async function putTestEvaluationArtifact(
  bucket: R2Bucket,
  runId: string,
  bytes: string,
): Promise<string> {
  const objectKey =
    `pattern-ontology/pipeline/${runId}/evaluation-report.enc`;
  await bucket.put(objectKey, bytes);
  return objectKey;
}
