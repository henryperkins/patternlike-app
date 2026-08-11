import { useId, useRef, useState } from "react";
import {
  ApiError,
  getReadingEvidence,
  isReadingEvidenceV5,
  type ParagraphEvidence,
  type ParagraphEvidenceV5,
  type ReadingEvidence,
  type ReadingEvidenceV3,
  type ReadingEvidenceV5,
} from "../lib/api-client.js";
import { NOT_IMPLEMENTED_MESSAGE, isNotImplemented, withRequestId } from "../lib/api-status.js";
import {
  ROLE_PRESENTATION,
  ROLE_PRESENTATION_V5,
  allowedUseLabel,
  aiConsentCategoryLabel,
  factScopeLabel,
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

function roleLabelV5(paragraph: ParagraphEvidenceV5): string {
  const presentation = ROLE_PRESENTATION_V5[paragraph.role];
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

function EvidenceBodyV3({ evidence, ordered }: { evidence: ReadingEvidenceV3; ordered: ParagraphEvidence[] }) {
  return (
    <>
      {ordered.map((paragraph) => (
        <ParagraphPanel key={paragraph.paragraph_id} paragraph={paragraph} />
      ))}

      <dl className="evidence-grid" aria-label="Assembly record">
        <div>
          <dt>Assembly</dt>
          <dd>{evidence.assembly_id}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>
            {evidence.revision}
            {evidence.revision_reason
              ? ` · ${evidence.revision_reason.replace(/_/g, " ")}`
              : ""}
          </dd>
        </div>
        {evidence.release_version ? (
          <div>
            <dt>Content release</dt>
            <dd>{evidence.release_version}</dd>
          </div>
        ) : null}
        {evidence.created_at ? (
          <div>
            <dt>Assembled</dt>
            <dd>{formatInstant(evidence.created_at)}</dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}

/**
 * One paragraph's calculated grounding.
 *
 * The label is the readable rendering the calculation service produced, not the
 * opaque handle — a reader learns nothing from `dsf_9f2c…`, and the whole point
 * of this layer is that they can check the claim. `scope` is stated in words
 * because a fact true for everyone must never read as a private discovery.
 *
 * An empty fact list is rendered rather than hidden. A paragraph carried
 * entirely by permitted context is a legal reading — the candidate validator
 * requires grounding of the lead and of anything making an astrological claim —
 * and silently omitting the panel would suggest the prose had evidence the
 * drawer chose not to show.
 */
function FactPanelV5({ paragraph }: { paragraph: ParagraphEvidenceV5 }) {
  return (
    <article className="evidence-paragraph">
      <div className="evidence-paragraph__head">
        <p className="kicker">{roleLabelV5(paragraph)}</p>
      </div>

      {paragraph.fact_refs.length ? (
        <ul className="evidence-list" aria-label="Calculated facts behind this paragraph">
          {paragraph.fact_refs.map((fact) => (
            <li key={fact.fact_id}>
              {fact.label}
              <span className="evidence-scope">{factScopeLabel(fact.scope)}</span>
              {import.meta.env.DEV ? <code>{fact.fact_id}</code> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="evidence-paragraph__note">
          No calculated fact stands behind this paragraph. It was written from the
          context you enabled, and it claims nothing about the sky.
        </p>
      )}
    </article>
  );
}

/**
 * The v5 graph, in three progressively technical layers.
 *
 * Layer one is what was calculated, layer two is which categories of private
 * context were permitted and in which lane, layer three is the exact generation
 * configuration. No raw journal text, no check-in values, and no opaque handles
 * in reader copy — the second layer deliberately carries the category and the
 * lane and nothing else, because the reader already has their own writing; what
 * they cannot otherwise see is what it was allowed to influence.
 */
function EvidenceBodyV5({
  evidence,
  ordered,
  headingIds,
}: {
  evidence: ReadingEvidenceV5;
  ordered: ParagraphEvidenceV5[];
  headingIds: { facts: string; context: string; generation: string };
}) {
  // Grouped by category and deduplicated across paragraphs. The same category
  // permitted for three lanes is one permission with three lanes, not three
  // permissions; repeating the category as three identical terms would say the
  // opposite of what the reader needs to understand.
  const lanes = new Map<string, Set<string>>();
  for (const paragraph of ordered) {
    for (const reference of paragraph.context_refs) {
      const uses = lanes.get(reference.category) ?? new Set<string>();
      uses.add(reference.allowed_use);
      lanes.set(reference.category, uses);
    }
  }

  return (
    <>
      <section className="evidence-layer" aria-labelledby={headingIds.facts}>
        <h2 id={headingIds.facts}>Calculated facts</h2>
        {ordered.map((paragraph) => (
          <FactPanelV5 key={paragraph.paragraph_id} paragraph={paragraph} />
        ))}
      </section>

      <section className="evidence-layer" aria-labelledby={headingIds.context}>
        <h2 id={headingIds.context}>Personal context</h2>
        {lanes.size ? (
          <dl
            className="evidence-lanes"
            aria-label="Context categories and what each was allowed to do"
          >
            {[...lanes.entries()].map(([category, uses]) => (
              <div key={category}>
                <dt>{aiConsentCategoryLabel(category)}</dt>
                <dd>{[...uses].map(allowedUseLabel).join(" · ")}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="evidence-paragraph__note">
            No personal context was used in this reading.
          </p>
        )}
      </section>

      <section className="evidence-layer" aria-labelledby={headingIds.generation}>
        <h2 id={headingIds.generation}>Generation record</h2>
        <dl className="evidence-grid" aria-label="How this reading was generated">
          <div>
            <dt>Written by</dt>
            <dd>
              {evidence.model.provider} · {evidence.model.model}
            </dd>
          </div>
          <div>
            <dt>Generated</dt>
            <dd>{formatInstant(evidence.generated_at)}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>
              {evidence.revision} · {evidence.revision_reason.replace(/_/g, " ")}
            </dd>
          </div>
          <div>
            <dt>Prompt</dt>
            <dd>v{evidence.model.prompt_version}</dd>
          </div>
          <div>
            <dt>Selection</dt>
            <dd>v{evidence.model.selection_policy_version}</dd>
          </div>
          <div>
            <dt>Validation</dt>
            <dd>
              v{evidence.model.validation_policy_version} · {evidence.validation.status}
            </dd>
          </div>
          <div>
            <dt>Ephemeris</dt>
            <dd>{evidence.calculation.ephemeris_data_version}</dd>
          </div>
          <div>
            <dt>Cycle policy</dt>
            <dd>v{evidence.calculation.cycle_policy_version}</dd>
          </div>
          <div>
            <dt>Daily sky policy</dt>
            <dd>v{evidence.calculation.daily_sky_policy_version}</dd>
          </div>
          <div>
            <dt>Time zone data</dt>
            <dd>{evidence.calculation.tzdb_version}</dd>
          </div>
          <div>
            <dt>Input identity</dt>
            <dd>{evidence.generation_input_id}</dd>
          </div>
          <div>
            <dt>Content hash</dt>
            <dd>{evidence.content_hash}</dd>
          </div>
        </dl>
      </section>
    </>
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
  const layerId = useId();

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

  const inProseOrder = <T extends { paragraph_id: string }>(paragraphs: T[]): T[] =>
    [...paragraphs].sort(
      (a, b) =>
        paragraphOrder.indexOf(a.paragraph_id) - paragraphOrder.indexOf(b.paragraph_id),
    );

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
        isReadingEvidenceV5(state.evidence) ? (
          <EvidenceBodyV5
            evidence={state.evidence}
            ordered={inProseOrder(state.evidence.paragraphs)}
            headingIds={{
              facts: `${layerId}-facts`,
              context: `${layerId}-context`,
              generation: `${layerId}-generation`,
            }}
          />
        ) : (
          <EvidenceBodyV3
            evidence={state.evidence}
            ordered={inProseOrder(state.evidence.paragraphs)}
          />
        )
      ) : null}
    </details>
  );
}
