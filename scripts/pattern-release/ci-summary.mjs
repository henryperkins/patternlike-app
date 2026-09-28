#!/usr/bin/env node
// The local gate and its receipt consumer share this exact ordered contract.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CI_STEPS = Object.freeze([
  ["contracts", "contracts: npm run test:contracts"],
  ["install", "monorepo: npm ci (install or dry-run)"],
  ["ephemeris", "monorepo: ephemeris download"],
  ["typecheck", "monorepo: npm run typecheck"],
  ["shared", "monorepo: test @patternlike/shared"],
  ["reading-engine", "monorepo: test @patternlike/reading-engine"],
  ["calc-stub", "monorepo: test @patternlike/calc-stub"],
  ["ontology-signer", "monorepo: test @patternlike/ontology-signer"],
  ["api", "monorepo: test @patternlike/api"],
  ["web", "monorepo: test @patternlike/web"],
  ["build", "monorepo: npm run build"],
  ["pattern-engine", "extra: test @patternlike/pattern-engine"],
  ["codex-runner", "extra: test @patternlike/codex-runner"],
  ["content", "extra: npm run test:content"],
  ["source-map-tests", "extra: npm run test:source-map"],
  ["source-map-current", "extra: npm run map:check:current"],
].map(([id, name]) => Object.freeze({ id, name })));
export const CI_LANES = Object.freeze(CI_STEPS.map(({ name }) => name));
export const CI_SUMMARY_VERSION = "patternlike-ci-summary.v1";
export const CI_SUMMARY_BEGIN = "PATTERNLIKE_CI_SUMMARY_V1_BEGIN";
export const CI_SUMMARY_PASSED = "PATTERNLIKE_CI_SUMMARY_V1_PASSED";
export const CI_SUMMARY_FAILED = "PATTERNLIKE_CI_SUMMARY_V1_FAILED";
export const CI_SUMMARY_END = "PATTERNLIKE_CI_SUMMARY_V1_END";

const passingLanes = (lanes) => lanes.length === CI_LANES.length
  && lanes.every((lane, index) => lane.name === CI_LANES[index] && lane.result === "pass");
const toolchainLine = ({ node, npm, python }) => `node ${node} npm ${npm} python ${python}`;
const parseToolchain = (line) => {
  const match = /^node (v\d+\.\d+\.\d+) npm (\d+\.\d+\.\d+) python (\d+\.\d+\.\d+)$/.exec(line);
  return match ? { node: match[1], npm: match[2], python: match[3] } : null;
};

export function formatCiSummary({ toolchain, lanes }) {
  if (!toolchain || !parseToolchain(toolchainLine(toolchain)) || !Array.isArray(lanes)
    || lanes.some((lane) => !lane || !["pass", "FAIL", "skip"].includes(lane.result)
      || typeof lane.name !== "string" || !/^[\x20-\x7e]+$/.test(lane.name))) {
    throw new Error("ci_summary_invalid");
  }
  return [
    CI_SUMMARY_BEGIN,
    toolchainLine(toolchain),
    ...lanes.map(({ name, result }) => `${result}\t${name}`),
    passingLanes(lanes) ? CI_SUMMARY_PASSED : CI_SUMMARY_FAILED,
    CI_SUMMARY_END,
    "",
  ].join("\n");
}

export function parseCiSummary(output, exitCode) {
  const clean = typeof output === "string" ? output.replace(/\u001b\[[0-9;]*m/g, "") : "";
  const lines = clean.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const starts = lines.flatMap((line, index) => line === CI_SUMMARY_BEGIN ? [index] : []);
  const block = starts.length === 1 ? lines.slice(starts[0]) : [];
  const toolchain = parseToolchain(block[1] ?? "");
  const finalSuccess = block.at(-2) === CI_SUMMARY_PASSED;
  const entries = block.slice(2, -2).map((line) => {
    const match = /^(pass|FAIL|skip)\t([\x20-\x7e]+)$/.exec(line);
    return match ? { name: match[2], result: match[1] } : null;
  });
  const lanes = entries.filter((lane) => lane !== null);
  const complete = block.at(-1) === CI_SUMMARY_END && entries.every(Boolean)
    && toolchain !== null && passingLanes(lanes);
  return {
    format_version: CI_SUMMARY_VERSION,
    exit_code: Number.isInteger(exitCode) ? exitCode : null,
    passed: exitCode === 0 && finalSuccess && complete,
    final_success: finalSuccess,
    toolchain,
    lanes,
  };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "lanes" && args.length === 0) {
    process.stdout.write(CI_STEPS.map(({ id, name }) => `${id}\t${name}\n`).join(""));
    return;
  }
  if (command !== "format" || args.length < 3) throw new Error("ci_summary_usage_invalid");
  const [node, npm, python, ...records] = args;
  const lanes = records.map((entry) => {
    const [result, name, ...extra] = entry.split("\t");
    if (extra.length) throw new Error("ci_summary_invalid");
    return { name, result };
  });
  process.stdout.write(formatCiSummary({ toolchain: { node, npm, python }, lanes }));
  if (!passingLanes(lanes)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch {
    process.stderr.write("ci_summary_invalid\n");
    process.exitCode = 2;
  }
}
