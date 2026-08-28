#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "crypto-operations/v1";
const OPERATION_ID = /^cop_[0-9a-f]{32}$/;
const CAMPAIGN_ID = /^ckc_[0-9a-f]{32}$/;
const USER_ID = /^usr_[A-Za-z0-9_-]{4,128}$/;
const ROOT_KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const REASONS = new Set(["scheduled", "incident_response", "compliance"]);
const MAX_STEPS = 10_000;

function optionMap(args) {
  const result = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`invalid option near ${key ?? "end of command"}`);
    }
    if (result.has(key)) throw new Error(`duplicate option ${key}`);
    result.set(key, value);
  }
  return result;
}

function requireOnly(options, allowed) {
  for (const key of options.keys()) {
    if (!allowed.includes(key)) throw new Error(`unknown option ${key}`);
  }
  for (const key of allowed) {
    if (!options.has(key)) throw new Error(`missing option ${key}`);
  }
}

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = optionMap(rest);
  if (command === "dek-rotate") {
    requireOnly(options, ["--user-id", "--reason"]);
    const userId = options.get("--user-id");
    const reason = options.get("--reason");
    if (!USER_ID.test(userId) || !REASONS.has(reason)) {
      throw new Error("invalid DEK rotation arguments");
    }
    return { command, userId, reason };
  }
  if (command === "kek-campaign") {
    requireOnly(options, ["--target-root-key"]);
    const targetRootKey = options.get("--target-root-key");
    if (!ROOT_KEY_ID.test(targetRootKey)) throw new Error("invalid root key id");
    return { command, targetRootKey };
  }
  if (command === "resume") {
    if (options.size !== 1) throw new Error("resume requires exactly one id");
    if (options.has("--operation-id")) {
      const operationId = options.get("--operation-id");
      if (!OPERATION_ID.test(operationId)) throw new Error("invalid operation id");
      return { command, operationId };
    }
    if (options.has("--campaign-id")) {
      const campaignId = options.get("--campaign-id");
      if (!CAMPAIGN_ID.test(campaignId)) throw new Error("invalid campaign id");
      return { command, campaignId };
    }
    throw new Error(`unknown option ${[...options.keys()][0]}`);
  }
  if (command === "retry-blocked") {
    requireOnly(options, ["--campaign-id"]);
    const campaignId = options.get("--campaign-id");
    if (!CAMPAIGN_ID.test(campaignId)) throw new Error("invalid campaign id");
    return { command, campaignId };
  }
  throw new Error(`unknown command ${command ?? ""}`);
}

function defaultStateFile() {
  return process.env.PATTERNLIKE_CRYPTO_STATE_FILE ||
    path.join(os.homedir(), ".local", "state", "patternlike", "crypto-operations.json");
}

