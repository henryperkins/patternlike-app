import { useId } from "react";
import type { ReadingHistoryStatus, ReadingSaveState } from "@patternlike/shared";
import {
  isDailyReadingV5,
  type DailyReadingResponse,
  type DailyReadingResponseV3,
} from "../lib/api-client.js";
import {
  ROLE_PRESENTATION,
  ROLE_PRESENTATION_V5,
  domainPreferenceLabel,
  formatHistoricalDate,
  formatLocalDate,
  type RolePresentation,
} from "../lib/reading-format.js";
import { DailyCheckInCard } from "./DailyCheckInCard.js";
import { ReadingResponseCard } from "./ReadingResponseCard.js";
import { ReadingSaveButton } from "./ReadingSaveButton.js";
import { WhyThisDrawer } from "./WhyThisDrawer.js";
import { Icon } from "./icons.js";
import { ReadingConnections, type ParagraphConnectionAction } from "./ReadingConnections.js";

export interface ReadingArticleProps {
  response: DailyReadingResponse;
  status?: ReadingHistoryStatus;
  showCheckIn: boolean;
  onReload: () => void;
  onUnauthorized: () => void;
  onSaveStateChange?: (state: ReadingSaveState) => void;
}

function isFallbackShape(reading: DailyReadingResponseV3["reading"]): boolean {
  return (
    reading.fallback_used &&
    reading.paragraphs.length === 1 &&
    reading.paragraphs[0]?.role === "safety_fallback"
  );
}

function Paragraph({
  role,
  text,
  presentation,
  kicker,
}: {
  role: string;
  text: string;
  presentation: RolePresentation | undefined;
  kicker?: string | null;
}) {
  const label = kicker ?? presentation?.kicker;
  const tone = presentation?.tone ?? "body";
  const body = (
    <>
      {label ? <p className="kicker">{label}</p> : null}
      <p className={`reading-paragraph reading-paragraph--${tone}`}>{text}</p>
    </>
  );

  if (tone === "aside") return <aside className="reading-reflection">{body}</aside>;
  if (tone === "notice") {
    return (
      <div className={`reading-notice reading-notice--${role}`}>
        <Icon name="shield" aria-hidden="true" />
        <div>{body}</div>
      </div>
    );
  }
  return <div className={`reading-block reading-block--${role}`}>{body}</div>;
}

function statusLabel(status: ReadingHistoryStatus | undefined): string | null {
  if (status === "invalidated") return "Removed from Today";
  if (status === "superseded") return "Revised";
  return null;
}

function ReadingArticleBody({
  response,
  status,
  showCheckIn,
  onReload,
  onUnauthorized,
  onSaveStateChange,
  paragraphConnection,
}: ReadingArticleProps & { paragraphConnection?: ParagraphConnectionAction }) {
  const headingId = useId();
  const { reading } = response;
  const paragraphs = [...reading.paragraphs].sort((a, b) => a.order - b.order);
  const revisionStatus = statusLabel(status);
  const v5 = isDailyReadingV5(response);
  const fallback = isDailyReadingV5(response) ? false : isFallbackShape(response.reading);

  return (
    <article
      className={`today-page reading-article page-enter${showCheckIn ? "" : " reading-article--history"}`}
      aria-labelledby={headingId}
    >
      <header className="page-header today-page__header">
        <div>
          <p className="eyebrow">{showCheckIn ? "Today" : "History"} / Daily chapter</p>
          <h1 id={headingId}>
            {showCheckIn
              ? formatLocalDate(reading.local_date)
              : formatHistoricalDate(reading.local_date)}
          </h1>
        </div>
        <div className="today-meta">
          {reading.domain_preference ? (
            <span className="today-chip">{domainPreferenceLabel(reading.domain_preference)}</span>
          ) : null}
          {reading.revision > 1 ? (
            <span className="today-chip today-chip--revised">Revised · r{reading.revision}</span>
          ) : null}
          {revisionStatus ? (
            <span className={`today-chip today-chip--status today-chip--${status}`}>{revisionStatus}</span>
          ) : null}
          <span className="today-chip today-chip--code">{reading.locale}</span>
        </div>
      </header>

      <div className="reading-article__actions" aria-label="Reading actions">
        <ReadingSaveButton
          key={reading.reading_id}
          readingId={reading.reading_id}
          onUnauthorized={onUnauthorized}
          onStateChange={onSaveStateChange}
        />
        {showCheckIn ? (
          <a className="reading-article__history-link" href="#history">
            Past chapters <Icon name="history" />
          </a>
        ) : null}
      </div>

      {fallback ? (
        <p className="today-fallback-note">
          Nothing in your chart was eligible to be written about today, so what
          follows is a reviewed passage shown in its place. It is not tailored to
          your chart.
        </p>
      ) : null}

      <div className="today-reading">
        <div className="today-body">
          {paragraphs.map((paragraph, index) => (
            <div key={paragraph.paragraph_id} data-reading-paragraph={paragraph.paragraph_id} tabIndex={-1}>
              <Paragraph
                role={paragraph.role}
                text={paragraph.text}
                presentation={v5
                  ? ROLE_PRESENTATION_V5[paragraph.role as keyof typeof ROLE_PRESENTATION_V5]
                  : ROLE_PRESENTATION[paragraph.role as keyof typeof ROLE_PRESENTATION]}
                kicker={v5 && index === 0 ? response.reading.headline : undefined}
              />
              {paragraphConnection ? <div className="reading-paragraph-connections">{paragraphConnection(paragraph.paragraph_id, paragraph.order)}</div> : null}
            </div>
          ))}
        </div>

        {v5 ? <p className="today-disclosure">{response.reading.disclosure}</p> : null}

        {response.evidence_url ? (
          <WhyThisDrawer
            key={reading.reading_id}
            readingId={reading.reading_id}
            paragraphOrder={paragraphs.map((paragraph) => paragraph.paragraph_id)}
            onReload={onReload}
            onUnauthorized={onUnauthorized}
            reloadLabel={showCheckIn ? "Reload Today" : "Reload chapter"}
          />
        ) : null}
      </div>

      <ReadingResponseCard
        key={reading.reading_id}
        readingId={reading.reading_id}
        revision={reading.revision}
        onUnauthorized={onUnauthorized}
      />
      {showCheckIn ? <DailyCheckInCard /> : null}
    </article>
  );
}

export function ReadingArticle(props: ReadingArticleProps) {
  return <ReadingConnections
    key={`${props.response.reading.reading_id}:${props.response.reading.revision}`}
    response={props.response}
    onUnauthorized={props.onUnauthorized}
    onReload={props.onReload}
    reloadLabel={props.showCheckIn ? "Open current Today" : "Reload source reading"}
    renderSource={(paragraphConnection) => <ReadingArticleBody {...props} paragraphConnection={paragraphConnection} />}
    renderDaily={(response, status, onReload) => <ReadingArticleBody response={response} status={status} showCheckIn={false} onReload={onReload} onUnauthorized={props.onUnauthorized} />}
  />;
}
