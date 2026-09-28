import type { MiddlewareHandler } from "hono";

/** Response policy only; route-specific authorities remain in their own routers. */
export const privateResponsePolicy: MiddlewareHandler = async (c, next) => {
  if (c.req.path === "/health" || c.req.path === "/v1/meta") {
    await next();
    return;
  }
  // Prepare the header before any refusal, then enforce it on the final response
  // too, including raw Response objects, downloads, and Hono's error response.
  c.header("Cache-Control", "private, no-store");
  await next();
  c.header("Cache-Control", "private, no-store");
};
