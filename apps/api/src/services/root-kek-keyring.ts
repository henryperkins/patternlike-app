import {
  DEV_ROOT_KEK,
  isDevEnvironment,
  resolveRootKey,
} from "../crypto.js";

const ROOT_KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const MIN_ROOT_SECRET_LENGTH = 32;
const MAX_ROOT_KEYS = 4;

export interface RootKekKeyringEnv {
  ROOT_KEK?: string;
  ROOT_KEK_KEYRING?: string;
  ENVIRONMENT?: string;
}

export class RootKekKeyringError extends Error {
  readonly code = "root_kek_id_unavailable";

  constructor() {
    super("The wrapping key for this encrypted row is unavailable");
    this.name = "RootKekKeyringError";
  }
}

export interface ResolvedRootKekKeyring {
  activeKeyId: string;
  keyIds: readonly string[];
  resolve(keyId: string): Promise<CryptoKey>;
}

export type RootKekKeyringOutcome =
  | { ok: true; value: ResolvedRootKekKeyring }
  | {
      ok: false;
      code: "root_kek_not_configured" | "root_kek_keyring_invalid";
    };

function closedObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildResolved(
  activeKeyId: string,
  materials: ReadonlyMap<string, string>,
  allowDevPlaceholder: boolean,
): ResolvedRootKekKeyring {
  const keyIds = [...materials.keys()];
  return {
    activeKeyId,
    keyIds,
    async resolve(keyId: string): Promise<CryptoKey> {
      const material = materials.get(keyId);
      if (material === undefined) throw new RootKekKeyringError();
      return resolveRootKey({
        ROOT_KEK: material,
        ENVIRONMENT: allowDevPlaceholder ? "test" : "production",
      });
    },
  };
}

export function readRootKekKeyring(
  env: RootKekKeyringEnv,
): RootKekKeyringOutcome {
  const encoded = env.ROOT_KEK_KEYRING?.trim();
  if (!encoded) {
    const legacy = env.ROOT_KEK?.trim() ||
      (isDevEnvironment(env.ENVIRONMENT) ? DEV_ROOT_KEK : "");
    if (!legacy || legacy.length < MIN_ROOT_SECRET_LENGTH) {
      return { ok: false, code: "root_kek_not_configured" };
    }
    return {
      ok: true,
      value: buildResolved(
        "legacy",
        new Map([["legacy", legacy]]),
        isDevEnvironment(env.ENVIRONMENT),
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    return { ok: false, code: "root_kek_keyring_invalid" };
  }
  if (!closedObject(parsed)) {
    return { ok: false, code: "root_kek_keyring_invalid" };
  }
  const fields = Object.keys(parsed).sort();
  if (
    fields.length !== 3 ||
    fields[0] !== "active_key_id" ||
    fields[1] !== "keys" ||
    fields[2] !== "version" ||
    parsed.version !== 1 ||
    typeof parsed.active_key_id !== "string" ||
    !ROOT_KEY_ID.test(parsed.active_key_id) ||
    !closedObject(parsed.keys)
  ) {
    return { ok: false, code: "root_kek_keyring_invalid" };
  }

  const entries = Object.entries(parsed.keys);
  if (entries.length < 1 || entries.length > MAX_ROOT_KEYS) {
    return { ok: false, code: "root_kek_keyring_invalid" };
  }
  const materials = new Map<string, string>();
  for (const [keyId, rawMaterial] of entries) {
    if (
      !ROOT_KEY_ID.test(keyId) ||
      typeof rawMaterial !== "string" ||
      rawMaterial.trim().length < MIN_ROOT_SECRET_LENGTH
    ) {
      return { ok: false, code: "root_kek_keyring_invalid" };
    }
    materials.set(keyId, rawMaterial.trim());
  }
  if (!materials.has(parsed.active_key_id)) {
    return { ok: false, code: "root_kek_keyring_invalid" };
  }
  return {
    ok: true,
    value: buildResolved(
      parsed.active_key_id,
      materials,
      isDevEnvironment(env.ENVIRONMENT),
    ),
  };
}

export async function resolveRootKeyById(
  env: RootKekKeyringEnv,
  keyId: string,
): Promise<CryptoKey> {
  const outcome = readRootKekKeyring(env);
  if (!outcome.ok) throw new RootKekKeyringError();
  return outcome.value.resolve(keyId);
}

export async function resolveActiveRootKey(
  env: RootKekKeyringEnv,
): Promise<{ keyId: string; key: CryptoKey }> {
  const outcome = readRootKekKeyring(env);
  if (!outcome.ok) throw new RootKekKeyringError();
  return {
    keyId: outcome.value.activeKeyId,
    key: await outcome.value.resolve(outcome.value.activeKeyId),
  };
}
