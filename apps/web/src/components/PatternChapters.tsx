import { useCallback, useEffect, useRef, useState } from "react";
import type { PatternChapter, PatternResponse } from "@patternlike/shared";

import { ApiError, getPattern } from "../lib/api-client.js";
import { isNotImplemented } from "../lib/api-status.js";
import { Icon } from "./icons.js";

interface PatternChaptersProps {
  onUnauthorized: () => void;
}

type Failure =
  | { kind: "not_implemented"; requestId: string | null }
  | { kind: "refused"; code: string; message: string; requestId: string | null; retryable: boolean };

/**
 * Reader words for each refusal this route can produce.
 *
 * The rollback case is the one that matters most: an active release built before
 * Pattern existed serves Today perfectly well and has no chapters at all. Saying
 * so is the honest answer; substituting sign-based filler would not be.
 */
const REFUSAL_TITLES: Record<string, string> = {
  pattern_release_not_active: "No reviewed Pattern content is published right now.",
  release_unreadable: "The published Pattern content could not be verified.",
  release_hash_mismatch: "The published Pattern content could not be verified.",
  locale_confirmation_required: "Confirm your content language to read your Pattern.",
  unsupported_locale: "The published content does not cover your confirmed language.",
  feature_derivation_failed: "Your chart's Pattern facts could not be derived.",
  pattern_cursor_stale: "Your Pattern changed while you were reading it.",
  invalid_pattern_query: "That Pattern request could not be read.",
};

const REFUSAL_DETAILS: Record<string, string> = {
  pattern_release_not_active:
    "Your chart facts above are unaffected. Chapters appear only from a signed, reviewed release, and the product will not invent them in the meantime.",
  release_unreadable:
    "The stored content did not match its own record, so it was withheld rather than shown. Your chart facts above are unaffected.",
  release_hash_mismatch:
    "The stored content did not match its own record, so it was withheld rather than shown. Your chart facts above are unaffected.",
  locale_confirmation_required:
    "Chapters are published per language. Confirm which one you read and this section will load.",
  unsupported_locale:
    "Nothing eligible was published in your confirmed language, and no translation is invented here.",
  feature_derivation_failed:
    "Nothing was matched against a partial set of facts. Your chart facts above are unaffected.",
  pattern_cursor_stale:
    "Your chart, your derived facts, or the published release changed, so the rest of the list was refused rather than mixed with the earlier pages.",
};

/**
 * Codes where asking again can genuinely produce a different answer.
 *
 * `release_hash_mismatch` is deliberately absent: the bytes are present and are
 * not the bytes that were approved, which no number of retries changes.
 */
const RETRYABLE_CODES = new Set([
  /** R2 unreachable or the object missing — infrastructural. */
  "release_unreadable",
  /** A transient failure deriving the feature set; the next request re-derives. */
  "feature_derivation_failed",
  /** The chart, feature set, or release moved mid-drain; a fresh drain works. */
  "pattern_cursor_stale",
  "internal_error",
]);

function chapterFailureTitle(failure: Extract<Failure, { kind: "refused" }>): string {
  return REFUSAL_TITLES[failure.code] ?? failure.message;
}

