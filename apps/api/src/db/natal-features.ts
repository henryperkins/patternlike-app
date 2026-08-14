import {
  NATAL_FEATURE_POLICY_ID,
  NATAL_FEATURE_POLICY_VERSION,
  jcsCanonicalize,
  sha256Hex,
  type BirthTimeAccuracy,
  type NatalFeature,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import { deriveNatalFeatureSet, type DerivedNatalFeatureSet } from "../services/natal-features.js";

interface ChartRow {
  id: string;
  fingerprint: string;
  birth_accuracy: BirthTimeAccuracy;
  snapshot_json: string;
  uncertainty_json: string;
}

interface ReceiptRow {
  id: string;
  feature_set_hash: string;
  feature_count: number;
}

interface FeatureRow {
  id: string;
  feature_json: string;
  feature_set_hash: string | null;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function loadCompletedSet(
  env: Env,
  userId: string,
  chart: ChartRow,
): Promise<DerivedNatalFeatureSet | null> {
  const receipt = await env.DB.prepare(
    `SELECT id, feature_set_hash, feature_count
     FROM natal_feature_sets
     WHERE user_id = ? AND chart_id = ? AND feature_policy_id = ?
       AND feature_policy_version = ?`,
  ).bind(
    userId,
    chart.id,
    NATAL_FEATURE_POLICY_ID,
    NATAL_FEATURE_POLICY_VERSION,
  ).first<ReceiptRow>();
  if (!receipt) return null;

  const result = await env.DB.prepare(
    `SELECT id, feature_json, feature_set_hash
     FROM natal_features
     WHERE user_id = ? AND chart_id = ? AND feature_policy_id = ?
       AND feature_policy_version = ? AND feature_set_hash = ?
     ORDER BY id`,
  ).bind(
    userId,
    chart.id,
    NATAL_FEATURE_POLICY_ID,
    NATAL_FEATURE_POLICY_VERSION,
    receipt.feature_set_hash,
  ).all<FeatureRow>();
  const rows = result.results ?? [];
  const features = rows.map((row) => parseJson<NatalFeature>(row.feature_json, "natal feature"));
  const computedHash = await sha256Hex(jcsCanonicalize({
    chart_fingerprint: chart.fingerprint,
    policy_id: NATAL_FEATURE_POLICY_ID,
    policy_version: NATAL_FEATURE_POLICY_VERSION,
    features,
  }));
  if (
    rows.length !== receipt.feature_count ||
    rows.some((row) => row.feature_set_hash !== receipt.feature_set_hash) ||
    features.some((feature, index) => feature.feature_id !== rows[index]!.id) ||
    computedHash !== receipt.feature_set_hash
  ) {
    throw new Error("natal feature completion receipt does not match stored rows");
  }
  return {
    featureSetId: receipt.id,
    featureSetHash: receipt.feature_set_hash,
    features,
  };
}

function storageType(feature: NatalFeature): string {
  return feature.feature_class === "uncertainty" ? "other" : feature.feature_class;
}

/**
 * Load or deterministically create one complete current-policy feature set.
 *
 * The chart lookup is owner-scoped before parsing. Feature rows and their
 * completion receipt share one D1 batch, so a reader can never mistake a
 * partial write for a current set.
 */
export async function ensureNatalFeatureSet(
  env: Env,
  userId: string,
  chartId: string,
  now = new Date(),
): Promise<DerivedNatalFeatureSet> {
  const chart = await env.DB.prepare(
    `SELECT id, fingerprint, birth_accuracy, snapshot_json, uncertainty_json
     FROM chart_snapshots
     WHERE user_id = ? AND id = ? AND status = 'active'`,
  ).bind(userId, chartId).first<ChartRow>();
  if (!chart) throw new Error("active chart not found for natal feature derivation");

  const completed = await loadCompletedSet(env, userId, chart);
  if (completed) return completed;

  const derived = await deriveNatalFeatureSet({
    chartId: chart.id,
    userId,
    chartFingerprint: chart.fingerprint,
    effectiveAccuracy: chart.birth_accuracy,
    snapshot: parseJson<unknown>(chart.snapshot_json, "chart snapshot"),
    uncertainty: parseJson<unknown>(chart.uncertainty_json, "chart uncertainty"),
  });
  const createdAt = now.toISOString();
  const statements = derived.features.map((feature) => env.DB.prepare(
    `INSERT INTO natal_features (
       id, chart_id, user_id, feature_type, body_a, body_b, aspect,
       feature_json, orb_policy_id, orb_policy_version, created_at,
       feature_policy_id, feature_policy_version, feature_set_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
  ).bind(
    feature.feature_id,
    chart.id,
    userId,
    storageType(feature),
    feature.feature_class === "position" ? feature.body
      : feature.feature_class === "aspect" ? feature.body_a
        : null,
    feature.feature_class === "aspect" ? feature.body_b : null,
    feature.feature_class === "aspect" ? feature.aspect : null,
    jcsCanonicalize(feature),
    createdAt,
    NATAL_FEATURE_POLICY_ID,
    NATAL_FEATURE_POLICY_VERSION,
    derived.featureSetHash,
  ));
  statements.push(env.DB.prepare(
    `INSERT INTO natal_feature_sets (
       id, chart_id, user_id, feature_policy_id, feature_policy_version,
       feature_set_hash, feature_count, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    derived.featureSetId,
    chart.id,
    userId,
    NATAL_FEATURE_POLICY_ID,
    NATAL_FEATURE_POLICY_VERSION,
    derived.featureSetHash,
    derived.features.length,
    createdAt,
  ));

  try {
    await env.DB.batch(statements);
    return derived;
  } catch {
    const winner = await loadCompletedSet(env, userId, chart);
    if (winner?.featureSetHash === derived.featureSetHash) return winner;
    if (winner) throw new Error("concurrent natal feature derivations did not converge");
    throw new Error("natal feature set could not be committed atomically");
  }
}
