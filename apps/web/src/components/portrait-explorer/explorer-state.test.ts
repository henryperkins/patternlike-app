import { describe, expect, it } from "vitest";
import { canGoBack, createExplorerState, currentFacet, explorerReducer, selectedChapterIds, type ExplorerAction, type ExplorerState } from "./explorer-state.js";

const chapterIds = ["chapter-1", "chapter-2", "chapter-3", "chapter-4"];
const act = (state: ExplorerState, ...actions: ExplorerAction[]) => actions.reduce(explorerReducer, state);

describe("portrait explorer navigation", () => {
  it("remembers each chapter's facet and passage after visiting the whole portrait", () => {
    const state = act(createExplorerState(chapterIds),
      { type: "select", chapterId: "chapter-1" }, { type: "facet", facet: "tensions" }, { type: "passage", index: 2 },
      { type: "select", chapterId: "chapter-2" }, { type: "facet", facet: "resources" }, { type: "passage", index: 1 },
      { type: "whole" }, { type: "select", chapterId: "chapter-1" },
    );
    expect(selectedChapterIds(state)).toEqual(["chapter-1"]);
    expect(currentFacet(state)).toBe("tensions");
    expect(state.passages["chapter-1"]).toBe(2);
    const second = explorerReducer(state, { type: "select", chapterId: "chapter-2" });
    expect(currentFacet(second)).toBe("resources");
    expect(second.passages["chapter-2"]).toBe(1);
  });

  it("compares exactly two chapters at the same facet and returns to the exact originating state", () => {
    const origin = act(createExplorerState(chapterIds),
      { type: "select", chapterId: "chapter-2" }, { type: "facet", facet: "alternative" }, { type: "passage", index: 3 },
      { type: "select", chapterId: "chapter-1" }, { type: "facet", facet: "tensions" }, { type: "passage", index: 1 }, { type: "unfold" },
    );
    const compare = explorerReducer(origin, { type: "compare", chapterId: "chapter-2" });
    expect(selectedChapterIds(compare)).toEqual(["chapter-1", "chapter-2"]);
    expect(compare.facets["chapter-2"]).toBe("tensions");
    expect(compare.passages["chapter-2"]).toBe(0);
    const changed = act(compare, { type: "facet", facet: "resources" }, { type: "passage", index: 2 }, { type: "unfold" });
    expect(changed.facets["chapter-1"]).toBe("resources");
    expect(changed.facets["chapter-2"]).toBe("resources");
    expect(explorerReducer(changed, { type: "compare", chapterId: "chapter-3" })).toBe(changed);
    expect(explorerReducer(changed, { type: "back" })).toEqual(origin);
  });

  it.each(["reading", "scene", "full"] as const)("retains chapter choices when returning from %s", (presentation) => {
    const origin = act(createExplorerState(chapterIds), { type: "select", chapterId: "chapter-3" }, { type: "facet", facet: "alternative" }, { type: "unfold" });
    const expanded = act(origin, { type: "presentation", presentation }, { type: "select", chapterId: "chapter-4" }, { type: "facet", facet: "resources" });
    expect(expanded.presentation).toBe(presentation);
    const returned = explorerReducer(expanded, { type: "back" });
    expect(returned.presentation).toBe("explore");
    expect(selectedChapterIds(returned)).toEqual(["chapter-4"]);
    expect(currentFacet(returned)).toBe("resources");
    expect(returned.facets["chapter-3"]).toBe("alternative");
    expect(returned.unfolded).toBe(true);
    expect(returned.past).toEqual(origin.past);
  });

  it("restores nested image inspection to comparison before returning to its chapter", () => {
    const origin = act(createExplorerState(chapterIds), { type: "select", chapterId: "chapter-1" }, { type: "facet", facet: "resources" });
    const compare = explorerReducer(origin, { type: "compare", chapterId: "chapter-4" });
    const inspecting = explorerReducer(compare, { type: "inspect", open: true });
    expect(inspecting.inspectImage).toBe(true);
    expect(explorerReducer(inspecting, { type: "inspect", open: false })).toEqual(compare);
    expect(act(inspecting, { type: "back" }, { type: "back" })).toEqual(origin);
  });

  it("advances guidance manually and exits to the exact source state", () => {
    const origin = act(createExplorerState(chapterIds), { type: "select", chapterId: "chapter-2" }, { type: "facet", facet: "resources" });
    const guided = act(origin, { type: "guide" }, { type: "guide-step", step: 3 }, { type: "facet", facet: "tensions" });
    expect(guided.view).toEqual({ kind: "guided", step: 3 });
    expect(selectedChapterIds(guided)).toEqual(["chapter-4"]);
    const previous = explorerReducer(guided, { type: "guide-step", step: 2 });
    expect(selectedChapterIds(previous)).toEqual(["chapter-3"]);
    expect(explorerReducer(previous, { type: "back" })).toEqual(origin);
  });

  it("supports all facets, clears the passage on facet change, and goes back to the earlier passage", () => {
    let state = act(createExplorerState(chapterIds), { type: "select", chapterId: "chapter-1" }, { type: "passage", index: 2 });
    for (const facet of ["tensions", "resources", "alternative", "overview"] as const) {
      const before = state;
      state = explorerReducer(state, { type: "facet", facet });
      expect(currentFacet(state)).toBe(facet);
      expect(state.passages["chapter-1"]).toBe(0);
      expect(explorerReducer(state, { type: "back" })).toEqual(before);
      state = explorerReducer(state, { type: "passage", index: 2 });
    }
  });

  it("bounds history without nested history and preserves meaningful Back navigation", () => {
    let state = createExplorerState(chapterIds);
    for (let index = 0; index < 70; index++) state = explorerReducer(state, { type: "select", chapterId: chapterIds[index % 4] });
    expect(state.past).toHaveLength(30);
    expect(state.past.every((snapshot) => !("past" in snapshot) && !("chapterIds" in snapshot))).toBe(true);
    for (let index = 0; index < 30; index++) {
      expect(canGoBack(state)).toBe(true);
      state = explorerReducer(state, { type: "back" });
    }
    expect(canGoBack(state)).toBe(false);
    expect(explorerReducer(state, { type: "back" })).toBe(state);
  });

  it("starts a replacement source without any old selection, presentation, or bookmarks", () => {
    const old = act(createExplorerState(chapterIds), { type: "select", chapterId: "chapter-3" }, { type: "facet", facet: "tensions" }, { type: "passage", index: 1 }, { type: "unfold" }, { type: "presentation", presentation: "full" });
    const fresh = createExplorerState(chapterIds);
    expect(fresh.view).toEqual({ kind: "whole" });
    expect(selectedChapterIds(fresh)).toEqual([]);
    expect(fresh.presentation).toBe("explore");
    expect(fresh.unfolded).toBe(false);
    expect(fresh.inspectImage).toBe(false);
    expect(fresh.past).toEqual([]);
    expect(fresh.facets["chapter-3"]).toBe("overview");
    expect(fresh.passages["chapter-3"]).toBe(0);
    expect(old.facets["chapter-3"]).toBe("tensions");
  });

  it("ignores malformed, unknown, and inapplicable navigation inputs", () => {
    const whole = createExplorerState(chapterIds);
    for (const action of [{ type: "facet", facet: "resources" }, { type: "passage", index: 0 }, { type: "inspect", open: true }, { type: "compare", chapterId: "chapter-2" }, { type: "guide-step", step: 0 }, { type: "whole" }] as ExplorerAction[]) {
      expect(explorerReducer(whole, action)).toBe(whole);
    }
    const state = explorerReducer(whole, { type: "select", chapterId: "chapter-1" });
    for (const action of [
      { type: "select", chapterId: "../chapter-1" }, { type: "select", chapterId: "constructor" },
      { type: "compare", chapterId: "chapter-1" }, { type: "compare", chapterId: "chapter-5" },
      { type: "facet", facet: "unpublished" }, { type: "passage", index: -1 }, { type: "passage", index: 1.5 },
      { type: "passage", index: NaN }, { type: "passage", index: Infinity }, { type: "passage", index: Number.MAX_SAFE_INTEGER + 1 },
      { type: "presentation", presentation: "unknown" }, { type: "inspect", open: false }, { type: "select", chapterId: "chapter-1" },
    ] as ExplorerAction[]) expect(explorerReducer(state, action)).toBe(state);
    const guide = explorerReducer(state, { type: "guide" });
    for (const step of [-1, 4, 0.5, NaN, Infinity]) expect(explorerReducer(guide, { type: "guide-step", step })).toBe(guide);
    for (const action of [null, undefined, {}, { type: "inspect", open: "yes" }, { type: "unrecognized" }]) {
      expect(explorerReducer(state, action as ExplorerAction)).toBe(state);
    }
  });
});
