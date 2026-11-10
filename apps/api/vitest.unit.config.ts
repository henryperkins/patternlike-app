import { defineConfig } from "vitest/config";
import { UNIT_TEST_FILES } from "./test/unit-test-files.js";

// Pure unit tests: no workerd, no D1, no bindings. Runs in parallel in Node.
// See test/unit-test-files.ts for the membership rule.
export default defineConfig({
  test: {
    include: UNIT_TEST_FILES,
    environment: "node",
  },
});
