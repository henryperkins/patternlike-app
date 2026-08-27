/** M8 reading-library and revision-specific Save wire types. */

import type { M8SchemaVersion } from "./m8-place-types.js";

export type ReadingHistoryView = "history" | "saved";

export type ReadingHistoryStatus =
  | "published"
  | "superseded"
  | "invalidated";

export type ReadingRevisionReason =
  | "initial"
  | "chart_recalculated"
  | "consent_revoked"
  | "safety_correction"
  | "defect_repair";

export type ReadingAssemblyMode = "deterministic" | "constrained_model";

export interface ReadingHistoryItem {
  reading_id: string;
  local_date: string;
  revision: number;
  revision_reason: ReadingRevisionReason;
  status: ReadingHistoryStatus;
  assembly_mode: ReadingAssemblyMode;
  headline: string | null;
  saved: boolean;
  saved_at: string | null;
  evidence_url: string;
}

export interface ReadingHistoryResponse {
  schema_version: M8SchemaVersion;
  view: ReadingHistoryView;
  items: ReadingHistoryItem[];
  next_cursor: string | null;
}

export interface ReadingSaveState {
  schema_version: M8SchemaVersion;
  reading_id: string;
  saved: boolean;
  saved_at: string | null;
}
