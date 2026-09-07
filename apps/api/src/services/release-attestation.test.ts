import { describe, expect, it } from "vitest";

import {
  DEVELOPMENT_RELEASE_GIT_SHA,
  checkReleaseAttestation,
  readReleaseGitSha,
  readWorkerVersionId,
  resolveReleaseAttestation,
} from "./release-attestation.js";
import type { Env } from "../env.js";

const REAL_SHA = "29ee03543f4186dbfbb4d57c5a420553a6928adb";
const VERSION = { id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", tag: "", timestamp: "" };

function environment(values: Partial<Env>): Partial<Env> {
  return { ENVIRONMENT: "production", ...values };
}

describe("release attestation configuration", () => {
  it("accepts a deployment that names a real commit", () => {
    expect(checkReleaseAttestation(environment({ RELEASE_GIT_SHA: REAL_SHA })))
      .toBeNull();
  });

  it("refuses the committed placeholder outside development", () => {
    // Forty zeros is reserved for development; production must supply a SHA.
    expect(
      checkReleaseAttestation(
        environment({ RELEASE_GIT_SHA: DEVELOPMENT_RELEASE_GIT_SHA }),
      )?.code,
    ).toBe("release_attestation_missing");
    expect(
      checkReleaseAttestation({
        ENVIRONMENT: "development",
        RELEASE_GIT_SHA: DEVELOPMENT_RELEASE_GIT_SHA,
      }),
    ).toBeNull();
  });

  it("refuses an absent release only where one is owed", () => {
    expect(checkReleaseAttestation(environment({}))?.code)
      .toBe("release_attestation_missing");
    expect(checkReleaseAttestation({ ENVIRONMENT: "development" })).toBeNull();
  });

  it("refuses a present value that is not a commit hash, in every environment", () => {
    for (const environmentName of ["development", "test", "production"]) {
      for (const sha of [
        "not-a-commit",
        REAL_SHA.toUpperCase(),
        REAL_SHA.slice(0, 39),
        `${REAL_SHA}0`,
        "v1.4.2",
      ]) {
        expect(
          checkReleaseAttestation({
            ENVIRONMENT: environmentName,
            RELEASE_GIT_SHA: sha,
          })?.code,
          `${environmentName} accepted ${sha}`,
        ).toBe("release_attestation_missing");
      }
    }
  });
});

describe("release attestation at publication", () => {
  it("returns both halves when both are usable", () => {
    expect(
      resolveReleaseAttestation(
        environment({
          RELEASE_GIT_SHA: REAL_SHA,
          CF_VERSION_METADATA: VERSION as WorkerVersionMetadata,
        }),
      ),
    ).toEqual({ releaseGitSha: REAL_SHA, workerVersionId: VERSION.id });
  });

  it("returns nothing when either half is missing", () => {
    // A receipt naming a release but no Worker version, or a version but no
    // release, would answer half the question while looking complete. There is
    // no partial attestation, so publication refuses rather than degrades.
    expect(resolveReleaseAttestation(environment({ RELEASE_GIT_SHA: REAL_SHA })))
      .toBeNull();
    expect(
      resolveReleaseAttestation(
        environment({ CF_VERSION_METADATA: VERSION as WorkerVersionMetadata }),
      ),
    ).toBeNull();
    expect(
      resolveReleaseAttestation(
        environment({
          RELEASE_GIT_SHA: REAL_SHA,
          CF_VERSION_METADATA: { ...VERSION, id: "not-a-version" } as WorkerVersionMetadata,
        }),
      ),
    ).toBeNull();
  });

  it("reads each half independently for /v1/meta", () => {
    const half = environment({
      CF_VERSION_METADATA: VERSION as WorkerVersionMetadata,
    });
    expect(readReleaseGitSha(half)).toBeNull();
    expect(readWorkerVersionId(half)).toBe(VERSION.id);
  });
});
