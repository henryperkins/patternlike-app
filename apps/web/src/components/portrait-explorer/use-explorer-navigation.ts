import { useCallback, useEffect, useRef, useState } from "react";
import { createExplorerState, explorerReducer, type ExplorerAction, type ExplorerState } from "./explorer-state.js";
import type { CameraBookmark, ObservatoryExperience } from "./types.js";

export interface ExplorerNavigation {
  state: ExplorerState;
  dispatch: (action: ExplorerAction | readonly ExplorerAction[]) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  memory?: ExplorerMemory;
}
export interface ExplorerMemory {
  snapshot: ExplorerState | null;
  scene: { sourceIdentity: string; experience: ObservatoryExperience; bookmarks: Map<string, CameraBookmark> } | null;
  readerPositions: Map<string, number>;
  scrollPositions: Map<string, { top: number; headingOffset?: number }>;
  history: {
    scope: string;
    sequence: number;
    entries: Map<number, Entry>;
    active: number;
    pending: number | "exit" | null;
    afterReturn: readonly ExplorerAction[] | null;
    exitRequested: boolean;
  };
}
export function createExplorerMemory(): ExplorerMemory {
  return {
    snapshot: null, scene: null, readerPositions: new Map(), scrollPositions: new Map(),
    history: { scope: `portrait-${Math.random().toString(36).slice(2)}`, sequence: 0, entries: new Map(), active: 0, pending: null, afterReturn: null, exitRequested: false },
  };
}
interface Entry { state: ExplorerState; depth: number; parent?: number; }

export function clearExplorerMemory(memory: ExplorerMemory): void {
  const { history } = memory;
  const marker = window.history.state?.portrait;
  const entry = marker?.scope === history.scope ? history.entries.get(marker.index) : undefined;
  if (entry) {
    if (typeof history.pending === "number") {
      // Let a pending return finish before leaving the visit. Keep only its
      // opaque destination and depth while private reader state is released.
      const scope = history.scope, index = history.pending, depth = history.entries.get(index)?.depth;
      if (depth !== undefined) window.addEventListener("popstate", (event) => {
        if (event.state?.portrait?.scope === scope && event.state.portrait.index === index) window.history.go(-(depth + 1));
      }, { once: true });
    } else if (history.pending !== "exit") {
      window.history.go(-(entry.depth + 1));
    }
  }
  memory.snapshot = null;
  memory.scene?.bookmarks.clear();
  memory.scene = null;
  memory.readerPositions.clear();
  memory.scrollPositions.clear();
  history.entries.clear();
  history.pending = null;
  history.afterReturn = null;
  history.exitRequested = false;
}

/** The account session retains the controller across route changes. Browser
 * history contains opaque indices only; all chapter content stays in memory. */
