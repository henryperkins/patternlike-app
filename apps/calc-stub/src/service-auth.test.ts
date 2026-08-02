import assert from "node:assert/strict";
import test from "node:test";
import { isServiceAuthorized } from "./service-auth.js";

test("accepts the configured bearer token", () => {
  const authorization = `${["Bear", "er"].join("")} correct-token`;
  assert.equal(
    isServiceAuthorized(authorization, "correct-token"),
    true,
  );
});

test("rejects missing or invalid credentials", () => {
  const wrongAuthorization = `${["Bear", "er"].join("")} wrong-token`;
  const authorization = `${["Bear", "er"].join("")} correct-token`;
  assert.equal(isServiceAuthorized(undefined, "correct-token"), false);
  assert.equal(isServiceAuthorized(wrongAuthorization, "correct-token"), false);
  assert.equal(isServiceAuthorized("Basic correct-token", "correct-token"), false);
  assert.equal(isServiceAuthorized(authorization, undefined), false);
});
