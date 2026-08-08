import { ApiFirstFeatureView } from "./ApiFirstFeatureView.js";
import { getTiming } from "../lib/api-client.js";

// Module scope keeps the reference stable across renders — it is the effect
// dependency inside ApiFirstFeatureView.
const fetchTiming = (signal?: AbortSignal) => getTiming({}, signal);

export function TimingView() {
  return (
    <ApiFirstFeatureView
      eyebrow="Timing / Active cycles"
      title="See the whole arc, not just the peak."
      description="Timing will show emerging, building, exact, reconsidering, and integrating phases without promising events or outcomes."
      milestone="M3"
      fetcher={fetchTiming}
    />
  );
}
