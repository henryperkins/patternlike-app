import type { CelestialBody, LongitudePosition } from "@patternlike/shared";
import type { ChartResponse } from "../lib/api-client.js";
import { ChartWheel } from "./ChartWheel.js";
import { Icon } from "./icons.js";

const BODY_NAMES: Record<CelestialBody, string> = {
  sun: "Sun",
  moon: "Moon",
  mercury: "Mercury",
  venus: "Venus",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  uranus: "Uranus",
  neptune: "Neptune",
  pluto: "Pluto",
  true_node: "North node",
  ascendant: "Ascendant",
  midheaven: "Midheaven",
};

function positionLabel(position: LongitudePosition | undefined): string {
  if (!position) return "Not available";
  const degrees = ((position.longitude_deg % 30) + 30) % 30;
  const sign = position.sign
    ? position.sign.charAt(0).toUpperCase() + position.sign.slice(1)
    : "Unknown sign";
  return `${sign} ${degrees.toFixed(1)} deg`;
}

function calculationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Calculation date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function fingerprintTail(value: string): string {
  const bare = value.replace(/^sha256:/, "");
  return `${bare.slice(0, 8)}...${bare.slice(-8)}`;
}

export function ChartView({ chart }: { chart: ChartResponse }) {
  const positionByBody = new Map(chart.positions.map((position) => [position.body, position]));
  const anchors: CelestialBody[] = ["sun", "moon", "ascendant"];
  const visiblePositions = chart.positions.filter(
    (position) => position.body !== "ascendant" && position.body !== "midheaven",
  );

  return (
    <div className="chart-page page-enter">
      <header className="page-header chart-page__header">
        <div>
          <p className="eyebrow">Your pattern / Calculation layer</p>
          <h1 aria-label="The architecture of your chart.">The architecture<br />of your chart.</h1>
        </div>
        <div className="calculation-stamp">
          <span>Last calculated</span>
          <strong>{calculationDate(chart.calculated_at)}</strong>
          <small>Contract {chart.contract_version}</small>
        </div>
      </header>

      <section className="anchor-strip" aria-label="Chart anchors">
        {anchors.map((body, index) => {
          const position = positionByBody.get(body);
          return (
            <article className="anchor" key={body}>
              <span className="anchor__number">0{index + 1}</span>
              <div>
                <p>{BODY_NAMES[body]}</p>
                <strong>{positionLabel(position)}</strong>
                <small>
                  {position?.house ? `House ${position.house}` : body === "ascendant" ? "Birth time dependent" : "No house used"}
                </small>
              </div>
            </article>
          );
        })}
      </section>

      <div className="chart-layout">
        <section className="chart-visual panel" aria-labelledby="chart-map-heading">
          <div className="panel-heading">
            <div>
              <p className="kicker">Normalized facts</p>
              <h2 id="chart-map-heading">Calculation map</h2>
            </div>
            <span className="panel-code">TROPICAL / GEOCENTRIC</span>
          </div>
          <ChartWheel
            positions={chart.positions}
            aspects={chart.aspects}
            houseCusps={chart.houses?.cusps_deg ?? null}
          />
          <div className="wheel-legend" aria-hidden="true">
            <span><i className="legend-line legend-line--soft" /> Flowing aspect</span>
            <span><i className="legend-line legend-line--hard" /> Dynamic aspect</span>
            <span><i className="legend-dot" /> Body position</span>
          </div>
        </section>

        <aside className="chart-side">
          <section className="uncertainty-card">
            <div className="uncertainty-card__top">
              <Icon name="shield" />
              <span>{chart.uncertainty.accuracy} time</span>
            </div>
            <h2>What this chart can support</h2>
            <p>
              {chart.uncertainty.user_facing_summary ??
                "Calculation confidence is recorded with the chart."}
            </p>
            <dl>
              <div>
                <dt>Houses</dt>
                <dd>{chart.houses ? chart.houses.system_used : "Suppressed"}</dd>
              </div>
              <div>
                <dt>Angles</dt>
                <dd>{chart.angles ? "Available" : "Suppressed"}</dd>
              </div>
              <div>
                <dt>Qualified facts</dt>
                <dd>{chart.uncertainty.qualified_features.length}</dd>
              </div>
            </dl>
          </section>

          <section className="interpretation-boundary panel">
            <p className="kicker">Interpretation boundary</p>
            <h2>Facts first. Meaning second.</h2>
            <p>
              This M1 view contains chart facts only. Pattern chapters arrive through
              reviewed editorial releases, never generic sign filler.
            </p>
            <a href="#today" className="inline-link">
              See the daily layer status <Icon name="arrow" />
            </a>
          </section>
        </aside>
      </div>

      <section className="facts-panel panel" aria-labelledby="positions-heading">
        <div className="panel-heading">
          <div>
            <p className="kicker">Inspectable evidence</p>
            <h2 id="positions-heading">Planetary positions</h2>
          </div>
          <span className="panel-code">{visiblePositions.length} BODIES</span>
        </div>
        <div className="position-list">
          {visiblePositions.map((position) => (
            <article className="position-row" key={position.body}>
              <span className="position-row__body">{BODY_NAMES[position.body]}</span>
              <strong>{positionLabel(position)}</strong>
              <span>{position.house ? `House ${position.house}` : "House omitted"}</span>
              <span className={position.retrograde ? "retrograde" : "direct"}>
                {position.retrograde ? "Retrograde" : "Direct"}
              </span>
            </article>
          ))}
        </div>
      </section>

      <details className="evidence-drawer">
        <summary>
          <span>
            <small>Technical evidence</small>
            Reproduce this calculation
          </span>
          <span className="evidence-drawer__toggle">Open</span>
        </summary>
        <dl className="evidence-grid">
          <div><dt>Chart ID</dt><dd>{chart.id}</dd></div>
          <div><dt>Fingerprint</dt><dd title={chart.fingerprint}>{fingerprintTail(chart.fingerprint)}</dd></div>
          <div><dt>Calculation contract</dt><dd>{chart.contract_id}@{chart.contract_version}</dd></div>
          <div><dt>Timezone database</dt><dd>{chart.tzdb_version ?? "Not stamped"}</dd></div>
          <div><dt>Profile version</dt><dd>{chart.profile_version}</dd></div>
          <div><dt>Major aspects</dt><dd>{chart.aspects.length}</dd></div>
        </dl>
      </details>
    </div>
  );
}
