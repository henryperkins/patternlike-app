import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  capturedFor,
  deferred,
  mockApiResponses,
  type MockResponse,
} from "../test/api-mock.js";
import { DevicePreferenceSynchronizer } from "./device-preference-sync.js";

const device = vi.hoisted(() => ({
  locale: vi.fn<() => string>(),
  timezone: vi.fn<() => string>(),
}));

vi.mock("./device.js", () => ({
  systemLocale: device.locale,
  systemTimezone: device.timezone,
}));

const TIMEZONE = "/v1/preferences/timezone";
const LOCALE = "/v1/preferences/locale";
const ok: MockResponse = { status: 200, body: {} };

function error(status: number, code: string): MockResponse {
  return {
    status,
    body: {
      error: {
        code,
        message: code,
        request_id: `req_${code}`,
      },
    },
  };
}

function stubPreferences(
  timezone: MockResponse = ok,
  locale: MockResponse = ok,
): void {
  mockApiResponses({
    [TIMEZONE]: timezone,
    [LOCALE]: locale,
  });
}

beforeEach(() => {
  device.timezone.mockReset();
  device.locale.mockReset();
  device.timezone.mockReturnValue("America/Chicago");
  device.locale.mockReturnValue("en-us");
  stubPreferences();
});

describe("DevicePreferenceSynchronizer", () => {
  it("writes the device timezone and canonical locale as device-derived", async () => {
    const synchronizer = new DevicePreferenceSynchronizer();

    await expect(synchronizer.sync()).resolves.toEqual({ status: "settled" });

    expect(capturedFor(TIMEZONE)[0]?.body).toEqual({
      timezone: "America/Chicago",
      source: "device_derived",
    });
    expect(capturedFor(LOCALE)[0]?.body).toEqual({
      locale: "en-US",
      source: "device_derived",
    });
  });

  it("mints fresh keys after a settled attempt with unchanged normalized values", async () => {
    const synchronizer = new DevicePreferenceSynchronizer();

    await synchronizer.sync();
    device.locale.mockReturnValue("en-US");
    await synchronizer.sync();

    const timezoneKeys = capturedFor(TIMEZONE).map((request) =>
      request.headers.get("idempotency-key")
    );
    const localeKeys = capturedFor(LOCALE).map((request) =>
      request.headers.get("idempotency-key")
    );
    expect(timezoneKeys).toHaveLength(2);
    expect(localeKeys).toHaveLength(2);
    expect(timezoneKeys[0]).not.toBe(timezoneKeys[1]);
    expect(localeKeys[0]).not.toBe(localeKeys[1]);
  });

  it("mints fresh keys across settled A to B to A transitions", async () => {
    const synchronizer = new DevicePreferenceSynchronizer();

    await synchronizer.sync();
    device.timezone.mockReturnValue("Asia/Tokyo");
    device.locale.mockReturnValue("fr-fr");
    await synchronizer.sync();
    device.timezone.mockReturnValue("America/Chicago");
    device.locale.mockReturnValue("en-US");
    await synchronizer.sync();

    const timezoneKeys = capturedFor(TIMEZONE).map((request) =>
      request.headers.get("idempotency-key")
    );
    const localeKeys = capturedFor(LOCALE).map((request) =>
      request.headers.get("idempotency-key")
    );
    expect(timezoneKeys).toHaveLength(3);
    expect(localeKeys).toHaveLength(3);
    expect(timezoneKeys[0]).not.toBe(timezoneKeys[1]);
    expect(timezoneKeys[0]).not.toBe(timezoneKeys[2]);
    expect(localeKeys[0]).not.toBe(localeKeys[1]);
    expect(localeKeys[0]).not.toBe(localeKeys[2]);
  });

  it("reuses both keys after a partially unavailable attempt", async () => {
    const responses: Record<string, MockResponse> = {
      [TIMEZONE]: { status: 0, body: null, unreachable: true },
      [LOCALE]: ok,
    };
    mockApiResponses(responses);
    const synchronizer = new DevicePreferenceSynchronizer();

    await expect(synchronizer.sync()).resolves.toEqual({
      status: "unavailable",
    });
    responses[TIMEZONE] = ok;
    await expect(synchronizer.sync()).resolves.toEqual({ status: "settled" });

    const timezoneKeys = capturedFor(TIMEZONE).map((request) =>
      request.headers.get("idempotency-key")
    );
    const localeKeys = capturedFor(LOCALE).map((request) =>
      request.headers.get("idempotency-key")
    );
    expect(timezoneKeys).toHaveLength(2);
    expect(localeKeys).toHaveLength(2);
    expect(timezoneKeys[0]).toBe(timezoneKeys[1]);
    expect(localeKeys[0]).toBe(localeKeys[1]);
  });

  it("clears all pending keys after an unauthorized result", async () => {
    const responses: Record<string, MockResponse> = {
      [TIMEZONE]: { status: 0, body: null, unreachable: true },
      [LOCALE]: ok,
    };
    mockApiResponses(responses);
    const synchronizer = new DevicePreferenceSynchronizer();

    await expect(synchronizer.sync()).resolves.toEqual({
      status: "unavailable",
    });

    device.timezone.mockReturnValue("Asia/Tokyo");
    device.locale.mockReturnValue("fr-FR");
    responses[TIMEZONE] = error(401, "unauthorized");
    await expect(synchronizer.sync()).resolves.toEqual({
      status: "unauthorized",
    });

    device.timezone.mockReturnValue("America/Chicago");
    device.locale.mockReturnValue("en-US");
    responses[TIMEZONE] = ok;
    await expect(synchronizer.sync()).resolves.toEqual({ status: "settled" });

    const timezoneKeys = capturedFor(TIMEZONE).map((request) =>
      request.headers.get("idempotency-key")
    );
    const localeKeys = capturedFor(LOCALE).map((request) =>
      request.headers.get("idempotency-key")
    );
    expect(timezoneKeys).toHaveLength(3);
    expect(localeKeys).toHaveLength(3);
    expect(timezoneKeys[0]).not.toBe(timezoneKeys[2]);
    expect(localeKeys[0]).not.toBe(localeKeys[2]);
  });

  it("shares one promise and one pair of writes across concurrent triggers", async () => {
    const gate = deferred();
    stubPreferences(
      { ...ok, gate: gate.promise },
      { ...ok, gate: gate.promise },
    );
    const synchronizer = new DevicePreferenceSynchronizer();

    const first = synchronizer.sync();
    const second = synchronizer.sync();

    expect(second).toBe(first);
    await vi.waitFor(() => {
      expect(capturedFor(TIMEZONE)).toHaveLength(1);
      expect(capturedFor(LOCALE)).toHaveLength(1);
    });

    gate.release();
    await expect(first).resolves.toEqual({ status: "settled" });
  });

  it("treats a locked device write as settled", async () => {
    stubPreferences(error(409, "preference_locked"));

    await expect(new DevicePreferenceSynchronizer().sync()).resolves.toEqual({
      status: "settled",
    });
    expect(capturedFor(LOCALE)).toHaveLength(1);
  });

  it("keeps an unauthorized write distinguishable", async () => {
    stubPreferences(error(401, "unauthorized"));

    await expect(new DevicePreferenceSynchronizer().sync()).resolves.toEqual({
      status: "unauthorized",
    });
    expect(capturedFor(LOCALE)).toHaveLength(1);
  });

  it("retries one preference conflict once with the same key and body", async () => {
    const responses: Record<string, MockResponse> = {
      [LOCALE]: ok,
    };
    Object.defineProperty(responses, TIMEZONE, {
      enumerable: true,
      get: () =>
        capturedFor(TIMEZONE).length === 1
          ? error(409, "preference_conflict")
          : ok,
    });
    mockApiResponses(responses);

    await expect(new DevicePreferenceSynchronizer().sync()).resolves.toEqual({
      status: "settled",
    });

    const writes = capturedFor(TIMEZONE);
    expect(writes).toHaveLength(2);
    expect(writes[0]?.body).toEqual(writes[1]?.body);
    expect(writes[0]?.headers.get("idempotency-key")).toBe(
      writes[1]?.headers.get("idempotency-key"),
    );
  });

  it.each([
    ["a network failure", { status: 0, body: null, unreachable: true }],
    ["a server failure", error(503, "service_unavailable")],
  ] satisfies Array<[string, MockResponse]>)(
    "settles $0 as an unavailable best-effort sync",
    async (_label, failure) => {
      stubPreferences(failure);

      await expect(new DevicePreferenceSynchronizer().sync()).resolves.toEqual({
        status: "unavailable",
      });
      expect(capturedFor(LOCALE)).toHaveLength(1);
    },
  );
});
