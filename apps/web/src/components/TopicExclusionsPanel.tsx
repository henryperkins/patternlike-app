import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  EXCLUDABLE_LIFE_DOMAINS,
  type ExcludableLifeDomain,
} from "@patternlike/shared";
import {
  ApiError,
  getTopicExclusions,
  newIdempotencyKey,
  setTopicExclusions,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";

const TOPIC_LABELS: Record<ExcludableLifeDomain, string> = {
  self: "Self",
  relationships: "Relationships",
  work: "Work",
  creativity: "Creativity",
  home: "Home",
  body_energy: "Body and energy",
  money_resources: "Money and resources",
  learning: "Learning",
  community: "Community",
  caregiving: "Caregiving",
  spirituality_meaning: "Meaning",
};

/**
 * USR-05 sensitive-topic exclusions.
 *
 * An explicit negative preference: later readings must not interpret these
 * domains. The list overrides ranking and engagement; it is not a mute of
 * calculated facts, which still appear in Chart and Time Travel.
 */
export function TopicExclusionsPanel() {
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const current = await getTopicExclusions(controller.signal);
        if (controller.signal.aborted) return;
        setSelected(current.excluded_topics);
        setSavedAt(current.updated_at);
        setLoaded(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProblem(
          withRequestId(
            error instanceof Error
              ? error.message
              : "Topic exclusions could not be read.",
            error instanceof ApiError ? error.requestId : null,
          ),
        );
        setLoaded(true);
      }
    })();
    return () => controller.abort();
  }, []);

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    key.current ??= newIdempotencyKey("web-topic-exclusions");
    try {
      const next = await setTopicExclusions(selected, key.current);
      key.current = null;
      setSelected(next.excluded_topics);
      setSavedAt(next.updated_at);
    } catch (error) {
      setProblem(
        withRequestId(
          error instanceof Error
            ? error.message
            : "Topic exclusions could not be saved.",
          error instanceof ApiError ? error.requestId : null,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="topic-exclusions panel" aria-labelledby="topic-exclusions-heading">
      <div className="panel-heading">
        <div>
          <p className="kicker">USR-05</p>
          <h2 id="topic-exclusions-heading">Topics to leave aside</h2>
        </div>
        <span className="panel-code">THEME FILTER</span>
      </div>
      <p>
        Readings will not interpret the areas you mark here. Chart facts are
        unchanged. Notifications about these topics are also withheld when
        notifications exist.
      </p>
      {loaded ? (
        <form onSubmit={(event) => void submit(event)}>
          <fieldset className="topic-exclusions__list">
            <legend>Do not interpret</legend>
            {EXCLUDABLE_LIFE_DOMAINS.map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={selected.includes(id)}
                  onChange={() => toggle(id)}
                />
                <span>{TOPIC_LABELS[id]}</span>
              </label>
            ))}
          </fieldset>
          {problem ? (
            <p className="topic-exclusions__status" role="status">
              {problem}
            </p>
          ) : savedAt ? (
            <p className="topic-exclusions__status">Saved.</p>
          ) : null}
          <div className="topic-exclusions__footer">
            <button className="button" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save exclusions"}
            </button>
          </div>
        </form>
      ) : (
        <p>Loading…</p>
      )}
    </section>
  );
}
