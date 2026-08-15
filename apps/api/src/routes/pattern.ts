import { Hono } from "hono";
import {
  M4_SCHEMA_VERSION,
  NATAL_FEATURE_POLICY_VERSION,
  canonicalJson,
  type BirthTimeAccuracy,
  type NatalFeature,
  type PatternChapter,
  type PatternContentObject,
  type PatternEvidence,
  type PatternResponse,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { getActiveRelease } from "../db/content-releases.js";
import { ensureNatalFeatureSet } from "../db/natal-features.js";
import { loadPreferences } from "../db/preferences.js";
import { readPatternObjects } from "../services/pattern-content.js";
import { matchPatternObject } from "../services/pattern-matcher.js";
import { loadReleaseBundle } from "../services/release-bundle.js";
import { tryServeAiPattern } from "./pattern-ai.js";
import { safeLog } from "../services/safe-log.js";

export const patternRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface ActiveChart {
  id: string;
  fingerprint: string;
  birth_accuracy: BirthTimeAccuracy;
}

interface PatternCursor {
  v: 1;
  chart_fingerprint: string;
  feature_set_hash: string;
  bundle_hash: string;
  last_priority: number;
  last_id: string;
}

function error(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

function base64UrlEncode(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): PatternCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PatternCursor>;
    if (
      parsed.v !== 1 || typeof parsed.chart_fingerprint !== "string" ||
      typeof parsed.feature_set_hash !== "string" || typeof parsed.bundle_hash !== "string" ||
      !Number.isInteger(parsed.last_priority) || typeof parsed.last_id !== "string"
    ) return null;
    return parsed as PatternCursor;
  } catch {
    return null;
  }
}

function parseQuery(url: string): { limit: number; cursor: PatternCursor | null } | null {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (key !== "limit" && key !== "cursor") return null;
    if (params.getAll(key).length !== 1) return null;
  }
  const limitRaw = params.get("limit");
  if (limitRaw !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limitRaw)) return null;
  const cursorRaw = params.get("cursor");
  const cursor = cursorRaw === null ? null : base64UrlDecode(cursorRaw);
  if (cursorRaw !== null && cursor === null) return null;
  return { limit: limitRaw === null ? 20 : Number(limitRaw), cursor };
}

function resolveLocale(
  requested: string,
  patterns: readonly PatternContentObject[],
  fallback: Record<string, string> | undefined,
  defaultLocale: string,
): string | null {
  const available = new Set(patterns.map((pattern) => pattern.locale));
  let candidate = requested;
  const seen = new Set<string>();
  while (!seen.has(candidate)) {
    if (available.has(candidate)) return candidate;
    seen.add(candidate);
    const next = fallback?.[candidate];
    if (!next) break;
    candidate = next;
  }
  return available.has(defaultLocale) || patterns.length === 0 ? defaultLocale : null;
}

function featureLabel(feature: NatalFeature): string {
  switch (feature.feature_class) {
    case "position":
      return `${feature.body} in sign ${feature.sign}${feature.house === null ? "" : `, house ${feature.house}`}`;
    case "aspect":
      return `${feature.body_a} ${feature.aspect} ${feature.body_b} within ${feature.orb}°`;
    case "pattern":
      return `${feature.pattern} among ${feature.member_bodies.join(", ")}`;
    case "angle":
      return `${feature.angle} in sign ${feature.sign}`;
    case "house_cusp":
      return `house ${feature.house} cusp in sign ${feature.sign}`;
    case "uncertainty":
      return `${feature.accuracy} birth-time accuracy`;
  }
}

function evidence(features: readonly NatalFeature[]): PatternEvidence[] {
  return features.map((feature) => ({
    feature_id: feature.feature_id,
    feature_class: feature.feature_class,
    label: featureLabel(feature),
  }));
}

