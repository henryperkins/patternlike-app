import { describe, expect, it } from "vitest";
import { ensureTodayReading } from "./api-client.js";
import { capturedFor, mockApiResponses } from "../test/api-mock.js";
import { todayResponse } from "../test/reading-fixture.js";

const TODAY = "/v1/readings/today";

describe("ensureTodayReading", () => {
  it("returns the preparation response from a body-less PUT", async () => {
    const preparationResponse = {
      schema_version: "0.3.0",
      status: "preparing" as const,
      local_date: "2026-08-09",
    };
    mockApiResponses({
      [TODAY]: { status: 202, body: preparationResponse },
    });

    await expect(ensureTodayReading()).resolves.toEqual(preparationResponse);

    const [request] = capturedFor(TODAY);
    expect(request.method).toBe("PUT");
    expect(request.body).toBeNull();
  });

  it("returns the published reading response unchanged", async () => {
    mockApiResponses({
      [TODAY]: { status: 200, body: todayResponse },
    });

    await expect(ensureTodayReading()).resolves.toEqual(todayResponse);
  });
});
