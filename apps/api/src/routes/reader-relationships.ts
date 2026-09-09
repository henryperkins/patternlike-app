import { Hono, type Context } from "hono";
import { isValidIanaZone, type ReaderDailyTarget } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  loadReaderRelationshipSource, loadReaderRelationships, loadReaderRelationshipTarget, loadReaderTimingDetail,
} from "../services/reader-relationships.js";
import { localDayWindow } from "../services/local-day.js";

type ReaderContext = Context<{ Bindings: Env; Variables: AppVariables }>;
export const readerRelationshipRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const SOURCE_KEYS = ["revision", "paragraph_id"];
const RELATIONSHIP_KEYS = [...SOURCE_KEYS, "content_hash"];

function query(c: ReaderContext, keys: string[]): Record<string, string> | null {
  c.header("Cache-Control", "private, no-store");
  const entries = new URL(c.req.url).searchParams;
  if (keys.some((key) => entries.getAll(key).length !== 1)
    || [...entries.keys()].some((key) => !keys.includes(key))) return null;
  return Object.fromEntries(entries);
}

function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function revision(value: string): number | null {
  if (!/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647 ? parsed : null;
}
function source(c: ReaderContext, values: Record<string, string>): ReaderDailyTarget | null {
  const parsed = revision(values.revision!);
  const readingId = c.req.param("id");
  if (!readingId || parsed === null || !validId(readingId) || !validId(values.paragraph_id!)
    || !/^sha256:[a-f0-9]{64}$/.test(values.content_hash!)) return null;
  return { kind: "daily", reading_id: readingId, revision: parsed, content_hash: values.content_hash!, paragraph_id: values.paragraph_id! };
}
function identity(c: ReaderContext) { return { userId: c.get("userId"), cryptoSubject: c.get("cryptoSubject") }; }
function invalid(c: ReaderContext) {
  return c.json({ error: { code: "invalid_reader_relationship_query", message: "Reader relationship coordinates are invalid", request_id: c.get("requestId") } }, 400);
}

readerRelationshipRoutes.get("/v1/readings/:id/relationship-source", async (c) => {
  const values = query(c, SOURCE_KEYS);
  const parsed = values ? revision(values.revision!) : null;
  if (!values || parsed === null || !validId(c.req.param("id")) || !validId(values.paragraph_id!)) return invalid(c);
  return c.json(await loadReaderRelationshipSource(c.env, identity(c), c.req.param("id"), parsed, values.paragraph_id!));
});

readerRelationshipRoutes.get("/v1/readings/:id/relationships", async (c) => {
  const values = query(c, RELATIONSHIP_KEYS);
  const target = values ? source(c, values) : null;
  if (!target) return invalid(c);
  return c.json(await loadReaderRelationships(c.env, identity(c), target));
});

readerRelationshipRoutes.get("/v1/readings/:id/relationship-target", async (c) => {
  const values = query(c, [...RELATIONSHIP_KEYS, "relationship_id"]);
  const target = values ? source(c, values) : null;
  if (!target || !values || !/^reader-relationship:[a-f0-9]{64}$/.test(values.relationship_id!)) return invalid(c);
  return c.json(await loadReaderRelationshipTarget(c.env, identity(c), target, values.relationship_id!));
});

readerRelationshipRoutes.get("/v1/timing/cycles/:id", async (c) => {
  const values = query(c, ["cycle_hash", "pass_index", "local_date", "time_zone"]);
  const pass = values ? revision(values.pass_index!) : null;
  if (!values || pass === null || !/^cyc_[a-f0-9]{32}$/.test(c.req.param("id"))
    || !/^[a-f0-9]{64}$/.test(values.cycle_hash!) || !/^\d{4}-\d{2}-\d{2}$/.test(values.local_date!)
    || !isValidIanaZone(values.time_zone)) return invalid(c);
  try { localDayWindow(values.time_zone!, values.local_date!); } catch { return invalid(c); }
  const detail = await loadReaderTimingDetail(c.env, identity(c), {
    cycle_id: c.req.param("id"), cycle_hash: values.cycle_hash!, pass_index: pass,
    local_date: values.local_date!, time_zone: values.time_zone!,
  });
  if (!detail) return c.json({ error: { code: "timing_cycle_unavailable", message: "This Timing result is unavailable", request_id: c.get("requestId") } }, 404);
  return c.json(detail);
});
