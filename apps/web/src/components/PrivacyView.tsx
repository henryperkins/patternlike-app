import { Icon } from "./icons.js";

const sources = [
  {
    name: "Birth details",
    scope: "Chart calculation only",
    state: "Encrypted",
    active: true,
  },
  {
    name: "Calculated chart facts",
    scope: "Pattern and timing eligibility",
    state: "Active",
    active: true,
  },
  {
    name: "Check-ins and priorities",
    scope: "May rank valid themes",
    state: "Not connected",
    active: false,
  },
  {
    name: "Calendar, health, and device data",
    scope: "No access granted",
    state: "Off",
    active: false,
  },
];

export function PrivacyView({ hasChart }: { hasChart: boolean }) {
  return (
    <div className="privacy-page page-enter">
      <header className="page-header privacy-page__header">
        <div>
          <p className="eyebrow">Context &amp; privacy</p>
          <h1>Your data has<br />clear edges.</h1>
        </div>
        <p className="page-header__lede">
          See what is active, what each source is allowed to do, and what remains
          outside the product. Context may frame a reading. It never changes chart facts.
        </p>
      </header>

      <section className="privacy-overview">
        <article className="privacy-score">
          <Icon name="shield" />
          <span>Data posture</span>
          <strong>{hasChart ? "2 active sources" : "No chart data"}</strong>
          <p>No external context sources connected.</p>
        </article>
        <article className="privacy-principle panel">
          <p className="kicker">The governing rule</p>
          <blockquote>
            Context can rank or frame a valid interpretation. It cannot alter the chart
            or be presented as something astrology discovered.
          </blockquote>
        </article>
      </section>

      <section className="source-ledger panel" aria-labelledby="source-heading">
        <div className="panel-heading">
          <div>
            <p className="kicker">Permission ledger</p>
            <h2 id="source-heading">Active and available sources</h2>
          </div>
          <span className="panel-code">M1 CONTROL SURFACE</span>
        </div>
        <div className="source-list">
          {sources.map((source) => (
            <article className="source-row" key={source.name}>
              <span className={`source-state${source.active ? " source-state--active" : ""}`}>
                <i /> {source.state}
              </span>
              <div>
                <h3>{source.name}</h3>
                <p>{source.scope}</p>
              </div>
              <button type="button" disabled title="Source controls arrive in M4">
                {source.active ? "Review" : "Unavailable"}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="privacy-actions" aria-labelledby="account-data-heading">
        <div>
          <p className="eyebrow">Account data</p>
          <h2 id="account-data-heading">Portable in. Portable out.</h2>
          <p>
            Export and deletion workflows are part of M1, but their API routes are not
            active yet. The controls remain disabled until they can complete safely.
          </p>
        </div>
        <div className="privacy-actions__buttons">
          <button className="button button--secondary" type="button" disabled>
            Request export <span>M1 pending</span>
          </button>
          <button className="button button--danger" type="button" disabled>
            Delete account <span>M1 pending</span>
          </button>
        </div>
      </section>
    </div>
  );
}
