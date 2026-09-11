import type { ReaderAction } from "./reader-readiness.js";
/** Fixed local destinations. Exact editions are resolved by the existing reader, never a status URL. */
export const READER_ROUTES = { today: "#today", pattern: "#pattern", privacy: "#privacy" } as const;
export function readerActionRoute(action: ReaderAction): string | null {
  switch (action.type) {
    case "open_birth_details": return READER_ROUTES.pattern;
    case "confirm_locale": return READER_ROUTES.today;
    case "review_consent": return action.surface === "daily" ? READER_ROUTES.today : READER_ROUTES.pattern;
    default: return null;
  }
}
