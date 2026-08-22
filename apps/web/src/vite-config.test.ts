import { describe, expect, it } from "vitest";
import type { ConfigEnv, UserConfigFn } from "vite";
import viteConfig from "../vite.config.js";

describe("Vite authentication origin", () => {
  it("fails closed on the configured Auth0 host and port", async () => {
    const environment: ConfigEnv = {
      command: "serve",
      mode: "test",
      isSsrBuild: false,
      isPreview: false,
    };
    const config = await (viteConfig as UserConfigFn)(environment);

    expect(config.server).toMatchObject({
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    });
  });
});
