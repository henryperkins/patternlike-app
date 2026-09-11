import { createContext, useContext, useEffect, useState } from "react";
import type { ReaderAction, ReaderPresentation, ReaderScope } from "../lib/reader-readiness.js";
import { selectReaderConsequences, type ConsequenceAction } from "../lib/reader-consequences.js";

const unknownScope: ReaderScope = { accountId: null, sessionEpoch: 0, chartId: null, profileVersion: null, source: null };
export const ReaderScopeContext = createContext<ReaderScope>(unknownScope);
export const ReaderChartObservedAtContext = createContext<number | null>(null);
export const ReaderRefreshChartContext = createContext<(() => Promise<void>) | null>(null);
export const useReaderRefreshChart = () => useContext(ReaderRefreshChartContext);
export const useReaderChartObservedAt = () => useContext(ReaderChartObservedAtContext);
export const useReaderScope = () => useContext(ReaderScopeContext);
export function ReaderReadiness({ presentation, onAction }: { presentation: ReaderPresentation; onAction?: (action: ReaderAction) => void }) {
  return <p className="account-portrait__status" data-readiness={presentation.code} role="status">
    {presentation.text}
    {onAction ? presentation.actions.filter(action => action.type === "reload_status").map(action =>
      <button type="button" key={action.type} onClick={() => onAction(action)}>Check again</button>) : null}
  </p>;
}
export function useReaderObservationFresh(observedAt: number | null): boolean {
  const [, expire] = useState(0);
  useEffect(() => {
    if (observedAt === null) return;
    const timer = window.setTimeout(() => expire(value => value + 1), Math.max(0, observedAt + 60_001 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [observedAt]);
  return observedAt !== null && Number.isFinite(observedAt) && observedAt <= Date.now() && Date.now() - observedAt <= 60_000;
}
export function ReaderConsequences({ action, observedAt = null, evidence = "unavailable" }: { action: ConsequenceAction; observedAt?: number | null; evidence?: "known" | "unavailable" }) {
  const fresh = useReaderObservationFresh(observedAt);
  const consequences = selectReaderConsequences(action, { observedAt, evidence: fresh && evidence === "known" ? "known" : "unavailable" });
  return <p className="field-help" data-consequence={action} data-evidence={consequences.evidence}>{consequences.text}</p>;
}
