import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  getTopicExclusions,
  newIdempotencyKey,
  setTopicExclusions,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";

const TOPICS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "self", label: "Self" },
  { id: "relationships", label: "Relationships" },
  { id: "work", label: "Work" },
  { id: "creativity", label: "Creativity" },
  { id: "home", label: "Home" },
  { id: "body_energy", label: "Body and energy" },
  { id: "money_resources", label: "Money and resources" },
  { id: "learning", label: "Learning" },
  { id: "community", label: "Community" },
  { id: "caregiving", label: "Caregiving" },
  { id: "spirituality_meaning", label: "Meaning" },
];

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
            {TOPICS.map((topic) => (
              <label key={topic.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(topic.id)}
                  onChange={() => toggle(topic.id)}
                />
                <span>{topic.label}</span>
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
