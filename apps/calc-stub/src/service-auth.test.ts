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
