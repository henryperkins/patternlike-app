import { isPortraitChapterCount } from "@patternlike/shared";
import { PortraitError, type PortraitRow } from "./pattern-portrait.js";

export const PORTRAIT_PROTOCOL_HEADER = "X-Patternlike-Portrait-Protocol";
export type PortraitProtocol = "v1" | "v2";

/** Capability does not grant permission to generate artwork. */
export function portraitProtocol(header: string | undefined): PortraitProtocol {
  if (header === undefined) return "v1";
  if (header === "v2") return "v2";
  throw new PortraitError(400, "unsupported_portrait_protocol");
}

export function validPortraitBinding(value: Record<string, unknown>): boolean {
  return isPortraitChapterCount(value.chapter_count) && Number.isInteger(value.chapter_index)
    && Number(value.chapter_index) >= 0 && Number(value.chapter_index) < value.chapter_count
    && value.chapter_id === `chapter-${Number(value.chapter_index) + 1}`
    && typeof value.document_revision === "string" && value.document_revision.length > 0
    && value.document_revision.length <= 256 && !/[\u0000-\u001f]/.test(value.document_revision);
}

/** Terminals may never reinterpret an existing lease as another protocol. */
export function portraitTerminalMatches(row: PortraitRow, index: number, value: object, schema: string): boolean {
  if (row.protocol_version === "v1") return !("schema_version" in value);
  const terminal = value as Record<string, unknown>;
  return terminal.schema_version === schema && validPortraitBinding(terminal)
    && terminal.chapter_count === row.chapter_count && terminal.chapter_index === index
    && terminal.document_revision === row.document_revision;
}
