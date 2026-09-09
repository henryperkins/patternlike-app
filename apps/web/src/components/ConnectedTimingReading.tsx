import type { ReaderTimingDetail } from "@patternlike/shared";
import { formatTimingOrb, timingCycleTitle, timingDirectionLabel } from "../lib/timing-format.js";

function boundTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(instant));
}

export function ConnectedTimingReading({ timing }: { timing: ReaderTimingDetail }) {
  const { target } = timing;
  return <article className="timing-cycle reading-connection-timing">
    <h1 data-connection-heading tabIndex={-1}>{timingCycleTitle(timing.body, timing.aspect, timing.natal_target)}</h1>
    <p>Retained Timing result · {target.local_date} · {target.time_zone}</p>
    <p>This link opens pass {target.pass_index} of the stored cycle. Opening it does not recalculate the event.</p>
    <p className="timing-cycle__span"><time dateTime={target.starts_at}>{boundTime(target.starts_at, target.time_zone)}</time><span>to</span><time dateTime={target.ends_at}>{boundTime(target.ends_at, target.time_zone)}</time></p>
    <ol className="timing-cycle__passes" aria-label="Exact passes">{timing.passes.map((pass) => <li className="timing-pass" key={pass.pass_index} aria-current={pass.pass_index === target.pass_index ? "true" : undefined}>
      <span className="timing-pass__index">Pass {pass.pass_index}</span><time className="timing-pass__date" dateTime={pass.exact_at}>{boundTime(pass.exact_at, target.time_zone)}</time><span className="timing-pass__direction">{timingDirectionLabel(pass.direction)}</span>{pass.pass_index === target.pass_index ? <span className="timing-pass__relation">Linked pass</span> : null}
    </li>)}</ol>
    <details className="timing-cycle__detail"><summary>Calculation details</summary><dl className="timing-cycle__evidence"><div><dt>Orb</dt><dd>{formatTimingOrb(timing.orb_deg)}</dd></div><div><dt>Phase for the linked date</dt><dd>{timing.phase ?? "Outside an active phase"}</dd></div><div><dt>Cycle policy</dt><dd>{target.policy_version}</dd></div><div><dt>Stored cycle</dt><dd>{target.cycle_id}</dd></div></dl></details>
  </article>;
}
