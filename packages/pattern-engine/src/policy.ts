export const PATTERN_SELECTION_POLICY_ID = "pattern-selection-policy" as const;
export const PATTERN_SELECTION_POLICY_VERSION = "1.0.0" as const;
export const PATTERN_VALIDATION_POLICY_ID = "pattern-validation-policy" as const;
export const PATTERN_VALIDATION_POLICY_VERSION = "1.0.0" as const;

/** Provider packet bound. Launch default; a bump is a policy version change. */
export const MAX_ELIGIBLE_ALIASES = 40;
/** Mandatory aliases inside that packet. Excess refuses rather than demoting. */
export const MAX_MANDATORY_ALIASES = 12;
/** Connected component size before a deterministic split. */
export const MAX_CLUSTER_SIZE = 8;

export const CORE_CHAPTERS_MIN = 4;
export const CORE_CHAPTERS_MAX = 6;
export const SPARSE_CHAPTERS = 3;
export const ADDITIONAL_SIGNATURES_MAX = 8;

export const CHAPTER_WORD_MIN = 250;
export const CHAPTER_WORD_MAX = 550;
export const SPARSE_CHAPTER_WORD_MIN = 150;
export const SIGNATURE_WORD_MIN = 70;
export const SIGNATURE_WORD_MAX = 160;
export const UNCERTAINTY_WORD_MIN = 40;
export const UNCERTAINTY_WORD_MAX = 140;
export const TOTAL_WORD_MIN = 1500;
export const SPARSE_TOTAL_WORD_MIN = 800;
export const TOTAL_WORD_MAX = 4500;
export const PARAGRAPH_WORD_MAX = 180;
export const TITLE_CHAR_MAX = 90;
export const LIST_ITEM_MAX = 5;
export const SECTIONS_MIN = 2;
export const SECTIONS_MAX = 6;
