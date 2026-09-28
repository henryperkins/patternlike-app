import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync("public/sw.js", "utf8");

function worker(cacheControl: string | null) {
  const handlers = new Map<string, (event: unknown) => void>();
  const put = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn().mockResolvedValue(new Response("response body", {
    headers: cacheControl === null ? {} : { "cache-control": cacheControl },
  }));
  runInNewContext(script, {
    URL,
    self: {
      location: { origin: "https://pattern.test" },
      addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    },
    caches: { match: vi.fn().mockResolvedValue(undefined), open: vi.fn().mockResolvedValue({ put }) },
    fetch,
  });
  return { handle: handlers.get("fetch")!, put, fetch };
}

describe("service worker privacy boundary", () => {
  it.each(["private, no-store", "private", "max-age=3600, private=\"authorization\"", "No-Store"])("never stores an asset response carrying %s", async (cacheControl) => {
    const { handle, put } = worker(cacheControl);
    let response: Promise<Response> | undefined;
    handle({ request: { method: "GET", url: "https://pattern.test/assets/file.js" }, respondWith: (value: Promise<Response>) => { response = value; } });
    expect(await (await response)!.text()).toBe("response body");
    expect(put).not.toHaveBeenCalled();
  });

  it("continues caching public assets", async () => {
    const { handle, put } = worker("public, max-age=31536000");
    let response: Promise<Response> | undefined;
    handle({ request: { method: "GET", url: "https://pattern.test/assets/file.js" }, respondWith: (value: Promise<Response>) => { response = value; } });
    await response;
    expect(put).toHaveBeenCalledOnce();
  });

  it("leaves private API requests entirely to the network", () => {
    const { handle, fetch, put } = worker("private, no-store");
    const respondWith = vi.fn();
    handle({ request: { method: "GET", url: "https://pattern.test/v1/readings/today" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
