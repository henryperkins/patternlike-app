import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { buildCodexChildEnvironment } from "./codex-cli.js";
import { CHATGPT_BASE_URL, DISABLED_FEATURES, PORTRAIT_CODEX_CLI_VERSION, PortraitError, inspectCli, isolatedMcpConfiguration, requireCleanHostInstructions } from "./portrait-invocation.js";

export interface IsolatedCodexJsonOptions {
  codexBin: string;
  model: string;
  effort: "xhigh";
  timeoutMs: number;
  instructions: string;
  input: Array<{ type: "text"; text: string; text_elements: never[] } | { type: "image"; url: string }>;
  outputSchema: object;
  maxOutputBytes: number;
  env?: NodeJS.ProcessEnv;
  tempRoot?: string;
  signal?: AbortSignal;
}
const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const THREAD = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PASSIVE_ITEMS = new Set(["userMessage", "agentMessage", "reasoning"]);
// Verified against `codex 0.153.3 features list`; environments:[] additionally removes apply_patch.
const JSON_DISABLED_FEATURES = ["view_image", "sleep_tool", "code_mode", "code_mode_host", "code_mode_only", "code_mode_prewarm", "goals", "request_permissions_tool", "default_mode_request_user_input", "deferred_executor", "token_budget", "skill_search", "skill_mcp_dependency_install", "workspace_dependencies", "shell_snapshot", "tool_call_mcp_elicitation", "artifact", "external_agent_memory_import", "context_management", "realtime_conversation"];
const fail = (fatal = false) => new PortraitError("generation_failed", fatal);

function verifyToolOverrides(response: Record<string, any>): void {
  // 0.153.3's typed merged Config omits these tool fields. Raw layer origins expose their effective values.
  if (!Array.isArray(response.layers) || response.layers.length > 256 || !record(response.origins)) throw fail(true);
  const layers = response.layers.filter((layer: unknown) => record(layer) && layer.name?.type === "sessionFlags" && !layer.disabledReason);
  if (layers.length !== 1 || typeof layers[0].version !== "string") throw fail(true);
  for (const tool of ["update_plan", "experimental_request_user_input"]) {
    const origin = response.origins[`tools.${tool}.enabled`];
    if (layers[0].config?.tools?.[tool]?.enabled !== false || origin?.name?.type !== "sessionFlags" || origin.version !== layers[0].version) throw fail(true);
  }
}

/** A fresh process/thread for every stage: no conversation, model tools, or host instructions carry across. */
export async function runIsolatedCodexJson(options: IsolatedCodexJsonOptions): Promise<{ value: unknown; providerRequestId: string }> {
  if (options.signal?.aborted || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 900_000
    || !Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0 || options.maxOutputBytes > 65536) throw fail();
  const deadline = Date.now() + options.timeoutMs;
  const env = buildCodexChildEnvironment(options.env ?? process.env);
  const home = env.CODEX_HOME ?? (env.HOME ? join(env.HOME, ".codex") : "");
  if (!isAbsolute(home)) throw new PortraitError("authentication_failed", true);
  await requireCleanHostInstructions(home);
  if (await inspectCli(options.codexBin, ["--version"], env) !== `codex-cli ${PORTRAIT_CODEX_CLI_VERSION}`
    || await inspectCli(options.codexBin, ["login", "status"], env) !== "Logged in using ChatGPT") throw new PortraitError("authentication_failed", true);
  if (options.signal?.aborted || Date.now() >= deadline) throw fail();
  const parent = options.tempRoot ?? tmpdir(); await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, "patternlike-mesh-"));
  try {
    await chmod(directory, 0o700);
    const instructionsFile = join(directory, "instructions.txt");
    await writeFile(instructionsFile, options.instructions, { mode: 0o600 });
    return await jsonTurn(options, env, home, directory, instructionsFile, deadline - Date.now());
  } finally {
    try { await rm(directory, { recursive: true, force: true }); } catch { throw fail(true); }
  }
}

