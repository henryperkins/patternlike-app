import {
  canonicalJson,
  contentHash,
  type PatternTransformationClass,
} from "@patternlike/shared";
import authoredOntologyFragments from "../../../pattern-corpus/fragments.json";
import {
  createCanonicalOntologyRegressionReport,
  loadOntologyRegressionCorpus,
  ontologyRegressionConfigurationHash,
} from "../src/services/ontology-regression.js";

export const APPROVED_COVERAGE_HINT_CORPUS_RELEASE_ID =
  "pattern-ontology-source-manual-en-us-0.1.0";
export const APPROVED_COVERAGE_HINT_CORPUS_HASH =
  "sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c";
export const APPROVED_COVERAGE_HINT_FRAGMENT_IDS = {
  sun: "srcf_32312edcef85aa77ffee8fa6b723e165",
  moon: "srcf_78d2386c07e8152516a2a23aa54d7b0c",
  conjunction: "srcf_73dbb8b5679edd15e4da92f778961c3b",
  square: "srcf_240e363f233eb6e45d14c724fc1f7761",
  trine: "srcf_69a4979a0e67ea57ba9ca26128adddaa",
  sextile: "srcf_505836d6affe1a481f59d42dfd80f78e",
  stellium: "srcf_70a53d65d1e84c127bd1249147a880d9",
  uncertainty: "srcf_c063ee9a41d23b5640ad360d5e4a265f",
} as const;
export const APPROVED_COVERAGE_HINT_FRAGMENT_ID =
  APPROVED_COVERAGE_HINT_FRAGMENT_IDS.stellium;

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
    title?: string;
    author?: string;
    edition?: string;
    location?: string;
    exclusions?: string[];
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

export interface TestEvaluationArtifactOptions {
  keyId?: string;
  rawKey?: Uint8Array;
  nonce?: Uint8Array;
  additionalData?: string;
  declaredPlaintextHash?: string;
}

export const TEST_ONTOLOGY_PIPELINE_ARTIFACT_KEY_ID =
  "test-evaluation-envelope-key";

export async function buildTestPassedRegressionReport(input: {
  ontologyVersion: string;
  commandHash: string;
  corpusReleaseId: string;
  corpusHash: string;
  candidateHash: string;
  evaluationReportHash: string;
  publisher?: "openai" | "codex";
}): Promise<{
  document: Record<string, unknown>;
  canonicalBytes: string;
  plaintextHash: string;
  configurationHash: string;
}> {
  const corpus = loadOntologyRegressionCorpus();
  const configurationHash = await ontologyRegressionConfigurationHash(
    input.publisher ?? "openai",
  );
  const results = corpus.fixtures.map((fixture, index) => ({
    fixture_id: fixture.fixture_id,
    accuracy: fixture.effective_accuracy,
    accepted: true,
    declared_outcome: fixture.declared_outcome,
    result_hash: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
    provider_calls: 3,
    input_tokens: 10,
    output_tokens: 10,
    hard_gate_failures: [],
  }));
  const report = await createCanonicalOntologyRegressionReport({
    ontologyVersion: input.ontologyVersion,
    commandHash: input.commandHash,
    configurationHash,
    corpusReleaseId: input.corpusReleaseId,
    corpusHash: input.corpusHash,
    corpusManifestHash: corpus.manifest_hash,
    candidateHash: input.candidateHash,
    evaluationReportHash: input.evaluationReportHash,
    configurationEqual: true,
    results,
    requestArtifactCount: 90,
    responseArtifactCount: 90,
    inputTokens: 300,
    outputTokens: 300,
  });
  return { ...report, configurationHash };
}

const TEST_ONTOLOGY_PIPELINE_ARTIFACT_KEY = Uint8Array.from(
  { length: 32 },
  (_, index) => index,
);

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function testOntologyPipelineArtifactKeyring(
  keyId = TEST_ONTOLOGY_PIPELINE_ARTIFACT_KEY_ID,
  rawKey = TEST_ONTOLOGY_PIPELINE_ARTIFACT_KEY,
): string {
  return JSON.stringify({
    version: 1,
    keys: {
      [keyId]: toBase64Url(rawKey),
    },
  });
}

export function buildTestEvaluationReport(
  ontologyVersion: string,
  overrides: Record<string, unknown> = {},
): string {
  return canonicalJson({
    compiler_passed: true,
    evaluator_passed: true,
    ontology_version: ontologyVersion,
    schema_version: "0.7.0",
    unevaluated_fixture_count: 0,
    ...overrides,
  });
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

async function sourceFragmentId(
  corpusReleaseId: string,
  reference: string,
): Promise<string> {
  const identity = [
    "pattern-source-fragment-v1",
    corpusReleaseId,
    reference,
  ].join("\n");
  return `srcf_${(await contentHash(identity)).slice("sha256:".length, 39)}`;
}

/** Build the checked-in authorized corpus without asserting or logging prose. */
export async function buildApprovedCoverageHintCorpusManifest(): Promise<
  TestCorpusManifest
> {
  const authored = [...authoredOntologyFragments].sort((left, right) =>
    left.ref.localeCompare(right.ref)
  );
  const fragments = await Promise.all(authored.map(async (fragment) => ({
    id: await sourceFragmentId(
      APPROVED_COVERAGE_HINT_CORPUS_RELEASE_ID,
      fragment.ref,
    ),
    corpus_release_id: APPROVED_COVERAGE_HINT_CORPUS_RELEASE_ID,
    locale: fragment.locale,
    title: fragment.title,
    author: fragment.author,
    edition: fragment.edition,
    location: fragment.location,
    exclusions: [...fragment.exclusions],
    normalized_proposition: fragment.normalized_proposition,
    excerpt: fragment.excerpt,
    license_class: fragment.license_class as TestCorpusLicenseClass,
    allowed_transformations:
      [...fragment.allowed_transformations] as PatternTransformationClass[],
  })));
  const body = {
    schema_version: "0.7.0" as const,
    corpus_release_id: APPROVED_COVERAGE_HINT_CORPUS_RELEASE_ID,
    locale: "en-US",
    license_resolved: true as const,
    fragments,
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
  options: TestEvaluationArtifactOptions = {},
): Promise<{
  envelope: TestEvaluationArtifactEnvelope;
  bytes: string;
  envelopeHash: string;
  ciphertextHash: string;
  plaintextHash: string;
}> {
  const plaintextHash =
    options.declaredPlaintextHash ?? await contentHash(evaluationReport);
  const nonce =
    options.nonce ?? crypto.getRandomValues(new Uint8Array(12));
  const keyId =
    options.keyId ?? TEST_ONTOLOGY_PIPELINE_ARTIFACT_KEY_ID;
  const key = await crypto.subtle.importKey(
    "raw",
    options.rawKey ?? TEST_ONTOLOGY_PIPELINE_ARTIFACT_KEY,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const nonceBase64Url = toBase64Url(nonce);
  // This exactly mirrors the production AAD. ciphertext_hash is intentionally
  // absent because it cannot be known until after encryption.
  const authenticatedIdentity =
    options.additionalData ?? canonicalJson({
      artifact_class: "evaluation_report",
      encryption: {
        key_id: keyId,
        nonce: nonceBase64Url,
      },
      ontology_version: ontologyVersion,
      plaintext_hash: plaintextHash,
      run_id: runId,
      schema_version: "ontology-evaluation-artifact/v1",
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
      key_id: keyId,
      nonce: nonceBase64Url,
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
