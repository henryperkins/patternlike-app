import { canonicalJson, type ReadingHistoryView } from "@patternlike/shared";

export type ReadingHistoryCursor =
  | {
      v: 1;
      view: "history";
      local_date: string;
      reading_id: string;
    }
  | {
      v: 1;
      view: "saved";
      saved_at: string;
      reading_id: string;
    };

export const MAX_READING_HISTORY_CURSOR_LENGTH = 2048;

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padding = "=".repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isIsoInstant(value: unknown): value is string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf());
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function isCursorForView(
  value: unknown,
  view: ReadingHistoryView,
): value is ReadingHistoryCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  if (
    cursor.v !== 1
    || cursor.view !== view
    || typeof cursor.reading_id !== "string"
    || cursor.reading_id.length < 8
    || cursor.reading_id.length > 128
    || !/^[A-Za-z0-9_.:-]+$/.test(cursor.reading_id)
  ) {
    return false;
  }
  if (view === "history") {
    return exactKeys(cursor, ["v", "view", "local_date", "reading_id"])
      && isLocalDate(cursor.local_date);
  }
  return exactKeys(cursor, ["v", "view", "saved_at", "reading_id"])
    && isIsoInstant(cursor.saved_at);
}

export function encodeReadingHistoryCursor(cursor: ReadingHistoryCursor): string {
  return toBase64Url(canonicalJson(cursor));
}

export function parseReadingHistoryCursor(
  encoded: string,
  view: ReadingHistoryView,
): ReadingHistoryCursor | null {
  if (!encoded || encoded.length > MAX_READING_HISTORY_CURSOR_LENGTH) return null;
  const json = fromBase64Url(encoded);
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isCursorForView(value, view)) return null;
  return encodeReadingHistoryCursor(value) === encoded ? value : null;
}
