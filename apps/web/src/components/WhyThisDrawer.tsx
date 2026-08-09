import { useRef, useState } from "react";
import {
  ApiError,
  getReadingEvidence,
  type ParagraphEvidence,
  type ReadingEvidence,
} from "../lib/api-client.js";
import { NOT_IMPLEMENTED_MESSAGE, isNotImplemented, withRequestId } from "../lib/api-status.js";
import {
  ROLE_PRESENTATION,
  formatInstant,
  formatOrb,
  humanFactType,
  humanLane,
  humanPhase,
  rankingFactorLabel,
} from "../lib/reading-format.js";

type DrawerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; evidence: ReadingEvidence }
  | { status: "missing" }
  | { status: "error"; message: string };

interface WhyThisDrawerProps {
  readingId: string;
  /** Reading paragraph order, so the drawer reads in the same order as the prose. */
  paragraphOrder: string[];
  onReload: () => void;
  onUnauthorized: () => void;
}

function roleLabel(paragraph: ParagraphEvidence): string {
  const presentation = ROLE_PRESENTATION[paragraph.role];
  return presentation?.kicker ?? "Primary theme";
}

function factSummary(fact: ParagraphEvidence["facts"][number]): string {
  const parts = [humanFactType(fact.fact_type)];
  if (fact.technique) parts.push(fact.technique);
  if (fact.phase) parts.push(humanPhase(fact.phase));
  if (typeof fact.orb_deg === "number") parts.push(formatOrb(fact.orb_deg));
  // Which crossing of a retrograde loop this is. The field exists so the drawer
  // can say that rather than imply a single passage.
  if (typeof fact.pass_index === "number") parts.push(`pass ${fact.pass_index}`);
  return parts.join(" · ");
}

function ParagraphPanel({ paragraph }: { paragraph: ParagraphEvidence }) {
  const ranking = paragraph.ranking_factors ?? [];
  const isFallback = paragraph.role === "safety_fallback";

  return (
    <article className="evidence-paragraph">
      <div className="evidence-paragraph__head">
        <p className="kicker">{roleLabel(paragraph)}</p>
        <span className="evidence-lane">{humanLane(paragraph.evidence_lane)}</span>
      </div>

      {isFallback ? (
        <p className="evidence-paragraph__note">
          No chart fact was eligible to be written about today, so this passage is
          reviewed standing copy rather than anything derived from your chart.
        </p>
      ) : null}

      {paragraph.facts.length ? (
        <ul className="evidence-list" aria-label="Chart facts behind this paragraph">
          {paragraph.facts.map((fact) => (
            <li key={fact.id}>
              {factSummary(fact)}
              {/*
                The opaque id is developer detail. Printed to a reader it looks
                like leaked internals and tells them nothing.
              */}
              {import.meta.env.DEV ? <code>{fact.id}</code> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {paragraph.content.length ? (
        <dl className="evidence-grid" aria-label="Reviewed content used">
          {paragraph.content.map((ref) => (
            <div key={ref.fragment_id}>
              <dt>{ref.fragment_id}</dt>
              <dd>
                v{ref.content_version} · {ref.release_version}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {ranking.length ? (
        <ul className="evidence-reasons" aria-label="Why this was ranked here">
          {ranking.map((factor) => (
            <li key={`${factor.factor}-${factor.reason}`}>
              <span>{rankingFactorLabel(factor.factor)}</span>
              {/*
                `reason` is the ranker's own note — `orb_0.42`,
                `transiting_saturn` — and the schema says so. Developer detail,
                like the fact id above it, not the sentence a reader gets.
              */}
              {import.meta.env.DEV ? <code>{factor.reason}</code> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {paragraph.context_signals.length ? (
        <ul className="evidence-list" aria-label="Context used">
          {paragraph.context_signals.map((signal) => (
            <li key={signal.signal_id}>
              {signal.source_id} · {signal.allowed_use.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/**
 * The "Why this?" surface.
 *
 * Fetched lazily on first open and cached: the route decrypts every evidence row
 * server-side, and most readings are never interrogated. Rendered only when the
 * Today response carried an `evidence_url` — a drawer that 404s is worse than no
 * drawer.
 */
export function WhyThisDrawer({
  readingId,
  paragraphOrder,
  onReload,
  onUnauthorized,
}: WhyThisDrawerProps) {
  const [state, setState] = useState<DrawerState>({ status: "idle" });
  const requested = useRef(false);

  const load = async () => {
    if (requested.current) return;
    requested.current = true;
    setState({ status: "loading" });
    try {
      const evidence = await getReadingEvidence(readingId);
      setState({ status: "ready", evidence });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      if (isNotImplemented(error)) {
        setState({ status: "error", message: NOT_IMPLEMENTED_MESSAGE });
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: "missing" });
        return;
      }
      requested.current = false;
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? withRequestId(error.message, error.requestId)
            : error instanceof Error
              ? error.message
              : "The provenance record could not be read.",
      });
    }
  };

  const ordered =
    state.status === "ready"
      ? [...state.evidence.paragraphs].sort(
          (a, b) =>
            paragraphOrder.indexOf(a.paragraph_id) - paragraphOrder.indexOf(b.paragraph_id),
        )
      : [];

  return (
    <details
      className="evidence-drawer today-evidence"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>
        <span>
          <small>Provenance</small>
          Why this reading?
        </span>
        <span className="evidence-drawer__toggle">Open</span>
      </summary>

      <div role="status" aria-live="polite">
        {state.status === "loading" ? <p>Reading the provenance record.</p> : null}

        {state.status === "missing" ? (
          <div className="today-evidence__problem">
            <p>
              The provenance record for this reading is no longer available. The
              reading above may have been revised since it loaded.
            </p>
            <button className="button button--secondary" type="button" onClick={onReload}>
              Reload Today
            </button>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="today-evidence__problem">
            <p>{state.message}</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>

      {state.status === "ready" ? (
        <>
          {ordered.map((paragraph) => (
            <ParagraphPanel key={paragraph.paragraph_id} paragraph={paragraph} />
          ))}

          <dl className="evidence-grid" aria-label="Assembly record">
            <div>
              <dt>Assembly</dt>
              <dd>{state.evidence.assembly_id}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>
                {state.evidence.revision}
                {state.evidence.revision_reason
                  ? ` · ${state.evidence.revision_reason.replace(/_/g, " ")}`
                  : ""}
              </dd>
            </div>
            {state.evidence.release_version ? (
              <div>
                <dt>Content release</dt>
                <dd>{state.evidence.release_version}</dd>
              </div>
            ) : null}
            {state.evidence.created_at ? (
              <div>
                <dt>Assembled</dt>
                <dd>{formatInstant(state.evidence.created_at)}</dd>
              </div>
            ) : null}
          </dl>
        </>
      ) : null}
    </details>
  );
}
