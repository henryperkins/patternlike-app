import type { Facet } from "./types.js";
import type { PortraitSkyBody } from "../../lib/portrait-sky.js";

export type ExplorerView =
  | { kind: "whole" }
  | { kind: "chapter"; chapterId: string }
  | { kind: "compare"; chapterIds: [string, string] }
  | { kind: "guided"; step: number };

export interface ExplorerSnapshot {
  sky: { body: PortraitSkyBody | null } | null;
  view: ExplorerView;
  facets: Record<string, Facet>;
  passages: Record<string, number>;
  unfolded: boolean;
  presentation: "explore" | "reading" | "scene" | "full";
  inspectImage: boolean;
  inspectChapterId: string | null;
}

export interface ExplorerState extends ExplorerSnapshot {
  past: ExplorerSnapshot[];
  chapterIds: readonly string[];
}

export type ExplorerAction =
  | { type: "sky"; body: PortraitSkyBody | null }
  | { type: "select"; chapterId: string }
  | { type: "facet"; facet: Facet }
  | { type: "passage"; index: number; chapterId?: string }
  | { type: "whole" }
  | { type: "compare"; chapterId: string }
  | { type: "guide" }
  | { type: "guide-step"; step: number }
  | { type: "presentation"; presentation: ExplorerSnapshot["presentation"] }
  | { type: "inspect"; open: boolean; chapterId?: string }
  | { type: "unfold"; overview?: boolean }
  | { type: "back" };

export function createExplorerState(chapterIds: readonly string[]): ExplorerState {
  const ids = [...new Set(chapterIds.filter((id) => typeof id === "string" && /^[a-z0-9][a-z0-9_-]*$/i.test(id)))];
  return {
    sky: null,
    view: { kind: "whole" },
    facets: Object.fromEntries(ids.map((id) => [id, "overview" as const])),
    passages: Object.fromEntries(ids.map((id) => [id, 0])),
    unfolded: false,
    presentation: "explore",
    inspectImage: false,
    inspectChapterId: null,
    past: [],
    chapterIds: ids,
  };
}

export function selectedChapterIds(state: ExplorerState): string[] {
  switch (state.view.kind) {
    case "whole": return [];
    case "chapter": return [state.view.chapterId];
    case "compare": return [...state.view.chapterIds];
    case "guided": return state.chapterIds[state.view.step] ? [state.chapterIds[state.view.step]] : [];
  }
}

export function currentFacet(state: ExplorerState): Facet {
  const chapterId = selectedChapterIds(state)[0];
  return chapterId ? state.facets[chapterId] ?? "overview" : "overview";
}

export function canGoBack(state: ExplorerState): boolean { return state.past.length > 0; }

function snapshot(state: ExplorerState): ExplorerSnapshot {
  const { sky, view, facets, passages, unfolded, presentation, inspectImage, inspectChapterId } = state;
  return { sky, view, facets, passages, unfolded, presentation, inspectImage, inspectChapterId };
}

function transition(state: ExplorerState, update: Partial<ExplorerSnapshot>, remember = true): ExplorerState {
  return {
    ...state,
    ...update,
    past: remember ? [...state.past.slice(-29), snapshot(state)] : state.past,
  };
}

/** Overlay-local changes leave their single originating snapshot available to Back. */
function hasReturnContext(state: ExplorerState): boolean {
  return state.sky !== null || state.inspectImage || state.presentation !== "explore" || state.view.kind === "compare" || state.view.kind === "guided";
}

function back(state: ExplorerState): ExplorerState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  // Closing a presentation keeps the reader's choices. Comparison, guidance,
  // and image inspection still undo to their exact originating snapshot.
  const choices = !state.inspectImage && previous.presentation !== state.presentation
    ? { view: state.view, facets: state.facets, passages: state.passages, unfolded: state.unfolded,
      sky: previous.sky && state.sky ? state.sky : previous.sky } : {};
  return { ...state, ...previous, ...choices, past: state.past.slice(0, -1) };
}