export function useExplorerNavigation(chapterIds: readonly string[], { embedded = false, defaultOpen = false, memory: suppliedMemory }: { embedded?: boolean; defaultOpen?: boolean; memory?: ExplorerMemory } = {}): ExplorerNavigation {
  const localMemory = useRef(createExplorerMemory());
  const memory = suppliedMemory ?? localMemory.current;
  const [state, setState] = useState(() => memory.snapshot ?? createExplorerState(chapterIds));
  const [isOpen, setIsOpen] = useState(!embedded);
  const current = useRef(state);
  const opened = useRef(!embedded);
  const history = memory.history;
  const apply = useCallback((next: ExplorerState) => { current.current = next; memory.snapshot = next; setState(next); }, [memory]);
  const show = useCallback((value: boolean) => { opened.current = value; setIsOpen(value); }, []);
  const commitActions = useCallback((actions: readonly ExplorerAction[]) => {
    let next = current.current;
    for (const action of actions) {
      const before = next;
      next = explorerReducer(before, action);
      if (next === before) continue;
      const previous = history.entries.get(history.active);
      const remember = next.past !== before.past && action.type !== "back"
        && !(action.type === "inspect" && !action.open)
        && !(action.type === "presentation" && action.presentation === "explore");
      if (remember) {
        const index = ++history.sequence;
        history.entries.set(index, { state: next, parent: history.active, depth: (previous?.depth ?? 0) + 1 });
        history.active = index;
        window.history.pushState({ ...window.history.state, portrait: { scope: history.scope, index } }, "");
      } else {
        history.entries.set(history.active, { ...previous, state: next, depth: previous?.depth ?? 0 });
      }
    }
    if (next !== current.current) apply(next);
  }, [apply, history]);
  useEffect(() => {
    if (!embedded) {
      history.entries.set(0, { state: current.current, depth: 0 });
      window.history.replaceState({ ...window.history.state, portrait: { scope: history.scope, index: 0 } }, "");
    } else {
      // A native Back from another route can remount us on an earlier visit.
      // Restore that exact entry before handling subsequent navigation events.
      const marker = window.history.state?.portrait;
      const saved = marker?.scope === history.scope ? history.entries.get(marker.index) : undefined;
      history.pending = null;
      history.afterReturn = null;
      history.exitRequested = false;
      if (saved) { history.active = marker.index; apply(saved.state); show(true); }
    }
    const restore = (event: PopStateEvent) => {
      const marker = event.state?.portrait;
      if (marker?.scope !== history.scope) {
        history.pending = null;
        history.afterReturn = null;
        history.exitRequested = false;
        if (embedded) show(false);
        return;
      }
      const saved = history.entries.get(marker.index);
      if (!saved) return;
      let next = saved.state;
      if (history.pending !== marker.index && opened.current) {
        // Native Back follows the same return semantics as the visible controls.
        let cursor: number | undefined = history.active;
        let steps = 0;
        while (cursor !== undefined && cursor !== marker.index) { cursor = history.entries.get(cursor)?.parent; steps++; }
        if (cursor === marker.index && steps && steps <= current.current.past.length) {
          next = current.current;
          for (let step = 0; step < steps; step++) next = explorerReducer(next, { type: "back" });
        }
      }
      history.entries.set(marker.index, { ...saved, state: next });
      history.active = marker.index;
      if (history.exitRequested) {
        // Finish an in-flight return before measuring the remaining distance
        // to the account. Two relative go() calls can otherwise overshoot it.
        history.exitRequested = false;
        history.afterReturn = null;
        history.pending = "exit";
        apply(next); show(false);
        window.history.go(-(saved.depth + 1));
        return;
      }
      history.pending = null;
      const afterReturn = history.afterReturn;
      history.afterReturn = null;
      apply(next);
      // A new presentation starts a new branch after the browser reaches its
      // parent. Putting it in the parent's entry would skip a later Back step.
      if (afterReturn) commitActions(afterReturn);
      show(true);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [apply, commitActions, embedded, history, show]);

  const open = useCallback(() => {
    if (opened.current || history.pending !== null) return;
    const next = current.current;
    // Rebuild the retained path so native Back and the visible return controls
    // both unwind the resumed comparison, perspective and presentation.
    for (const [depth, snapshot] of [...next.past, next].entries()) {
      const parent = depth ? history.active : undefined;
      history.active = ++history.sequence;
      history.entries.set(history.active, { state: { ...next, ...snapshot, past: next.past.slice(0, depth) }, depth, parent });
      window.history.pushState({ ...window.history.state, portrait: { scope: history.scope, index: history.active } }, "");
    }
    apply(next); show(true);
  }, [apply, history, show]);

  // Only the first visit to this source opens automatically. A deliberate return
  // to reading, including native Back, survives status polls and route remounts.
  useEffect(() => {
    if (defaultOpen && memory.snapshot === null) open();
  }, [defaultOpen, memory, open]);

  const close = useCallback(() => {
    if (!opened.current) return;
    show(false);
    if (history.pending !== null) { history.exitRequested = true; return; }
    const entry = history.entries.get(history.active);
    if (embedded && entry && window.history.state?.portrait?.scope === history.scope) {
      history.pending = "exit";
      window.history.go(-(entry.depth + 1));
    }
  }, [embedded, history, show]);

  const dispatch = useCallback((action: ExplorerAction | readonly ExplorerAction[]) => {
    if (!opened.current || history.pending !== null) return;
    const before = current.current;
    const actions: readonly ExplorerAction[] = Array.isArray(action) ? action : [action as ExplorerAction];
    const next = actions.reduce(explorerReducer, before);
    if (next === before) return;
    const single = actions.length === 1 ? actions[0] : null;
    let steps = 0;
    for (const item of actions) { if (item.type !== "back") break; steps++; }
    if (!steps && ((single?.type === "inspect" && !single.open)
      || (single?.type === "presentation" && single.presentation === "explore"))) steps = 1;
    let ancestor: number | undefined = history.active;
    for (let index = 0; index < steps && ancestor !== undefined; index++) ancestor = history.entries.get(ancestor)?.parent;
    if (steps && ancestor !== undefined && window.history.state?.portrait?.scope === history.scope) {
      const returned = actions.slice(0, steps).reduce(explorerReducer, before);
      history.entries.set(ancestor, { ...history.entries.get(ancestor)!, state: returned });
      history.pending = ancestor;
      history.afterReturn = actions.slice(steps);
      window.history.go(-steps);
      return;
    }
    commitActions(actions);
  }, [commitActions, history]);
  return { state, dispatch, isOpen, open, close, memory };
}
