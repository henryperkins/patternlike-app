import { beforeEach, describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { IDENTITY_A, USER_A, resetDb, rows, seedUser } from "../../test/helpers.js";

interface Source {
  schema_version: "0.2.0";
  user_id: string;
  source_id: "USR-06" | "USR-09";
  enabled: boolean;
  permission_state: "active" | "paused" | "revoked" | "never_granted";
  allowed_uses: string[];
  permission_tier: 1;
  consent_id: string | null;
  freshness: null;
  last_signal_id: string | null;
  scopes: string[];
  connector_status: "not_applicable";
  updated_at: string;
}

interface Document {
  schema_version: "0.2.0";
  user_id: string;
  sources: Source[];
  updated_at: string;
}

async function getSources(): Promise<Document> {
  const response = await SELF.fetch("http://api.test/v1/context-sources", {
    headers: { "x-user-id": USER_A },
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Document>;
}

async function putSource(document: Document, sourceId: Source["source_id"], state: "active" | "paused" | "revoked", key: string) {
  const source = document.sources.find((item) => item.source_id === sourceId)!;
  const response = await SELF.fetch("http://api.test/v1/context-sources", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
      "idempotency-key": key,
    },
    body: JSON.stringify({
      ...document,
      sources: [{ ...source, enabled: state === "active", permission_state: state }],
    }),
  });
  return { status: response.status, body: await response.json() as Document & { error?: { code: string } } };
}

describe("M4 context-source document", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it("projects USR-06 then USR-09 and mutates only the included source", async () => {
    const initial = await getSources();
    expect(initial.sources.map((source) => source.source_id)).toEqual(["USR-06", "USR-09"]);
    const usr06Before = structuredClone(initial.sources[0]);

    const granted = await putSource(initial, "USR-09", "active", "source-common-key-0001");
    expect(granted.status).toBe(200);
    expect(granted.body.sources).toHaveLength(2);
    expect(granted.body.sources[0]).toEqual(usr06Before);
    expect(granted.body.sources[1]).toMatchObject({
      source_id: "USR-09",
      enabled: true,
      permission_state: "active",
      permission_tier: 1,
      allowed_uses: ["time_travel"],
      consent_id: expect.stringMatching(/^cns_/),
    });
    expect(await rows<{ allowed_uses_json: string }>(
      "SELECT allowed_uses_json FROM consents WHERE user_id = ? AND source_id = 'USR-09'",
      USER_A,
    )).toEqual([{ allowed_uses_json: '["time_travel"]' }]);
  });

  it("scopes one idempotency namespace across both source families", async () => {
    const initial = await getSources();
    const granted = await putSource(initial, "USR-09", "active", "source-common-key-0002");
    expect(granted.status).toBe(200);
    const replay = await putSource(initial, "USR-09", "active", "source-common-key-0002");
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(granted.body);

    const conflict = await putSource(initial, "USR-06", "active", "source-common-key-0002");
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe("idempotency_conflict");
  });
});