function jsonTurn(options: IsolatedCodexJsonOptions, env: NodeJS.ProcessEnv, home: string, cwd: string, instructionsFile: string, timeoutMs: number): Promise<{ value: unknown; providerRequestId: string }> {
  return new Promise((resolveValue, reject) => {
    const args = ["app-server", "--stdio", "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"',
      "-c", 'web_search="disabled"', "-c", "notify=[]", "-c", 'instructions=""', "-c", 'developer_instructions=""',
      "-c", "project_doc_max_bytes=0", "-c", "skills.include_instructions=false", "-c", `model_instructions_file=${JSON.stringify(instructionsFile)}`,
      "-c", `experimental_compact_prompt_file=${JSON.stringify(instructionsFile)}`, "-c", `chatgpt_base_url=${JSON.stringify(CHATGPT_BASE_URL)}`,
      "-c", "tools.update_plan.enabled=false", "-c", "tools.experimental_request_user_input.enabled=false",
      "--enable", "skip_host_skill_discovery", "--disable", "image_generation", ...[...DISABLED_FEATURES, ...JSON_DISABLED_FEATURES].flatMap((feature) => ["--disable", feature])];
    const child = spawn(options.codexBin, args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let pending = ""; let eventBytes = 0; let threadId = ""; let turnId = ""; let expectedResponse = 1;
    let configuration: Record<string, { enabled: false; required: false }> | null = null;
    let finalValue: unknown; let hasFinal = false;
    let result: { value: unknown; providerRequestId: string } | null = null;
    let error: Error | null = null; let stopping = false; let killTimer: NodeJS.Timeout | undefined;
    const send = (id: number, method: string, params: unknown) => { expectedResponse = id; child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); };
    const stop = (cause?: Error) => {
      if (cause && !error) error = cause;
      if (stopping) return; stopping = true; child.stdin.end(); child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000); killTimer.unref();
    };
    const timer = setTimeout(() => stop(fail()), Math.max(1, timeoutMs)); timer.unref();
    const abort = () => stop(fail()); options.signal?.addEventListener("abort", abort, { once: true });
    child.stdin.on("error", () => undefined);
    child.once("error", () => { error = fail(true); });
    const handle = (message: unknown) => {
      if (!record(message) || message.error || (message.id !== undefined && message.method)) throw fail();
      if (message.id !== undefined) {
        if (message.id !== expectedResponse || !record(message.result)) throw fail();
        expectedResponse = 0;
        const response = message.result;
        if (message.id === 1) {
          if (typeof response.codexHome !== "string" || resolve(response.codexHome) !== resolve(home)) throw new PortraitError("authentication_failed", true);
          child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
          send(4, "config/read", { includeLayers: true, cwd });
        } else if (message.id === 4) {
          configuration = isolatedMcpConfiguration(response.config, instructionsFile, false);
          if (JSON_DISABLED_FEATURES.some((feature) => response.config.features?.[feature] !== false)) throw fail(true);
          verifyToolOverrides(response);
          send(5, "configRequirements/read", {});
        } else if (message.id === 5) {
          const requirements = response.requirements;
          if (!configuration || (requirements !== null && (!record(requirements) || requirements.additionalDeveloperInstructions || requirements.hooks
            || (requirements.chatgptBaseUrl && requirements.chatgptBaseUrl !== CHATGPT_BASE_URL)))) throw fail(true);
          send(2, "thread/start", { model: options.model, modelProvider: "openai", cwd, approvalPolicy: "never", sandbox: "read-only", ephemeral: true, environments: [],
            baseInstructions: options.instructions, developerInstructions: "", config: { model_reasoning_effort: options.effort, forced_login_method: "chatgpt", mcp_servers: configuration } });
        } else if (message.id === 2) {
          if (!THREAD.test(response.thread?.id ?? "") || response.model !== options.model || response.modelProvider !== "openai"
            || response.sandbox?.type !== "readOnly" || response.approvalPolicy !== "never") throw fail(true);
          threadId = response.thread.id;
          send(6, "mcpServerStatus/list", { threadId, limit: 257, detail: "toolsAndAuthOnly" });
        } else if (message.id === 6) {
          if (!threadId || response.nextCursor !== null || !Array.isArray(response.data) || response.data.length > 256
            || response.data.some((server: unknown) => !record(server) || server.runtimeStatus !== "disabled" || !record(server.tools) || Object.keys(server.tools).length !== 0)) throw fail(true);
          send(3, "turn/start", { threadId, input: options.input, model: options.model, effort: options.effort, outputSchema: options.outputSchema });
        } else if (message.id === 3) {
          const id = response.turn?.id;
          if (typeof id !== "string" || !ID.test(id) || (turnId && id !== turnId)) throw fail();
          turnId = id;
        } else throw fail();
        return;
      }
      if (typeof message.method !== "string" || !record(message.params)) throw fail();
      const params = message.params;
      if (["turn/started", "item/started", "item/completed", "turn/completed"].includes(message.method)) {
        const id = message.method.startsWith("turn/") ? params.turn?.id : params.turnId;
        if (!threadId || params.threadId !== threadId || typeof id !== "string" || !ID.test(id) || (turnId && turnId !== id)) throw fail();
        turnId = id;
      }
      if (message.method === "item/started" || message.method === "item/completed") {
        if (!record(params.item) || !PASSIVE_ITEMS.has(params.item.type)) throw fail();
        if (message.method === "item/completed" && params.item.type === "agentMessage" && params.item.phase !== "commentary") {
          if (hasFinal || typeof params.item.text !== "string" || Buffer.byteLength(params.item.text) > options.maxOutputBytes) throw fail();
          try { finalValue = JSON.parse(params.item.text); } catch { throw fail(); }
          hasFinal = true;
        }
      }
      if (message.method === "turn/completed") {
        if (expectedResponse !== 0 || params.turn?.status !== "completed" || params.turn?.error || !hasFinal) throw fail();
        result = { value: finalValue, providerRequestId: `${threadId}:${turnId}` }; stop();
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stopping) return;
      eventBytes += Buffer.byteLength(chunk); pending += chunk;
      // Input image may be echoed in a userMessage; retain only this bounded streaming window.
      if (eventBytes > 32 * 1024 * 1024 || Buffer.byteLength(pending) > 16 * 1024 * 1024) { stop(fail()); return; }
      let newline: number;
      while (!stopping && (newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        try { handle(JSON.parse(line)); } catch (cause) { stop(cause instanceof PortraitError ? cause : fail()); }
      }
    });
    child.once("close", () => {
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer); options.signal?.removeEventListener("abort", abort);
      if (error) reject(error); else if (result) resolveValue(result); else reject(fail());
    });
    if (options.signal?.aborted) abort();
    else send(1, "initialize", { clientInfo: { name: "patternlike_mesh_runner", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  });
}
