import assert from "node:assert/strict";
import test from "node:test";
import { isServiceAuthorized } from "./service-auth.js";

test("accepts the configured bearer token", () => {
  assert.equal(
    isServiceAuthorized("Bearer correct-token", "correct-token"),
    true,
  );
});

test("rejects missing or invalid credentials", () => {
  assert.equal(isServiceAuthorized(undefined, "correct-token"), false);
  assert.equal(isServiceAuthorized("Bearer wrong-token", "correct-token"), false);
  assert.equal(isServiceAuthorized("Bearer ", "correct-token"), false);
  assert.equal(isServiceAuthorized("Basic correct-token", "correct-token"), false);
  assert.equal(isServiceAuthorized("Bearer correct-token", undefined), false);
  assert.equal(isServiceAuthorized("Bearer correct-token", ""), false);
});

/**
 * Every computing endpoint must go through the SAME credential policy.
 *
 * `serviceAuthDenial` was extracted so `/v1/cycles` could not drift from
 * `/v1/calculate`; `/v1/daily-sky` is the third, and it takes natal longitudes
 * and house cusps. A route that read its body before checking credentials would
 * be open compute with an authentication check bolted on afterwards, and that
 * is exactly the kind of omission a unit test of the helper alone cannot see.
 *
 * `/health` and `/v1/engine` are deliberately public so Fly health checks work
 * before the token is set, and they reveal no user data.
 */
test("every computing route checks credentials before it reads a body", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, "server.ts"), "utf8");

  const computeRoutes = ["/v1/calculate", "/v1/cycles", "/v1/daily-sky"];
  for (const route of computeRoutes) {
    const start = source.indexOf(`url.pathname === "${route}"`);
    assert.ok(start > 0, `${route} is routed`);
    const body = source.slice(start, start + 2000);
    const guard = body.indexOf("serviceAuthDenial(req)");
    const read = body.indexOf("readBody(req)");
    assert.ok(guard > 0, `${route} calls serviceAuthDenial`);
    assert.ok(read > 0, `${route} reads a body`);
    assert.ok(guard < read, `${route} checks credentials before reading its body`);
  }

  for (const publicRoute of ["/health", "/v1/engine"]) {
    assert.ok(source.includes(`url.pathname === "${publicRoute}"`), `${publicRoute} is routed`);
  }
});
