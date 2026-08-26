import { env } from "cloudflare:test";
const queries = env.TEST_MIGRATIONS.flatMap((m) => m.queries);
await env.DB.batch(queries.map((q) => env.DB.prepare(q)));
