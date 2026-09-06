import { useCallback, useEffect, useRef, useState } from "react";
import { createExplorerState, explorerReducer, type ExplorerAction, type ExplorerState } from "./explorer-state.js";

/** Browser history contains opaque local indices only. Reading content stays in memory. */
export function useExplorerNavigation(chapterIds: readonly string[]) {
  const [state, setState] = useState(() => createExplorerState(chapterIds));
  const current = useRef(state);
  const scope = useRef(`portrait-${Math.random().toString(36).slice(2)}`);
  const sequence = useRef(0);
  const entries = useRef(new Map<number, ExplorerState>());
  const parents = useRef(new Map<number, number>());
  const active = useRef(0);
  const apply = useCallback((next: ExplorerState) => { current.current = next; setState(next); }, []);
  useEffect(() => {
    entries.current.set(0, current.current);
    window.history.replaceState({ ...window.history.state, portrait: { scope: scope.current, index: 0 } }, "");
    const restore = (event: PopStateEvent) => {
      const entry = event.state?.portrait;
      if (entry?.scope !== scope.current) return;
      const saved = entries.current.get(entry.index);
      if (saved) { active.current = entry.index; apply(saved); }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [apply]);
  const dispatch = useCallback((action: ExplorerAction | readonly ExplorerAction[]) => {
    const before = current.current;
    const actions: readonly ExplorerAction[] = Array.isArray(action) ? action : [action as ExplorerAction];
    const next = actions.reduce(explorerReducer, before);
    if (next === before) return;
    const single = actions.length === 1 ? actions[0] : null;
    const allBack = actions.every((item) => item.type === "back");
    const restoring = allBack || (single?.type === "inspect" && !single.open)
      || (single?.type === "presentation" && single.presentation === "explore");
    const steps = allBack ? actions.length : 1;
    let ancestor: number | undefined = active.current;
    for (let index = 0; index < steps && ancestor !== undefined; index++) ancestor = parents.current.get(ancestor);
    if (restoring && ancestor !== undefined
      && window.history.state?.portrait?.scope === scope.current) {
      window.history.go(-steps);
      return;
    }
    const remember = !restoring && next.past !== before.past;
    if (remember) {
      const index = ++sequence.current;
      parents.current.set(index, active.current);
      active.current = index;
      window.history.pushState({ portrait: { scope: scope.current, index } }, "");
    }
    entries.current.set(active.current, next);
    apply(next);
  }, [apply]);
  return [state, dispatch] as const;
}