export function explorerReducer(state: ExplorerState, action: ExplorerAction): ExplorerState {
  if (!action || typeof action !== "object") return state;
  switch (action.type) {
    case "sky":
      if ((action.body !== null && !["sun", "moon", "ascendant"].includes(action.body)) || state.sky?.body === action.body) return state;
      // One visit retains its exact Pattern origin. Body choices replace that
      // visit so Back returns to the reading and Forward restores the last body.
      return transition(state, { sky: { body: action.body } }, state.sky === null);
    case "select": {
      if (!state.chapterIds.includes(action.chapterId)
        || (state.view.kind === "chapter" && state.view.chapterId === action.chapterId)) return state;
      return transition(state, { view: { kind: "chapter", chapterId: action.chapterId } }, !state.inspectImage && state.presentation === "explore");
    }
    case "facet": {
      if (!["overview", "tensions", "resources", "alternative"].includes(action.facet)) return state;
      const ids = selectedChapterIds(state);
      if (!ids.length || ids.every((id) => state.facets[id] === action.facet)) return state;
      const facets = { ...state.facets };
      const passages = { ...state.passages };
      for (const id of ids) { facets[id] = action.facet; passages[id] = 0; }
      return transition(state, { facets, passages }, !hasReturnContext(state));
    }
    case "passage": {
      // The controller checks the upper bound against chapterPassages for its current source.
      const ids = selectedChapterIds(state);
      const chapterId = action.chapterId ?? ids[0];
      if (!chapterId || !ids.includes(chapterId) || !Number.isSafeInteger(action.index) || action.index < 0 || state.passages[chapterId] === action.index) return state;
      return transition(state, { passages: { ...state.passages, [chapterId]: action.index } }, !hasReturnContext(state));
    }
    case "whole":
      return state.view.kind === "whole" ? state : transition(state, { view: { kind: "whole" } }, !state.inspectImage && state.presentation === "explore");
    case "compare": {
      const first = selectedChapterIds(state)[0];
      if (!first || state.view.kind === "compare" || !state.chapterIds.includes(action.chapterId) || first === action.chapterId) return state;
      const facet = currentFacet(state);
      return transition(state, {
        view: { kind: "compare", chapterIds: [first, action.chapterId] },
        facets: { ...state.facets, [action.chapterId]: facet },
        passages: { ...state.passages, [action.chapterId]: state.facets[action.chapterId] === facet ? state.passages[action.chapterId] : 0 },
      });
    }
    case "guide":
      return !state.chapterIds.length || state.view.kind === "guided" ? state : transition(state, { view: { kind: "guided", step: 0 } });
    case "guide-step":
      return state.view.kind !== "guided" || !Number.isInteger(action.step) || action.step < 0 || action.step >= state.chapterIds.length || state.view.step === action.step
        ? state : transition(state, { view: { kind: "guided", step: action.step } }, false);
    case "presentation":
      if (!["explore", "reading", "scene", "full"].includes(action.presentation) || action.presentation === state.presentation) return state;
      return action.presentation === "explore" ? back(state) : transition(state, { presentation: action.presentation });
    case "inspect": {
      if (typeof action.open !== "boolean" || action.open === state.inspectImage || !selectedChapterIds(state).length) return state;
      if (!action.open) return back(state);
      const chapterId = action.chapterId ?? selectedChapterIds(state)[0];
      return selectedChapterIds(state).includes(chapterId)
        ? transition(state, { inspectImage: true, inspectChapterId: chapterId }) : state;
    }
    case "unfold":
      return transition(state, {
        unfolded: !state.unfolded,
        ...(action.overview ? { view: { kind: "whole" as const } } : {}),
      }, action.overview ? !state.inspectImage && state.presentation === "explore" : !hasReturnContext(state));
    case "back": return back(state);
    default: return state;
  }
}
