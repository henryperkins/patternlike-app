import { b64, fromB64, resolveRootKey } from "../crypto.js";
import type { Env } from "../env.js";

export const ACCOUNT_EXPORT_SCHEMA_ID =
  "https://patternlike.app/contracts/m6/account-export.schema.json";
export const MAX_EXPORT_PLAINTEXT_BYTES = 16 * 1024 * 1024;
export const MAX_EXPORT_CIPHERTEXT_BYTES = MAX_EXPORT_PLAINTEXT_BYTES + 16;
export const EXPORT_KEK_VERSION = 1;

export interface SealedExport {
  ciphertext: Uint8Array;
  artifactNonce: string;
  wrappedExportKey: Uint8Array;
  exportKeyNonce: string;
  exportKekVersion: number;
}

function aad(label: string, exportId: string, createdAt: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([label, ACCOUNT_EXPORT_SCHEMA_ID, exportId, createdAt]),
  );
}

async function importExportKey(
  raw: Uint8Array,
  usages: Array<"encrypt" | "decrypt">,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, usages);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBytes(
  value: ArrayBuffer | ArrayBufferView | readonly number[],
): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return Uint8Array.from(value);
}

export function exportObjectKey(exportId: string): string {
  if (!/^exp_[a-f0-9]{32}$/.test(exportId)) {
    throw new Error("invalid export request id");
  }
  return `exports/${exportId}.json.enc`;
}

export function assertExportPlaintextSize(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_EXPORT_PLAINTEXT_BYTES) {
    throw new ExportTooLargeError();
  }
}

export class ExportTooLargeError extends Error {
  readonly code = "export_too_large";
  constructor() {
    super("Portable export exceeds the application size limit");
    this.name = "ExportTooLargeError";
  }
}

export async function sealExport(
  env: Env,
  exportId: string,
  createdAt: string,
  plaintext: Uint8Array,
): Promise<SealedExport> {
  assertExportPlaintextSize(plaintext);
  const rawKey = randomBytes(32);
  const exportKey = await importExportKey(rawKey, ["encrypt"]);
  const artifactNonce = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: artifactNonce,
        additionalData: aad("patternlike.account-export", exportId, createdAt),
      },
      exportKey,
      plaintext,
    ),
  );

  const rootKey = await resolveRootKey(env);
  const exportKeyNonce = randomBytes(12);
  const wrappedExportKey = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: exportKeyNonce,
        additionalData: aad("patternlike.account-export-key", exportId, createdAt),
      },
      rootKey,
      rawKey,
    ),
  );

  return {
    ciphertext,
    artifactNonce: b64(artifactNonce),
    wrappedExportKey,
    exportKeyNonce: b64(exportKeyNonce),
    exportKekVersion: EXPORT_KEK_VERSION,
  };
}

export async function openExport(
  env: Env,
  exportId: string,
  createdAt: string,
  sealed: {
    ciphertext: ArrayBuffer | ArrayBufferView | readonly number[];
    artifactNonce: string;
    wrappedExportKey: ArrayBuffer | ArrayBufferView | readonly number[];
    exportKeyNonce: string;
    exportKekVersion: number;
  },
): Promise<Uint8Array> {
  if (sealed.exportKekVersion !== EXPORT_KEK_VERSION) {
    throw new Error("unsupported export KEK version");
  }
  const rootKey = await resolveRootKey(env);
  const rawKey = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromB64(sealed.exportKeyNonce),
        additionalData: aad("patternlike.account-export-key", exportId, createdAt),
      },
      rootKey,
      toBytes(sealed.wrappedExportKey),
    ),
  );
  const exportKey = await importExportKey(rawKey, ["decrypt"]);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromB64(sealed.artifactNonce),
        additionalData: aad("patternlike.account-export", exportId, createdAt),
      },
      exportKey,
      toBytes(sealed.ciphertext),
    ),
  );
}