patternRoutes.get("/v1/pattern", async (c) => {
  const requestId = c.get("requestId");
  const ai = await tryServeAiPattern(c.env, c.get("userId"), c.get("cryptoSubject"), requestId, c.req.url);
  if (ai) return ai;
  const query = parseQuery(c.req.url);
  if (!query) {
    return c.json(error(requestId, "invalid_pattern_query", "Only one valid cursor and limit 1-50 are accepted"), 400);
  }
  const userId = c.get("userId");
  const chart = await c.env.DB.prepare(
    `SELECT id, fingerprint, birth_accuracy FROM chart_snapshots
     WHERE user_id = ? AND status = 'active'
     ORDER BY calculated_at DESC LIMIT 1`,
  ).bind(userId).first<ActiveChart>();
  if (!chart) return c.json(error(requestId, "chart_not_found", "No active chart for user"), 404);

  const preferences = await loadPreferences(c.env, userId);
  if (!preferences || preferences.localeSource !== "user_confirmed") {
    return c.json(error(requestId, "locale_confirmation_required", "Confirm a content locale before loading Pattern"), 409);
  }

  const active = await getActiveRelease(c.env);
  if (!active) {
    return c.json(error(requestId, "pattern_release_not_active", "No active Pattern release"), 503);
  }
  const loaded = await loadReleaseBundle(c.env, active.version, active.bundle_hash);
  if (!loaded.ok) {
    safeLog({ event: loaded.reason });
    return c.json(error(requestId, loaded.reason, "The active release could not be verified"), 503);
  }
  if (loaded.bundle.schema_version !== M4_SCHEMA_VERSION) {
    return c.json(error(requestId, "pattern_release_not_active", "The active release does not contain Pattern"), 503);
  }

  const patterns = readPatternObjects(loaded.bundle.objects.patterns);
  if (!patterns) {
    // Bytes that passed M4 ingestion and re-hashed against the ledger, yet do
    // not describe M4 Pattern objects. Fail closed rather than match a subset.
    safeLog({ event: "release_unreadable" });
    return c.json(error(requestId, "release_unreadable", "The active release could not be verified"), 503);
  }
  const locale = resolveLocale(
    preferences.locale,
    patterns,
    loaded.bundle.release.language_fallbacks,
    loaded.bundle.release.locale_default,
  );
  if (!locale) {
    return c.json(error(requestId, "unsupported_locale", "The active release does not support the confirmed locale"), 409);
  }

  let set;
  try {
    set = await ensureNatalFeatureSet(c.env, userId, chart.id);
  } catch {
    safeLog({ event: "natal_feature_derivation_failed" });
    return c.json(error(requestId, "feature_derivation_failed", "Pattern facts could not be derived"), 500);
  }
  if (query.cursor && (
    query.cursor.chart_fingerprint !== chart.fingerprint ||
    query.cursor.feature_set_hash !== set.featureSetHash ||
    query.cursor.bundle_hash !== active.bundle_hash
  )) {
    return c.json(error(requestId, "pattern_cursor_stale", "Pattern changed; restart pagination"), 409);
  }

  const omissions: PatternResponse["omissions"] = {
    accuracy: 0,
    houses_or_angles: 0,
    locale: patterns.filter((pattern) => pattern.locale !== locale).length,
    predicate_mismatch: 0,
  };
  const chapters: Array<{ pattern: PatternContentObject; chapter: PatternChapter }> = [];
  for (const pattern of patterns.filter((candidate) => candidate.locale === locale)) {
    const matched = matchPatternObject(pattern, set.features, chart.birth_accuracy);
    if (!matched.eligible) {
      if (matched.omission === "accuracy") omissions.accuracy++;
      else if (matched.omission === "houses_or_angles") omissions.houses_or_angles++;
      else omissions.predicate_mismatch++;
      continue;
    }
    chapters.push({
      pattern,
      chapter: {
        content_id: pattern.id,
        content_version: pattern.content_version,
        title: pattern.title,
        summary: pattern.summary,
        body: pattern.body,
        resources: pattern.resources,
        tensions: pattern.tensions,
        counter_expression: pattern.counter_expression,
        evidence: evidence(matched.evidence),
      },
    });
  }
  chapters.sort((a, b) =>
    a.pattern.display_priority - b.pattern.display_priority || a.pattern.id.localeCompare(b.pattern.id));

  let start = 0;
  if (query.cursor) {
    const cursorIndex = chapters.findIndex(({ pattern }) =>
      pattern.display_priority === query.cursor!.last_priority && pattern.id === query.cursor!.last_id);
    if (cursorIndex < 0) {
      return c.json(error(requestId, "pattern_cursor_stale", "Pattern changed; restart pagination"), 409);
    }
    start = cursorIndex + 1;
  }
  const page = chapters.slice(start, start + query.limit);
  const hasMore = start + page.length < chapters.length;
  const last = page.at(-1)?.pattern;
  const nextCursor = hasMore && last ? base64UrlEncode({
    v: 1,
    chart_fingerprint: chart.fingerprint,
    feature_set_hash: set.featureSetHash,
    bundle_hash: active.bundle_hash,
    last_priority: last.display_priority,
    last_id: last.id,
  } satisfies PatternCursor) : null;

  const response: PatternResponse = {
    schema_version: M4_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    chart_id: chart.id,
    chart_fingerprint: chart.fingerprint,
    effective_accuracy: chart.birth_accuracy,
    feature_policy_version: NATAL_FEATURE_POLICY_VERSION,
    feature_set_hash: set.featureSetHash,
    release_version: active.version,
    bundle_hash: active.bundle_hash,
    locale,
    items: page.map(({ chapter }) => chapter),
    next_cursor: nextCursor,
    omissions,
  };
  return c.json(response, 200);
});
