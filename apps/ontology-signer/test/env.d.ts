import type { SignerEnv } from "../src/index.js";

declare global {
  namespace Cloudflare {
    interface Env extends SignerEnv {}
    interface GlobalProps {
      mainModule: typeof import("../src/index.js");
    }
  }
}

export {};