async function persistState(value) {
  const stateFile = defaultStateFile();
  await mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  await writeFile(stateFile, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(stateFile, 0o600);
}

function safeOperation(value) {
  return {
    operation_id: value.operation_id,
    stage: value.stage,
    reencrypted_count: value.reencrypted_count,
    not_before: value.not_before,
    error_class: value.error_class,
    created_at: value.created_at,
    updated_at: value.updated_at,
    completed_at: value.completed_at,
  };
}

function safeCampaign(value) {
  return {
    campaign_id: value.campaign_id,
    target_root_kek_id: value.target_root_kek_id,
    status: value.status,
    total_count: value.total_count,
    completed_count: value.completed_count,
    blocked_count: value.blocked_count,
    created_at: value.created_at,
    updated_at: value.updated_at,
    completed_at: value.completed_at,
  };
}

async function request(deps, route, method = "GET", body) {
  const response = await deps.fetch(`${deps.origin}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${deps.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(`operator_http_${response.status}`);
  }
  if (!response.ok) {
    const code = value?.error?.code;
    throw new Error(typeof code === "string" ? code : `operator_http_${response.status}`);
  }
  return value;
}

async function recordOperation(deps, value) {
  await deps.persist({
    schemaVersion: 1,
    operationId: value.operation_id,
    updatedAt: value.updated_at,
  });
  deps.write(JSON.stringify(safeOperation(value)));
}

async function recordCampaign(deps, value) {
  await deps.persist({
    schemaVersion: 1,
    campaignId: value.campaign_id,
    updatedAt: value.updated_at,
  });
  deps.write(JSON.stringify(safeCampaign(value)));
}

async function drainOperation(deps, initial) {
  let value = initial;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    await recordOperation(deps, value);
    if (value.stage === "succeeded") return value;
    if (["failed", "abandoned_to_deletion", "blocked"].includes(value.stage)) {
      throw new Error(`dek_rotation_${value.stage}`);
    }
    const notBefore = Date.parse(value.not_before ?? "");
    const delay = value.stage === "quiescing" && Number.isFinite(notBefore)
      ? Math.min(30_000, Math.max(0, notBefore - deps.now().getTime()))
      : 0;
    if (delay > 0) await deps.sleep(delay);
    value = await request(
      deps,
      `/crypto-operator/dek-rotations/${value.operation_id}/step`,
      "POST",
      {},
    );
  }
  throw new Error("dek_rotation_step_limit");
}

async function drainCampaign(deps, initial) {
  let value = initial;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    await recordCampaign(deps, value);
    if (value.status === "completed") return value;
    if (value.status === "blocked") throw new Error("kek_campaign_blocked");
    value = await request(
      deps,
      `/crypto-operator/kek-rewrap-campaigns/${value.campaign_id}/step`,
      "POST",
      {},
    );
  }
  throw new Error("kek_campaign_step_limit");
}

export async function executeCommand(parsed, overrides = {}) {
  const deps = {
    origin: overrides.origin ?? process.env.CRYPTO_OPERATOR_ORIGIN?.replace(/\/$/, ""),
    token: overrides.token ?? process.env.CRYPTO_OPERATOR_TOKEN,
    fetch: overrides.fetch ?? globalThis.fetch,
    persist: overrides.persist ?? persistState,
    sleep: overrides.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    write: overrides.write ?? ((line) => process.stdout.write(`${line}\n`)),
    now: overrides.now ?? (() => new Date()),
  };
  if (!deps.origin || !/^https:\/\//.test(deps.origin)) {
    throw new Error("CRYPTO_OPERATOR_ORIGIN must be an HTTPS origin");
  }
  if (!deps.token || deps.token.length < 32 || deps.token.length > 512) {
    throw new Error("CRYPTO_OPERATOR_TOKEN is unavailable");
  }

  if (parsed.command === "dek-rotate") {
    const value = await request(deps, "/crypto-operator/dek-rotations", "POST", {
      schema_version: SCHEMA_VERSION,
      user_id: parsed.userId,
      idempotency_key: crypto.randomUUID(),
      confirm: "ROTATE_USER_DEK",
      reason_class: parsed.reason,
    });
    return drainOperation(deps, value);
  }
  if (parsed.command === "kek-campaign") {
    const value = await request(deps, "/crypto-operator/kek-rewrap-campaigns", "POST", {
      schema_version: SCHEMA_VERSION,
      target_root_kek_id: parsed.targetRootKey,
      idempotency_key: crypto.randomUUID(),
      confirm: "REWRAP_ROOT_KEK",
    });
    return drainCampaign(deps, value);
  }
  if (parsed.command === "retry-blocked") {
    const value = await request(
      deps,
      `/crypto-operator/kek-rewrap-campaigns/${parsed.campaignId}/retry-blocked`,
      "POST",
      {
        schema_version: SCHEMA_VERSION,
        confirm: "RETRY_BLOCKED_KEK_ITEMS",
      },
    );
    return drainCampaign(deps, value);
  }
  if (parsed.operationId) {
    const value = await request(
      deps,
      `/crypto-operator/dek-rotations/${parsed.operationId}`,
    );
    return drainOperation(deps, value);
  }
  const value = await request(
    deps,
    `/crypto-operator/kek-rewrap-campaigns/${parsed.campaignId}`,
  );
  return drainCampaign(deps, value);
}

async function main() {
  try {
    await executeCommand(parseArguments(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "crypto_operation_failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
