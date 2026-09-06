import { useEffect, useRef, useState } from "react";
import type { ReadingSaveState } from "@patternlike/shared";
import {
  ApiError,
  getReadingSaveState,
  saveReading,
  unsaveReading,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import { Icon } from "./icons.js";

interface ReadingSaveButtonProps {
  readingId: string;
  onUnauthorized: () => void;
  onStateChange?: (state: ReadingSaveState) => void;
}

type SavePhase = "loading" | "ready" | "saving" | "unsaving" | "load-error" | "error";

export function ReadingSaveButton({
  readingId,
  onUnauthorized,
  onStateChange,
}: ReadingSaveButtonProps) {
  const [confirmed, setConfirmed] = useState<ReadingSaveState | null>(null);
  const [phase, setPhase] = useState<SavePhase>("loading");
  const [message, setMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const requestVersion = useRef(0);
  const mutationController = useRef<AbortController | null>(null);
  const mutationPending = useRef(false);
  const onUnauthorizedRef = useRef(onUnauthorized);
  const onStateChangeRef = useRef(onStateChange);
  onUnauthorizedRef.current = onUnauthorized;
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    mutationController.current?.abort();
    setConfirmed(null);
    setMessage("");
    setPhase("loading");

    void getReadingSaveState(readingId, controller.signal)
      .then((state) => {
        if (controller.signal.aborted || requestVersion.current !== version) return;
        setConfirmed(state);
        setPhase("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestVersion.current !== version) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorizedRef.current();
          return;
        }
        setMessage(withRequestId(
          error instanceof Error ? error.message : "Save state could not be read.",
          error instanceof ApiError ? error.requestId : null,
        ));
        setPhase("load-error");
      });

    return () => {
      controller.abort();
      mutationController.current?.abort();
      mutationPending.current = false;
      requestVersion.current += 1;
    };
  }, [loadAttempt, readingId]);

  const toggle = async () => {
    if (!confirmed || mutationPending.current || phase !== "ready" && phase !== "error") return;
    mutationPending.current = true;
    const previous = confirmed;
    const controller = new AbortController();
    mutationController.current?.abort();
    mutationController.current = controller;
    const version = ++requestVersion.current;
    setMessage("");
    setPhase(previous.saved ? "unsaving" : "saving");

    try {
      let next: ReadingSaveState;
      if (previous.saved) {
        await unsaveReading(readingId, controller.signal);
        next = {
          schema_version: "0.8.0",
          reading_id: readingId,
          saved: false,
          saved_at: null,
        };
      } else {
        next = await saveReading(readingId, controller.signal);
      }
      if (controller.signal.aborted || requestVersion.current !== version) return;
      setConfirmed(next);
      setMessage(next.saved ? "Saved to your chapters." : "Removed from Saved.");
      setPhase("ready");
      onStateChangeRef.current?.(next);
    } catch (error) {
      if (controller.signal.aborted || requestVersion.current !== version) return;
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorizedRef.current();
        return;
      }
      setMessage(withRequestId(
        error instanceof Error ? error.message : "The chapter could not be saved.",
        error instanceof ApiError ? error.requestId : null,
      ));
      setPhase("error");
    } finally {
      if (requestVersion.current === version) mutationPending.current = false;
    }
  };

  const busy = phase === "loading" || phase === "saving" || phase === "unsaving";
  const saved = confirmed?.saved ?? false;
  const label = phase === "saving" ? "Saving…" : phase === "unsaving" ? "Removing…" : saved ? "Saved" : "Save";

  return (
    <div className="reading-save">
      <button
        className={`reading-save__button${saved ? " reading-save__button--saved" : ""}`}
        type="button"
        aria-pressed={saved}
        aria-busy={phase === "saving" || phase === "unsaving"}
        disabled={busy || confirmed === null}
        onClick={() => void toggle()}
      >
        <Icon name="bookmark" />
        {label}
      </button>
      <span className="reading-save__status" aria-live="polite">
        {message}
      </span>
      {phase === "load-error" ? (
        <button
          className="reading-save__retry"
          type="button"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          Try reading Save state again
        </button>
      ) : null}
    </div>
  );
}
