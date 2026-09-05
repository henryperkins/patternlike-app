import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Separate fictional preview; the production entry remains unchanged. */
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
  build: {
    outDir: "dist-portrait",
    rolldownOptions: { input: "pattern-portrait.html" },
  },
});
