import { useCallback, useEffect, useRef, useState } from "react";
import { createExplorerState, explorerReducer, type ExplorerAction, type ExplorerState } from "./explorer-state.js";

export interface ExplorerNavigation {
  state: ExplorerState;
  dispatch: (action: ExplorerAction | readonly ExplorerAction[]) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
}
interface Entry { state: ExplorerState; depth: number; parent?: number; }

/** The account keeps this controller mounted across close/Forward. Browser
 * history contains opaque indices only; all chapter content stays in memory. */
export function useExplorerNavigation(chapterIds: readonly string[], { embedded = false } = {}): ExplorerNavigation {
  const [state, setState] = useState(() => createExplorerState(chapterIds));
  const [isOpen, setIsOpen] = useState(!embedded);
  const current = useRef(state);
  const opened = useRef(!embedded);
  const ids = useRef(chapterIds);
  const scope = useRef(`portrait-${Math.random().toString(36).slice(2)}`);
  const sequence = useRef(0);
  const entries = useRef(new Map<number, Entry>());
  const active = useRef(0);
  const pending = useRef<number | "exit" | null>(null);
  const exitRequested = useRef(false);
  const apply = useCallback((next: ExplorerState) => { current.current = next; setState(next); }, []);
  const show = useCallback((value: boolean) => { opened.current = value; setIsOpen(value); }, []);
  useEffect(() => {
    if (!embedded) {
      entries.current.set(0, { state: current.current, depth: 0 });
      window.history.replaceState({ ...window.history.state, portrait: { scope: scope.current, index: 0 } }, "");
    }
    const restore = (event: PopStateEvent) => {
      const marker = event.state?.portrait;
      if (marker?.scope !== scope.current) {
        pending.current = null;
        exitRequested.current = false;
        if (embedded) show(false);
        return;
      }
      const saved = entries.current.get(marker.index);
      if (!saved) return;
      let next = saved.state;
      if (pending.current !== marker.index && opened.current) {
        // Native Back follows the same return semantics as the visible controls.
        let cursor: number | undefined = active.current;
        let steps = 0;
        while (cursor !== undefined && cursor !== marker.index) { cursor = entries.current.get(cursor)?.parent; steps++; }
        if (cursor === marker.index && steps && steps <= current.current.past.length) {
          next = current.current;
          for (let step = 0; step < steps; step++) next = explorerReducer(next, { type: "back" });
        }
      }
      entries.current.set(marker.index, { ...saved, state: next });
      active.current = marker.index;
      if (exitRequested.current) {
        // Finish an in-flight return before measuring the remaining distance
        // to the account. Two relative go() calls can otherwise overshoot it.
        exitRequested.current = false;
        pending.current = "exit";
        apply(next); show(false);
        window.history.go(-(saved.depth + 1));
        return;
      }
      pending.current = null;
      apply(next); show(true);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [apply, embedded, show]);

  const open = useCallback(() => {
    if (opened.current || pending.current !== null) return;
    const next = createExplorerState(ids.current);
    entries.current.clear();
    active.current = ++sequence.current;
    entries.current.set(active.current, { state: next, depth: 0 });
    window.history.pushState({ ...window.history.state, portrait: { scope: scope.current, index: active.current } }, "");
    apply(next); show(true);
  }, [apply, show]);

  const close = useCallback(() => {
    if (!opened.current) return;
    show(false);
    if (pending.current !== null) { exitRequested.current = true; return; }
    const entry = entries.current.get(active.current);
    if (embedded && entry && window.history.state?.portrait?.scope === scope.current) {
      pending.current = "exit";
      window.history.go(-(entry.depth + 1));
    }
  }, [embedded, show]);

  const dispatch = useCallback((action: ExplorerAction | readonly ExplorerAction[]) => {
    if (!opened.current || pending.current !== null) return;
    const before = current.current;
    const actions: readonly ExplorerAction[] = Array.isArray(action) ? action : [action as ExplorerAction];
    const next = actions.reduce(explorerReducer, before);
    if (next === before) return;
    const single = actions.length === 1 ? actions[0] : null;
    let steps = 0;
    for (const item of actions) { if (item.type !== "back") break; steps++; }
    if (!steps && ((single?.type === "inspect" && !single.open)
      || (single?.type === "presentation" && single.presentation === "explore"))) steps = 1;
    let ancestor: number | undefined = active.current;
    for (let index = 0; index < steps && ancestor !== undefined; index++) ancestor = entries.current.get(ancestor)?.parent;
    if (steps && ancestor !== undefined && window.history.state?.portrait?.scope === scope.current) {
      entries.current.set(ancestor, { ...entries.current.get(ancestor)!, state: next });
      pending.current = ancestor;
      window.history.go(-steps);
      return;
    }
    const previous = entries.current.get(active.current);
    const remember = !steps && next.past !== before.past;
    if (remember) {
      const index = ++sequence.current;
      entries.current.set(index, { state: next, parent: active.current, depth: (previous?.depth ?? 0) + 1 });
      active.current = index;
      window.history.pushState({ ...window.history.state, portrait: { scope: scope.current, index } }, "");
    } else {
      entries.current.set(active.current, { ...previous, state: next, depth: previous?.depth ?? 0 });
    }
    apply(next);
  }, [apply]);
  return { state, dispatch, isOpen, open, close };
}
