/**
 * Deferred construction for this Worker's Ajv validators.
 *
 * Every Ajv instance here used to be built at module scope. Ajv compiles the
 * JSON Schema 2020-12 meta-schema the first time a schema is registered, and
 * the accumulated codegen pushed isolate startup past Cloudflare's startup CPU
 * budget: `wrangler deploy` began failing validation with `Script startup
 * exceeded CPU time limit` (code 10021) on `c98ecf0`, a commit that touched no
 * Worker code at all. The Worker had been sitting just under the ceiling and
 * build-host variance was enough to tip it over, so deploys were a coin flip
 * rather than a clean regression.
 *
 * Compilation now happens on the first call that needs a given validator,
 * inside a request or queue handler, where the CPU budget is per-invocation
 * instead of per-isolate. Keep it that way: a `new Ajv2020(...)`, `addSchema`,
 * `getSchema`, or `compile` call evaluated at module scope re-spends startup
 * CPU for every isolate, whether or not the request touches that schema.
 *
 * The accessor memoizes, so each isolate pays once. It deliberately does not
 * memoize a thrown error: a genuinely unavailable schema should fail the same
 * way on every call rather than letting one failure poison the isolate.
 */
export function lazy<T>(build: () => T): () => T {
  let value: T;
  let built = false;
  return () => {
    if (!built) {
      value = build();
      built = true;
    }
    return value;
  };
}