function ChapterCard({ chapter, releaseVersion }: { chapter: PatternChapter; releaseVersion: string }) {
  return (
    <article className="pattern-chapter" aria-labelledby={`chapter-${chapter.content_id}`}>
      <h3 id={`chapter-${chapter.content_id}`}>{chapter.title}</h3>
      <p className="pattern-chapter__summary">{chapter.summary}</p>
      <p className="pattern-chapter__body">{chapter.body}</p>

      {chapter.tensions.length > 0 ? (
        <div className="pattern-chapter__list">
          <h4>Where it pulls against itself</h4>
          <ul>
            {chapter.tensions.map((tension) => (
              <li key={tension}>{tension}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {chapter.resources.length > 0 ? (
        <div className="pattern-chapter__list">
          <h4>What it gives you to work with</h4>
          <ul>
            {chapter.resources.map((resource) => (
              <li key={resource}>{resource}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        Required in every chapter, and never inside a disclosure. A pattern
        described only in the direction it usually runs reads as a verdict; the
        counter-expression is the sentence that keeps it a description.
      */}
      <p className="pattern-chapter__counter">
        <span>The same pattern, expressed the other way</span>
        {chapter.counter_expression}
      </p>

      <details className="pattern-chapter__why">
        <summary>
          <span>Why this?</span>
          <span className="pattern-chapter__toggle">Open</span>
        </summary>
        <ul className="pattern-chapter__evidence">
          {chapter.evidence.map((item) => (
            <li key={item.feature_id}>
              <span className="pattern-chapter__evidence-label">{item.label}</span>
              <span className="pattern-chapter__evidence-id">{item.feature_id}</span>
            </li>
          ))}
        </ul>
        <p className="pattern-chapter__release">
          Release {releaseVersion} · content {chapter.content_id}@{chapter.content_version}
        </p>
      </details>
    </article>
  );
}

function OmissionNotice({ page }: { page: PatternResponse }) {
  const { omissions } = page;
  const reasons: string[] = [];
  if (omissions.accuracy > 0) {
    reasons.push(
      `${omissions.accuracy} need${omissions.accuracy === 1 ? "s" : ""} a more exact birth time than your chart records`,
    );
  }
  if (omissions.houses_or_angles > 0) {
    reasons.push(
      `${omissions.houses_or_angles} need${omissions.houses_or_angles === 1 ? "s" : ""} houses or angles, which this chart suppresses`,
    );
  }
  if (omissions.locale > 0) {
    reasons.push(
      `${omissions.locale} ${omissions.locale === 1 ? "is" : "are"} published in another language`,
    );
  }
  if (omissions.predicate_mismatch > 0) {
    reasons.push(
      `${omissions.predicate_mismatch} did not match your calculated facts`,
    );
  }
  if (reasons.length === 0) return null;

  return (
    <p className="pattern-omissions">
      <span>Not shown, and why</span>
      {reasons.join("; ")}.
    </p>
  );
}

export function PatternChapters({ onUnauthorized }: PatternChaptersProps) {
  const [chapters, setChapters] = useState<PatternChapter[]>([]);
  const [page, setPage] = useState<PatternResponse | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const retryRef = useRef<HTMLButtonElement>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);

  const retry = useCallback(() => {
    setRestoreFocus(true);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setChapters([]);
    setPage(null);

    void (async () => {
      try {
        // Drained to the end, not stopped at the first page: the cursor is a
        // transport bound, and stopping early would silently become a
        // personalised top-N the reader never asked for. The server caps the
        // catalog, so this terminates.
        const collected: PatternChapter[] = [];
        let cursor: string | null = null;
        let last: PatternResponse | null = null;
        for (let request = 0; request < 64; request++) {
          const result: PatternResponse = await getPattern(
            cursor ? { cursor } : {},
            controller.signal,
          );
          if (controller.signal.aborted) return;
          collected.push(...result.items);
          last = result;
          cursor = result.next_cursor;
          if (!cursor) break;
        }
        setChapters(collected);
        setPage(last);
        setFailure(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          setFailure(null);
          onUnauthorized();
          return;
        }
        if (isNotImplemented(error)) {
          setFailure({ kind: "not_implemented", requestId: error.requestId });
          return;
        }
        setFailure({
          kind: "refused",
          code: error instanceof ApiError ? error.code : "unreachable",
          message:
            error instanceof Error
              ? error.message
              : "Your Pattern could not be loaded in this session.",
          requestId: error instanceof ApiError ? error.requestId : null,
          // An explicit allowlist, not `status >= 500`. A rolled-back release
          // and an unsupported locale both answer 503 forever, and a retry
          // button on either teaches the reader that waiting is the fix.
          retryable: !(error instanceof ApiError) || RETRYABLE_CODES.has(error.code),
        });
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();

    return () => controller.abort();
  }, [attempt, onUnauthorized]);

  useEffect(() => {
    if (restoreFocus && !busy) {
      setRestoreFocus(false);
      retryRef.current?.focus();
    }
  }, [busy, restoreFocus]);

  const statusMessage = busy
    ? "Matching your calculated facts against reviewed content."
    : failure?.kind === "not_implemented"
      ? "Pattern availability changed."
      : failure
        ? "Pattern content could not be loaded."
        : page
          ? `${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"} matched your chart.`
          : "Pattern is ready to load.";

  return (
    <section className="pattern-chapters" aria-labelledby="pattern-chapters-heading">
      <div className="panel-heading">
        <div>
          <p className="kicker">Reviewed interpretation</p>
          <h2 id="pattern-chapters-heading">Your pattern, in words</h2>
        </div>
        {page ? (
          <span className="panel-code">RELEASE {page.release_version}</span>
        ) : null}
      </div>

      <p className="pattern-chapters__status" role="status" aria-live="polite">
        {statusMessage}
      </p>

      {failure ? (
        <div className="pattern-chapters__failure">
          <h3>
            {failure.kind === "not_implemented"
              ? "Pattern chapters are not active on this Worker."
              : chapterFailureTitle(failure)}
          </h3>
          <p>
            {failure.kind === "not_implemented"
              ? "An installed or cached copy of the app may be newer than the Worker currently serving this route. Your chart facts above are unaffected."
              : (REFUSAL_DETAILS[failure.code] ??
                "Your chart facts above are unaffected.")}
          </p>
          {failure.kind === "refused" && failure.code === "locale_confirmation_required" ? (
            <a className="inline-link" href="#today">
              Confirm your language <Icon name="arrow" />
            </a>
          ) : null}
          {failure.kind === "refused" && failure.requestId ? (
            <small className="pattern-chapters__request">Request {failure.requestId}</small>
          ) : null}
          {failure.kind === "refused" && failure.retryable ? (
            <button
              className="button button--secondary"
              type="button"
              ref={retryRef}
              onClick={retry}
              disabled={busy}
              aria-busy={busy}
            >
              Try again <Icon name="refresh" />
            </button>
          ) : null}
        </div>
      ) : null}

      {page && chapters.length === 0 ? (
        <div className="pattern-chapters__empty">
          <h3>No reviewed chapter matched this chart.</h3>
          <p>
            Every published chapter was checked against your calculated facts and none of
            them applied. Nothing generic is shown in their place.
          </p>
          <OmissionNotice page={page} />
        </div>
      ) : null}

      {page && chapters.length > 0 ? (
        <>
          <div className="pattern-chapters__list">
            {chapters.map((chapter) => (
              <ChapterCard
                key={chapter.content_id}
                chapter={chapter}
                releaseVersion={page.release_version}
              />
            ))}
          </div>
          <OmissionNotice page={page} />
          {page.effective_accuracy !== "exact" ? (
            <p className="pattern-chapters__accuracy">
              <span>Birth-time accuracy</span>
              Your chart records a {page.effective_accuracy} birth time, so chapters that
              depend on houses, angles, or a time-sensitive Moon were never eligible. That
              is a limit of the data, not a judgement about you.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
