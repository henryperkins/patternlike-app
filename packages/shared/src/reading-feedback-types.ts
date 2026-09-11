/** Additive categorical feedback. Existing resonance contracts stay unchanged. */
export const READING_FEEDBACK_USE_POLICY_VERSION = "categorized-feedback-use/v1" as const;
export const READING_FEEDBACK_EFFECT_WINDOW_DAYS = 7 as const;
export const READING_FEEDBACK_RETENTION_MONTHS = 24 as const;
export const FEEDBACK_EXPORT_SCHEMA_VERSION = "account-export-feedback/v1" as const;

export const READING_FEEDBACK_CATEGORIES = ["repetitive", "not_relevant_today", "unclear"] as const;
export type ReadingFeedbackCategory = typeof READING_FEEDBACK_CATEGORIES[number];
export type ReadingFeedbackGrantAction = "create" | "reuse" | "renew";

export interface ReadingFeedbackTarget {
  reading_id: string;
  revision: number;
  content_hash: string;
  paragraph_id: string | null;
}

export interface ReadingFeedbackEventRequest {
  schema_version: "reading-feedback-event/v1";
  category: ReadingFeedbackCategory;
  revision: number;
  content_hash: string;
  paragraph_id?: string | null;
  note?: string | null;
  feedback_use_policy_version: typeof READING_FEEDBACK_USE_POLICY_VERSION;
  /** Opaque current-state precondition; never an authorization credential. */
  expected_grant_state: string;
  confirm_feedback_use: true;
}

interface ReadingFeedbackReceiptBase {
  schema_version: "reading-feedback-event-receipt/v1";
  id: string;
  target: ReadingFeedbackTarget;
  created_at: string;
  retention_expires_at: string;
  feedback_use_policy_version: typeof READING_FEEDBACK_USE_POLICY_VERSION;
}

export type ReadingFeedbackEventReceipt = ReadingFeedbackReceiptBase & (
  | { category: "repetitive" | "not_relevant_today"; effect_expires_at: string }
  | { category: "unclear"; effect_expires_at: null }
);

export interface ReadingFeedbackOptionsResponse {
  schema_version: "reading-feedback-options/v1";
  target: ReadingFeedbackTarget;
  feedback_use_policy_version: typeof READING_FEEDBACK_USE_POLICY_VERSION;
  expected_grant_state: string;
  grant_action: ReadingFeedbackGrantAction;
  categories: ReadingFeedbackCategory[];
  effect_window_days: typeof READING_FEEDBACK_EFFECT_WINDOW_DAYS;
  retention_months: typeof READING_FEEDBACK_RETENTION_MONTHS;
  /** Storage/receipt availability does not imply an activated effect compiler. */
  generation_effects_active: boolean;
  latest_event: ReadingFeedbackEventReceipt | null;
}

/** Portable user feedback; internal derived evidence associations are not prose. */
export type ReadingFeedbackEventExport = ReadingFeedbackEventReceipt & { note: string | null };

export type ReadingFeedbackEventsExportSection =
  | { status: "included"; items: ReadingFeedbackEventExport[] }
  | { status: "omitted_by_request"; items: [] };

/** Retains every M8 account-export section under a distinct document version. */
export type FeedbackAccountExport<TM8 extends { schema_version: string }> =
  Omit<TM8, "schema_version"> & {
    schema_version: typeof FEEDBACK_EXPORT_SCHEMA_VERSION;
    reading_feedback_events: ReadingFeedbackEventsExportSection;
  };
