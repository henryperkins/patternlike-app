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
import { isServiceAuthorized } from "./service-auth.js";
import { handleCycleScan } from "./cycles.js";
import { handleDailySky } from "./daily-sky.js";

const port = Number(process.env.PORT ?? 8080);

// Fail closed in production until SE license mode is decided (M0 gate).
try {
  assertPublicActivationAllowed();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

interface ServiceAuthDenial {
  status: 401 | 503;
  error_class: "unauthorized" | "service_auth_not_configured";
  error_message: string;
}

/**
 * The shared credential policy for every computing endpoint.
 *
 * Same environment resolution as license-mode: outside production, a missing
 * token leaves the endpoint open so the local calc:dev/dev:api loop needs no
 * shared secret. A configured token is enforced anywhere. In production a
 * missing token fails closed, mirroring the API's configGuard — a deploy that
 * forgot the secret refuses loudly instead of serving open compute.
 *
 * Extracted so `/v1/cycles` cannot drift from `/v1/calculate`: the only thing
 * that differs between the two is the shape of the body a denial is reported
 * in, and each endpoint's body shape is fixed by its own contract.
 */
function serviceAuthDenial(req: http.IncomingMessage): ServiceAuthDenial | null {
  const expectedToken = process.env.CALC_SERVICE_AUTH_TOKEN;
  const environment = (
    process.env.ENVIRONMENT ??
    process.env.NODE_ENV ??
    "development"
  ).toLowerCase();
  if (!expectedToken && environment === "production") {
    return {
      status: 503,
      error_class: "service_auth_not_configured",
      error_message: "Calculation service authentication is not configured",
    };
  }
  if (expectedToken && !isServiceAuthorized(req.headers.authorization, expectedToken)) {
    return {
      status: 401,
      error_class: "unauthorized",
      error_message: "Valid service credentials are required",
    };
  }
  return null;
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
    const denial = serviceAuthDenial(req);
    if (denial) {
      res.writeHead(denial.status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          chart: null,
          error_class: denial.error_class,
          error_message: denial.error_message,
        }),
      );
      return;
    }
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

  if (req.method === "POST" && url.pathname === "/v1/cycles") {
    const denial = serviceAuthDenial(req);
    if (denial) {
      // A credential failure never reached the engine, so it is reported in the
      // transport envelope rather than as a cycleResponseFailure — the caller
      // must be able to tell "the engine ran and refused" from "the request
      // never arrived", and that distinction is the HTTP status.
      res.writeHead(denial.status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: denial.error_class, message: denial.error_message },
        }),
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "bad_request", message: "Request body is not valid JSON" },
        }),
      );
      return;
    }

    // Everything past here is an engine-level answer: HTTP 200 with a
    // discriminated body, including every refusal.
    const result = handleCycleScan(parsed);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/daily-sky") {
    const denial = serviceAuthDenial(req);
    if (denial) {
      // Same rule as `/v1/cycles`: a credential failure never reached the
      // engine, so it is a transport envelope with a non-200 status rather than
      // a dailySkyResponse with `ok: false`.
      res.writeHead(denial.status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: denial.error_class, message: denial.error_message },
        }),
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "bad_request", message: "Request body is not valid JSON" },
        }),
      );
      return;
    }

    const result = handleDailySky(parsed);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, () => {
  console.log(`calc (Swiss Ephemeris ${SE_VERSION}) listening on :${port}`);
});
