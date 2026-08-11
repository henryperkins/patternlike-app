/**
 * Preflight: prove the configured model exists on the authorized account.
 *
 * A production gate, not a test. `checkSecureConfig` pins one exact model id;
 * this is what establishes that the id is real for the key that will be used,
 * and the rollout runbook requires it before initial enablement and again before
 * every later model change. Running it against a real key is separately
 * authorized — the file is written, typechecked, and never invoked by CI.
 *
 *   OPENAI_API_KEY=sk-... npm run publisher:model:verify -w @patternlike/api
 *
 * It prints the model id and a verdict. It never prints the key, the response
 * headers, or the response body: an operator needs to know whether the model is
 * reachable, and nothing in the answer beyond that is theirs to paste into a
 * ticket.
 */

import process from "node:process";

import { OPENAI_READING_MODEL } from "../src/services/reading-publisher.js";

const MODELS_URL = "https://api.openai.com/v1/models";

async function main(): Promise<number> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("FAIL  OPENAI_API_KEY is not set");
    return 2;
  }

  const model = process.env.OPENAI_READING_MODEL?.trim() || OPENAI_READING_MODEL;
  if (model !== OPENAI_READING_MODEL) {
    // The override exists so a candidate model can be checked before the pinned
    // constant changes. It is reported, never silently accepted.
    console.error(`FAIL  ${model} is not the pinned model ${OPENAI_READING_MODEL}`);
    return 2;
  }

  let response: Response;
  try {
    response = await fetch(`${MODELS_URL}/${encodeURIComponent(model)}`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
  } catch {
    console.error(`FAIL  ${model} — the model endpoint could not be reached`);
    return 1;
  }

  if (response.status === 401 || response.status === 403) {
    console.error(`FAIL  ${model} — the key is not authorized for this account`);
    return 1;
  }
  if (response.status === 404) {
    console.error(`FAIL  ${model} — no such model on this account`);
    return 1;
  }
  if (!response.ok) {
    console.error(`FAIL  ${model} — the model endpoint answered ${response.status}`);
    return 1;
  }

  let id: unknown;
  try {
    id = ((await response.json()) as { id?: unknown }).id;
  } catch {
    console.error(`FAIL  ${model} — the model endpoint answer was unreadable`);
    return 1;
  }
  if (id !== model) {
    console.error(`FAIL  ${model} — the account resolved it to a different id`);
    return 1;
  }

  console.log(`PASS  ${model}`);
  return 0;
}

process.exitCode = await main();
