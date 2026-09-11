import { useEffect, useId, useRef, useState } from "react";
import type { PortraitAutomationPreference } from "@patternlike/shared";
import { ApiError, getPortraitAutomation, newIdempotencyKey, setPortraitAutomation } from "../lib/api-client.js";
import { ReaderConsequences, ReaderReadiness, useReaderScope } from "./ReaderReadiness.js";
import { selectReaderReadiness } from "../lib/reader-readiness.js";
import "./account-pattern-portrait.css";

export function PortraitAutomationControl({ chartId, canEnable = true, onUnauthorized, onChanged, onSavingChange }: {
  chartId: string; canEnable?: boolean; onUnauthorized: () => void; onChanged?: () => void; onSavingChange?: (saving: boolean) => void;
}) {
  const accountScope = useReaderScope();
  const [attempt, setAttempt] = useState(0);
  const [fresh, setFresh] = useState(false);
  const [observedAt, setObservedAt] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const requestGeneration = useRef(0);
  const intentKey = useRef<{ chartId: string; enabled: boolean; key: string } | null>(null);
  const [preference, setPreference] = useState<PortraitAutomationPreference | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = useRef<AbortController | null>(null);
  const description = useId();
  const valid = (value: PortraitAutomationPreference) => {
    if (value.schema_version !== "portrait-automation/v1" || value.consent_policy_version !== "1.1.0"
      || typeof value.available !== "boolean" || typeof value.enabled !== "boolean"
      || (value.available && value.chart_id !== chartId)) throw new Error("The portrait preference no longer matches this chart. Refresh to continue.");
    return value;
  };
  useEffect(() => {
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    setFresh(false); setError(null); setBusy(false);
    void getPortraitAutomation(controller.signal).then((value) => {
      if (!controller.signal.aborted && generation === requestGeneration.current) { setPreference(valid(value)); setFresh(true); setObservedAt(Date.now()); }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
      else if (!(cause instanceof ApiError && [404, 503].includes(cause.status))) setError(cause instanceof Error ? cause.message : "Automatic portrait settings could not be loaded.");
    });
    return () => { controller.abort(); action.current?.abort(); onSavingChange?.(false); };
  }, [chartId, onUnauthorized, onSavingChange, attempt, accountScope]);

  useEffect(() => {
    if (!fresh || observedAt === null) return;
    const timer = window.setTimeout(() => setFresh(false), Math.max(0, observedAt + 60_001 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [fresh, observedAt]);
  const change = async (enabled: boolean) => {
    if (busy || !fresh || observedAt === null || Date.now() - observedAt > 60_000 || !preference?.available || preference.chart_id !== chartId || (enabled && !canEnable)) { setFresh(false); return; }
    const controller = new AbortController(); action.current = controller;
    setBusy(true); setError(null); onSavingChange?.(true);
    if (!intentKey.current || intentKey.current.chartId !== chartId || intentKey.current.enabled !== enabled) intentKey.current = { chartId, enabled, key: newIdempotencyKey("web-portrait-automation") };
    try {
      const next = await setPortraitAutomation({ chart_id: chartId, enabled, consent_policy_version: "1.1.0",
        confirm: enabled ? "ENABLE AUTOMATIC PORTRAITS" : "DISABLE AUTOMATIC PORTRAITS" }, intentKey.current.key, controller.signal);
      if (!controller.signal.aborted) { setPreference(valid(next)); setFresh(true); setObservedAt(Date.now()); setSaved(true); intentKey.current = null; onChanged?.(); }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setFresh(false);
        if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
        else setError(cause instanceof Error ? cause.message : "Your portrait choice could not be saved.");
      }
    } finally {
      if (action.current === controller) action.current = null;
      if (!controller.signal.aborted) { setBusy(false); onSavingChange?.(false); }
    }
  };

  const scope = { ...accountScope, chartId };
  const readiness = selectReaderReadiness({ scope, requestGeneration: requestGeneration.current, now: Date.now(),
    automation: preference && observedAt !== null ? { scope, requestGeneration: requestGeneration.current, observedAt, evidence: fresh ? "known" : "unavailable", value: preference } : null }).artwork;
  if (!preference?.available || preference.chart_id !== chartId) return error ? <p role="status">{error}</p> : null;
  return <section className="portrait-automation" aria-label="Automatic visual portrait">
    <label className="portrait-automation__choice">
      <input type="checkbox" checked={preference.enabled} disabled={busy || !fresh || (!preference.enabled && !canEnable)} aria-describedby={description} onChange={(event) => void change(event.target.checked)} />
      <span>Automatically create my 3D portrait</span>
    </label>
    <div id={description} className="portrait-automation__terms">
      <p>Your complete chapter text and generated images are sent to Codex, run by OpenAI, to create and check a visual interpretation.</p>
      <p>Each new four-chapter Pattern for this chart starts a portrait automatically. It is saved privately, so you can leave and return while it is being created.</p>
      <ReaderConsequences action="disable_artwork" observedAt={observedAt} evidence={fresh ? "known" : "unavailable"} />
      {!canEnable && !preference.enabled && <p>New portrait creation is unavailable right now. Your reading remains available.</p>}
    </div>
    {busy ? <p role="status">Saving your choice…</p> : null}
    {!fresh && <ReaderReadiness presentation={readiness} onAction={() => setAttempt(value => value + 1)} />}
    {saved && !busy && <p role="status">Your artwork choice is saved. This confirms the preference, not completion of unfinished-work cancellation.</p>}
    {error ? <p role="status">{error}</p> : null}
  </section>;
}
