import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ReadingHistoryItem,
  ReadingHistoryStatus,
  ReadingHistoryView,
  ReadingSaveState,
} from "@patternlike/shared";
import {
  ApiError,
  getReading,
  listReadingHistory,
  type DailyReadingResponse,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import { formatHistoricalDate } from "../lib/reading-format.js";
import { ReadingArticle } from "./ReadingArticle.js";
import { Icon } from "./icons.js";

type LibraryState =
  | { status: "loading"; view: ReadingHistoryView }
  | { status: "ready"; view: ReadingHistoryView; items: ReadingHistoryItem[]; cursor: string | null }
  | { status: "error"; view: ReadingHistoryView; message: string; requestId: string | null };

type DetailState =
  | { status: "loading"; item: ReadingHistoryItem }
  | { status: "ready"; item: ReadingHistoryItem; response: DailyReadingResponse }
  | { status: "error"; item: ReadingHistoryItem; message: string; requestId: string | null };

interface HistoryViewProps {
  onUnauthorized: () => void;
}

function revisionStatus(status: ReadingHistoryStatus): string {
  if (status === "invalidated") return "Removed from Today";
  if (status === "superseded") return "Revised";
  return "Published";
}

function chapterCount(count: number): string {
  return `${count} ${count === 1 ? "chapter" : "chapters"} shown.`;
}

export function HistoryView({ onUnauthorized }: HistoryViewProps) {
  const [view, setView] = useState<ReadingHistoryView>("history");
  const [library, setLibrary] = useState<LibraryState>({ status: "loading", view: "history" });
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreProblem, setLoadMoreProblem] = useState("");
  const listRequestVersion = useRef(0);
  const detailRequestVersion = useRef(0);
  const loadMoreController = useRef<AbortController | null>(null);
  const loadMorePending = useRef(false);
  const detailController = useRef<AbortController | null>(null);
  const openerRefs = useRef(new Map<string, HTMLButtonElement>());
  const filterRefs = useRef(new Map<ReadingHistoryView, HTMLButtonElement>());
  const detailBackRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++listRequestVersion.current;
    loadMoreController.current?.abort();
    setLoadingMore(false);
    loadMorePending.current = false;
    setLoadMoreProblem("");
    setLibrary({ status: "loading", view });

    void listReadingHistory({ view, limit: 20 }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || listRequestVersion.current !== version) return;
        setLibrary({
          status: "ready",
          view,
          items: response.items,
          cursor: response.next_cursor,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || listRequestVersion.current !== version) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        setLibrary({
          status: "error",
          view,
          message: error instanceof Error ? error.message : "Reading history could not be loaded.",
          requestId: error instanceof ApiError ? error.requestId : null,
        });
      });

    return () => controller.abort();
  }, [attempt, onUnauthorized, view]);

  useEffect(() => {
    if (detail !== null || pendingFocus.current === null) return;
    const readingId = pendingFocus.current;
    pendingFocus.current = null;
    const opener = openerRefs.current.get(readingId);
    if (opener) opener.focus();
    else filterRefs.current.get(view)?.focus();
  }, [detail]);

  useEffect(() => {
    if (detail) detailBackRef.current?.focus();
  }, [detail?.item.reading_id]);

  useEffect(() => () => {
    loadMoreController.current?.abort();
    detailController.current?.abort();
    listRequestVersion.current += 1;
    detailRequestVersion.current += 1;
  }, []);

  const changeView = (next: ReadingHistoryView) => {
    if (next === view) return;
    detailController.current?.abort();
    setDetail(null);
    setView(next);
  };

  const loadMore = async () => {
    if (library.status !== "ready" || !library.cursor || loadMorePending.current) return;
    loadMorePending.current = true;
    const requestedView = library.view;
    const cursor = library.cursor;
    const version = listRequestVersion.current;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setLoadMoreProblem("");
    try {
      const response = await listReadingHistory(
        { view: requestedView, limit: 20, cursor },
        controller.signal,
      );
      if (controller.signal.aborted || listRequestVersion.current !== version) return;
      setLibrary((current) => current.status === "ready" && current.view === requestedView
        ? {
            ...current,
            items: [
              ...current.items,
              ...response.items.filter((item) =>
                !current.items.some((existing) => existing.reading_id === item.reading_id)),
            ],
            cursor: response.next_cursor,
          }
        : current);
    } catch (error) {
      if (controller.signal.aborted || listRequestVersion.current !== version) return;
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      setLoadMoreProblem(withRequestId(
        error instanceof Error ? error.message : "More chapters could not be loaded.",
        error instanceof ApiError ? error.requestId : null,
      ));
    } finally {
      if (!controller.signal.aborted && listRequestVersion.current === version) {
        loadMorePending.current = false;
        setLoadingMore(false);
      }
    }
  };

  const openDetail = useCallback((item: ReadingHistoryItem) => {
    const controller = new AbortController();
    detailController.current?.abort();
    detailController.current = controller;
    const version = ++detailRequestVersion.current;
    setDetail({ status: "loading", item });
    void getReading(item.reading_id, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || detailRequestVersion.current !== version) return;
        setDetail({ status: "ready", item, response });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || detailRequestVersion.current !== version) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        setDetail({
          status: "error",
          item,
          message: error instanceof Error ? error.message : "This chapter could not be loaded.",
          requestId: error instanceof ApiError ? error.requestId : null,
        });
      });
  }, [onUnauthorized]);

  const backToList = () => {
    if (!detail) return;
    pendingFocus.current = detail.item.reading_id;
    detailController.current?.abort();
    setDetail(null);
  };

  const handleSaveState = (
    item: ReadingHistoryItem,
    expectedView: ReadingHistoryView,
    state: ReadingSaveState,
  ) => {
    setLibrary((current) => {
      if (current.status !== "ready" || current.view !== expectedView) return current;
      if (current.view === "history") {
        const items = current.items.map((currentItem) =>
          currentItem.reading_id === state.reading_id
            ? { ...currentItem, saved: state.saved, saved_at: state.saved_at }
            : currentItem);
        return { ...current, items };
      }
      if (!state.saved) {
        return {
          ...current,
          items: current.items.filter((currentItem) =>
            currentItem.reading_id !== state.reading_id),
        };
      }
      const savedItem = { ...item, saved: true, saved_at: state.saved_at };
      const items = current.items.some((currentItem) =>
        currentItem.reading_id === state.reading_id)
        ? current.items.map((currentItem) =>
            currentItem.reading_id === state.reading_id ? savedItem : currentItem)
        : [...current.items, savedItem];
      items.sort((a, b) => {
        const savedAtOrder = (b.saved_at ?? "").localeCompare(a.saved_at ?? "");
        return savedAtOrder || b.reading_id.localeCompare(a.reading_id);
      });
      return { ...current, items };
    });
  };

  if (detail) {
    const backLabel = `Back to ${view === "history" ? "History" : "Saved"}`;
    return (
      <section className="history-detail">
        <button ref={detailBackRef} className="history-detail__back" type="button" onClick={backToList}>
          <Icon name="arrow-back" /> {backLabel}
        </button>
        {detail.status === "loading" ? (
          <div className="history-detail__state" role="status" aria-live="polite">
            <span className="today-working" aria-hidden="true"><i /><i /><i /></span>
            Reading this chapter.
          </div>
        ) : detail.status === "error" ? (
          <div className="history-detail__state panel">
            <h1>This chapter could not load.</h1>
            <p role="status">{withRequestId(detail.message, detail.requestId)}</p>
            <button className="button button--secondary" type="button" onClick={() => openDetail(detail.item)}>
              Try again <Icon name="refresh" />
            </button>
          </div>
        ) : (
          <>
            <p className="sr-only" role="status" aria-live="polite">
              Chapter loaded for {formatHistoricalDate(detail.item.local_date)}.
            </p>
            <ReadingArticle
              response={detail.response}
              status={detail.item.status}
              showCheckIn={false}
              onReload={() => openDetail(detail.item)}
              onUnauthorized={onUnauthorized}
              onSaveStateChange={(state) => handleSaveState(detail.item, view, state)}
            />
          </>
        )}
      </section>
    );
  }

  const ready = library.status === "ready" ? library : null;
  return (
    <section className="history-page page-enter" aria-labelledby="history-heading">
      <header className="page-header history-page__header">
        <div>
          <p className="eyebrow">Your library</p>
          <h1 id="history-heading">Reading history</h1>
        </div>
        <p className="page-header__lede">
          Return to the chapters that met an earlier day, including the exact revisions you chose to save.
        </p>
      </header>

      <div className="history-filters" role="group" aria-label="Reading library view">
        {(["history", "saved"] as const).map((filter) => (
          <button
            key={filter}
            ref={(element) => {
              if (element) filterRefs.current.set(filter, element);
              else filterRefs.current.delete(filter);
            }}
            type="button"
            aria-pressed={view === filter}
            onClick={() => changeView(filter)}
          >
            {filter === "history" ? "History" : "Saved"}
          </button>
        ))}
      </div>

      <div id="history-results" className="history-results">
        {library.status === "loading" ? (
          <div className="history-state" role="status" aria-live="polite">
            <span className="today-working" aria-hidden="true"><i /><i /><i /></span>
            Reading your library.
          </div>
        ) : library.status === "error" ? (
          <div className="history-state history-state--error panel">
            <h2>History could not load.</h2>
            <p role="status">{withRequestId(library.message, library.requestId)}</p>
            <button className="button button--secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>
              Try again <Icon name="refresh" />
            </button>
          </div>
        ) : ready ? (
          <>
            {ready.items.length === 0 ? (
              <div className="history-state history-state--empty">
                <h2>{view === "history"
                  ? "No past chapters yet."
                  : ready.cursor
                    ? "More saved chapters are available."
                    : "No saved chapters yet."}</h2>
                <p>{view === "history"
                  ? "Published daily chapters will gather here as each day passes."
                  : ready.cursor
                    ? "Load more to continue through your saved chapters."
                    : "Use Save on a chapter to keep that exact revision close."}</p>
                <a href="#today">Return to Today <Icon name="arrow" /></a>
              </div>
            ) : (
              <>
                <p className="sr-only" role="status" aria-live="polite">{chapterCount(ready.items.length)}</p>
                <ul className="history-list" aria-label="Reading chapters">
                  {ready.items.map((item) => {
                    const label = item.headline ?? "Daily chapter";
                    const formattedDate = formatHistoricalDate(item.local_date);
                    return (
                      <li key={item.reading_id}>
                        <article className="history-card">
                          <button
                            ref={(element) => {
                              if (element) openerRefs.current.set(item.reading_id, element);
                              else openerRefs.current.delete(item.reading_id);
                            }}
                            type="button"
                            aria-label={`Open ${label} from ${formattedDate}`}
                            onClick={() => openDetail(item)}
                          >
                            <span className="history-card__date">{formattedDate}</span>
                            <span className="history-card__title">{label}</span>
                            <span className="history-card__meta">
                              <span>Revision {item.revision}</span>
                              <span className={`history-card__status history-card__status--${item.status}`}>
                                {revisionStatus(item.status)}
                              </span>
                              {item.saved ? <span className="history-card__saved"><Icon name="bookmark" /> Saved</span> : null}
                            </span>
                            <Icon name="arrow" className="history-card__arrow" />
                          </button>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {ready.cursor ? (
              <button
                className="button button--secondary history-load-more"
                type="button"
                disabled={loadingMore}
                aria-busy={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : null}
            {loadMoreProblem ? <p className="history-load-more__error" role="status">{loadMoreProblem}</p> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
