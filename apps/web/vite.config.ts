import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8787";

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/v1": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      allowedHosts: ["host.docker.internal"],
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: true,
      // The portrait-explorer suites await readiness with `waitFor(...,
      // { timeout: 5000 })`, and vitest's own default `testTimeout` is also
      // 5000ms. That leaves a test zero headroom: it can only pass when the
      // condition resolves well inside the budget, so a loaded machine fails
      // whichever of those tests is unluckiest. `ci:local` has failed this way
      // twice on a rotating cast -- once on `shows a pointer only over visible
      // pickable geometry`, once on two `renders N distinct chapter stations`
      // plus a camera-bookmark test, each overrunning by a few hundred
      // milliseconds. The inner `waitFor` still bounds every real wait at
      // 5000ms and still fails a condition that never resolves; this only
      // stops the outer timeout racing it.
      testTimeout: 20_000,
    },
  };
});
