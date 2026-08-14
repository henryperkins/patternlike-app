import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newId, EXCLUDABLE_LIFE_DOMAINS, LIFE_DOMAINS } from "./index.js";

describe("newId", () => {
  it("produces prefix_<32 lowercase hex>", () => {
    const id = newId("usr");
    assert.match(id, /^usr_[0-9a-f]{32}$/);
  });

  it("does not repeat across calls", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newId("usr")));
    assert.equal(seen.size, 200);
  });

  it("contains no ':' — reading_key uses it as a field delimiter", () => {
    for (let i = 0; i < 50; i++) {
      assert.ok(!newId("usr").includes(":"));
    }
  });

  it("throws rather than falling back to Math.random when getRandomValues is absent", () => {
    const real = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: { subtle: real.subtle },
        configurable: true,
      });
      assert.throws(() => newId("usr"), /getRandomValues/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
    }
  });
});

describe("life domains", () => {
  it("lets a reader exclude every named domain except the ranking remainder", () => {
    assert.equal(LIFE_DOMAINS.includes("unspecified"), true);
    assert.equal(EXCLUDABLE_LIFE_DOMAINS.includes("unspecified" as never), false);
    assert.equal(EXCLUDABLE_LIFE_DOMAINS.length, LIFE_DOMAINS.length - 1);
  });
});
