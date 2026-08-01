import http from "node:http";
import {
  calculateChart,
  engineMeta,
  initSwissEphemeris,
  STUB_CONTAINER_DIGEST,
  SE_VERSION,
  SE_WRAPPER,
} from "./engine.js";
import { resolveEphePath, assertEphePresent } from "./ephe-path.js";
import {
  assertPublicActivationAllowed,
  licenseStatusPayload,
} from "./license-mode.js";
import type { CalcRequest } from "@patternlike/shared";

const port = Number(process.env.PORT ?? 8080);

// Fail closed in production until SE license mode is decided (M0 gate).
try {
  assertPublicActivationAllowed();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Fail fast if ephe missing
try {
  const ephe = resolveEphePath();
  assertEphePresent(ephe);
  initSwissEphemeris(ephe);
  console.log(`Swiss Ephemeris ${SE_VERSION} ready; ephe=${ephe}`);
} catch (err) {
  console.error(
    err instanceof Error ? err.message : err,
    "\nDownload with: npm run ephe:download -w @patternlike/calc-stub",
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    let ephe_ok = false;
    let meta: ReturnType<typeof engineMeta> | null = null;
    try {
      assertEphePresent(resolveEphePath());
      meta = engineMeta();
      ephe_ok = true;
    } catch {
      ephe_ok = false;
    }
    res.writeHead(ephe_ok ? 200 : 503, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: ephe_ok,
        service: "patternlike-calc",
        engine: "swiss_ephemeris",
        se_version: SE_VERSION,
        wrapper: SE_WRAPPER,
        container_digest: STUB_CONTAINER_DIGEST,
        ephe_ok,
        license: licenseStatusPayload(),
        meta,
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/engine") {
    try {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(engineMeta()));
    } catch (err) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/calculate") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as CalcRequest;
      const result = await calculateChart(body);
      res.writeHead(result.ok ? 200 : 400, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          chart: null,
          error_class: "bad_request",
          error_message: err instanceof Error ? err.message : "invalid json",
        }),
      );
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, () => {
  console.log(`calc (Swiss Ephemeris ${SE_VERSION}) listening on :${port}`);
});
