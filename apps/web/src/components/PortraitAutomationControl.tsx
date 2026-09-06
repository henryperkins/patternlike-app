import { useEffect, useId, useRef, useState } from "react";
import type { PortraitAutomationPreference } from "@patternlike/shared";
import { ApiError, getPortraitAutomation, newIdempotencyKey, setPortraitAutomation } from "../lib/api-client.js";
import "./account-pattern-portrait.css";

export function PortraitAutomationControl({ chartId, canEnable = true, onUnauthorized, onChanged, onSavingChange }: {
  chartId: string; canEnable?: boolean; onUnauthorized: () => void; onChanged?: () => void; onSavingChange?: (saving: boolean) => void;
}) {
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
    const controller = new AbortController();
    setPreference(null); setError(null); setBusy(false);
    void getPortraitAutomation(controller.signal).then((value) => {
      if (!controller.signal.aborted) setPreference(valid(value));
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
      else if (!(cause instanceof ApiError && [404, 503].includes(cause.status))) setError(cause instanceof Error ? cause.message : "Automatic portrait settings could not be loaded.");
    });
    return () => { controller.abort(); action.current?.abort(); onSavingChange?.(false); };
  }, [chartId, onUnauthorized, onSavingChange]);

  const change = async (enabled: boolean) => {
    if (busy || !preference?.available || (enabled && !canEnable)) return;
    const controller = new AbortController(); action.current = controller;
    setBusy(true); setError(null); onSavingChange?.(true);
    try {
      const next = await setPortraitAutomation({ chart_id: chartId, enabled, consent_policy_version: "1.1.0",
        confirm: enabled ? "ENABLE AUTOMATIC PORTRAITS" : "DISABLE AUTOMATIC PORTRAITS" }, newIdempotencyKey("web-portrait-automation"), controller.signal);
      if (!controller.signal.aborted) { setPreference(valid(next)); onChanged?.(); }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
        else setError(cause instanceof Error ? cause.message : "Your portrait choice could not be saved.");
      }
    } finally {
      if (action.current === controller) action.current = null;
      if (!controller.signal.aborted) { setBusy(false); onSavingChange?.(false); }
    }
  };

  if (!preference?.available) return error ? <p role="status">{error}</p> : null;
  return <section className="portrait-automation" aria-label="Automatic visual portrait">
    <label className="portrait-automation__choice">
      <input type="checkbox" checked={preference.enabled} disabled={busy || (!preference.enabled && !canEnable)} aria-describedby={description} onChange={(event) => void change(event.target.checked)} />
      <span>Automatically create my 3D portrait</span>
    </label>
    <div id={description} className="portrait-automation__terms">
      <p>Your complete chapter text and generated images are sent to Codex, run by OpenAI, to create and check a visual interpretation.</p>
      <p>Each new four-chapter Pattern for this chart starts a portrait automatically. It is saved privately, so you can leave and return while it is being created.</p>
      <p>Turning this off stops unfinished and future portraits. Saved portraits remain until you delete their Pattern; your written reading stays available.</p>
      {!canEnable && !preference.enabled && <p>New portrait creation is unavailable right now. Your reading remains available.</p>}
    </div>
    {busy ? <p role="status">Saving your choice…</p> : null}
    {error ? <p role="status">{error}</p> : null}
  </section>;
}
