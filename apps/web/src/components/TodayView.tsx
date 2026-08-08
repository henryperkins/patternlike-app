import { ApiFirstFeatureView } from "./ApiFirstFeatureView.js";
import { getTodayReadings } from "../lib/api-client.js";

export function TodayView() {
  return (
    <ApiFirstFeatureView
      eyebrow="Today"
      title="Daily shape is a focused first-pass."
      description="The today surface renders data once the backend shape is available."
      milestone="M3"
      fetcher={getTodayReadings}
    />
  );
}
