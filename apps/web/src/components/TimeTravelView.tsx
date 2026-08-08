import { useCallback, useState } from "react";
import { ApiFirstFeatureView } from "./ApiFirstFeatureView.js";
import { getTimeTravel } from "../lib/api-client.js";

/** Local calendar date, not the UTC one — the route reconstructs a user's day. */
function todayIsoDate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function TimeTravelView() {
  // Pinned at mount so the fetcher stays stable and a session that crosses
  // midnight does not silently re-target a different day.
  const [date] = useState(todayIsoDate);
  const fetcher = useCallback(
    (signal?: AbortSignal) => getTimeTravel(date, signal),
    [date],
  );

  return (
    <ApiFirstFeatureView
      eyebrow="Time travel / Date reconstruction"
      title="Return to a date with the record intact."
      description="Time Travel will reconstruct cycle state for a chosen date and keep saved context separate from retrospective calculation. Date selection arrives with the surface; until then it asks for today."
      milestone="M4"
      fetcher={fetcher}
    />
  );
}
