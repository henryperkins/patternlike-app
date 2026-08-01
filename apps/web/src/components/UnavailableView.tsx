import type { ViewId } from "./AppShell.js";

const viewCopy: Record<Exclude<ViewId, "pattern" | "privacy">, {
  eyebrow: string;
  title: string;
  description: string;
  milestone: string;
  requirements: string[];
}> = {
  today: {
    eyebrow: "Today / Daily chapter",
    title: "A clear day, not a horoscope feed.",
    description:
      "Today will select one major theme and at most one supporting influence, each traceable to chart facts and reviewed content.",
    milestone: "M3",
    requirements: ["Active cycle detection", "Approved editorial release", "Evidence-linked assembly"],
  },
  timing: {
    eyebrow: "Timing / Active cycles",
    title: "See the whole arc, not just the peak.",
    description:
      "Timing will show emerging, building, exact, reconsidering, and integrating phases without promising events or outcomes.",
    milestone: "M3",
    requirements: ["Multi-pass cycle model", "Phase-aware content", "Calculation refresh workflow"],
  },
  travel: {
    eyebrow: "Time travel / Date reconstruction",
    title: "Return to a date with the record intact.",
    description:
      "Time Travel will reconstruct cycle state for a chosen date and keep saved context separate from retrospective calculation.",
    milestone: "M4",
    requirements: ["Cycle history", "Revocation-aware context", "Present-date comparison"],
  },
};

export function UnavailableView({ view, hasChart }: {
  view: Exclude<ViewId, "pattern" | "privacy">;
  hasChart: boolean;
}) {
  const copy = viewCopy[view];

  return (
    <div className="unavailable-page page-enter">
      <header className="unavailable-hero">
        <p className="eyebrow">{copy.eyebrow}</p>
        <span className="milestone-stamp">Planned / {copy.milestone}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>

      <section className="readiness-panel panel">
        <div className="readiness-panel__header">
          <div>
            <p className="kicker">Release discipline</p>
            <h2>This surface stays quiet until its evidence exists.</h2>
          </div>
          <span className="readiness-state">Not active</span>
        </div>
        <div className="readiness-steps">
          <article className={hasChart ? "readiness-step readiness-step--done" : "readiness-step"}>
            <span>01</span>
            <strong>Natal chart</strong>
            <small>{hasChart ? "Ready" : "Needed"}</small>
          </article>
          {copy.requirements.map((requirement, index) => (
            <article className="readiness-step" key={requirement}>
              <span>0{index + 2}</span>
              <strong>{requirement}</strong>
              <small>Pending</small>
            </article>
          ))}
        </div>
      </section>

      <a className="return-link" href="#pattern">
        <span>Return to what is available now</span>
        View your calculated pattern
      </a>
    </div>
  );
}
