import { env } from "cloudflare:test";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import type { PatternOntologyRelease } from "@patternlike/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import {
  computeOntologyBundleHash,
  ontologySigningPayload,
} from "./pattern-ontology-verify.js";
import {
  OntologySigningClientError,
  signOntologyCandidate,
  type OntologySignerBinding,
  type OntologySigningRequest,
} from "./ontology-signing-client.js";

type Assert<T extends true> = T;
type ApiEnvExcludesSigningSecret = Assert<
  "PATTERN_ONTOLOGY_SIGNING_KEY" extends keyof Env ? false : true
>;
const API_ENV_EXCLUDES_SIGNING_SECRET: ApiEnvExcludesSigningSecret = true;

type MachineRelease = PatternOntologyRelease & {
  provenance: { origin: "machine_pipeline" };
  evaluation: PatternOntologyRelease["evaluation"] & {
    evaluation_report_hash?: string;
    regression_report_hash?: string;
  };
};

class CapturingSigner implements OntologySignerBinding {
  calls: OntologySigningRequest[] = [];

  async signOntology(request: OntologySigningRequest) {
    this.calls.push(request);
    return {
      ok: true as const,
      signature: {
        alg: "Ed25519" as const,
        key_id: request.key_id,
        signature: "dGVzdC1zaWduYXR1cmU",
        signed_payload_hash: request.payload_hash,
      },
    };
  }
}

async function machineRelease(version = "ontology-machine-client-1"): Promise<MachineRelease> {
  const release = syntheticOntologyRelease(version) as MachineRelease;
  release.provenance = { origin: "machine_pipeline" };
  release.evaluation.evaluation_report_hash = `sha256:${"e".repeat(64)}`;
  // Critical override: these fields remain signed contract bytes, but neither
  // one participates in admission to the signing boundary.
  release.evaluation.regression_passed = false;
  release.evaluation.regression_report_hash = `sha256:${"f".repeat(64)}`;
  release.bundle_hash = await computeOntologyBundleHash(release);
  return release;
}

describe("ontology signing client", () => {
  beforeEach(() => {
    void API_ENV_EXCLUDES_SIGNING_SECRET;
  });

  it("keeps the signing secret out of the API Env while exposing the service binding", () => {
    expect("PATTERN_ONTOLOGY_SIGNING_KEY" in env).toBe(false);
    expect(env.ONTOLOGY_SIGNER).toBeDefined();
  });

  it("sends only canonical payload, frozen hash, and allowed key id", async () => {
    const release = await machineRelease();
    const signer = new CapturingSigner();

    const signature = await signOntologyCandidate(signer, release, "ontology-key-2026");

    const payload = ontologySigningPayload(release);
    expect(signer.calls).toEqual([
      {
        payload,
        payload_hash: release.bundle_hash,
        key_id: "ontology-key-2026",
      },
    ]);
    expect(signature).toEqual({
      alg: "Ed25519",
      key_id: "ontology-key-2026",
      signature: "dGVzdC1zaWduYXR1cmU",
      signed_payload_hash: release.bundle_hash,
    });
  });

  it("does not consult regression results before signing", async () => {
    const release = await machineRelease();
    release.evaluation.regression_passed = false;
    delete release.evaluation.regression_report_hash;
    release.bundle_hash = await computeOntologyBundleHash(release);
    const signer = new CapturingSigner();

    await expect(
      signOntologyCandidate(signer, release, "ontology-key-2026"),
    ).resolves.toEqual(expect.objectContaining({ key_id: "ontology-key-2026" }));
    expect(signer.calls).toHaveLength(1);
  });

  it("refuses a candidate that does not pass the deterministic compiler", async () => {
    const release = await machineRelease();
    release.evaluation.verdict = "reject";
    release.bundle_hash = await computeOntologyBundleHash(release);
    const signer = new CapturingSigner();

    await expect(
      signOntologyCandidate(signer, release, "ontology-key-2026"),
    ).rejects.toMatchObject({ code: "ontology_compiler_failed" });
    expect(signer.calls).toEqual([]);
  });

  it("refuses a candidate that did not pass independent evaluation", async () => {
    const release = await machineRelease();
    release.evaluation.evaluator_passed = false;
    release.bundle_hash = await computeOntologyBundleHash(release);
    const signer = new CapturingSigner();

    await expect(
      signOntologyCandidate(signer, release, "ontology-key-2026"),
    ).rejects.toMatchObject({ code: "ontology_evaluator_failed" });
    expect(signer.calls).toEqual([]);
  });

  it("refuses an unfrozen evaluation report hash", async () => {
    const release = await machineRelease();
    delete release.evaluation.evaluation_report_hash;
    release.bundle_hash = await computeOntologyBundleHash(release);
    const signer = new CapturingSigner();

    await expect(
      signOntologyCandidate(signer, release, "ontology-key-2026"),
    ).rejects.toMatchObject({ code: "ontology_evaluation_report_uncommitted" });
    expect(signer.calls).toEqual([]);
  });

  it("refuses a non-machine release at the pipeline signing seam", async () => {
    const release = await machineRelease();
    release.provenance = { origin: "synthetic_internal" } as MachineRelease["provenance"];
    release.bundle_hash = await computeOntologyBundleHash(release);
    const signer = new CapturingSigner();

    await expect(
      signOntologyCandidate(signer, release, "ontology-key-2026"),
    ).rejects.toMatchObject({ code: "ontology_origin_not_machine_pipeline" });
    expect(signer.calls).toEqual([]);
  });

  it("refuses a bundle hash that was not frozen from the canonical payload", async () => {
    const release = await machineRelease();
    release.bundle_hash = `sha256:${"0".repeat(64)}`;
    const signer = new CapturingSigner();

    await expect(
      signOntologyCandidate(signer, release, "ontology-key-2026"),
    ).rejects.toMatchObject({ code: "ontology_bundle_hash_mismatch" });
    expect(signer.calls).toEqual([]);
  });

  it("refuses a signer response bound to different bytes", async () => {
    const release = await machineRelease();
    const signer: OntologySignerBinding = {
      async signOntology(request) {
        return {
          ok: true,
          signature: {
            alg: "Ed25519",
            key_id: request.key_id,
            signature: "dGVzdC1zaWduYXR1cmU",
            signed_payload_hash: `sha256:${"1".repeat(64)}`,
          },
        };
      },
    };

    await expect(
      signOntologyCandidate(signer, release, "ontology-key-2026"),
    ).rejects.toBeInstanceOf(OntologySigningClientError);
  });
});
