import { ApiFirstFeatureView } from "./ApiFirstFeatureView.js";
import { getTodayReadings } from "../lib/api-client.js";

export function TodayView() {
  return (
    <ApiFirstFeatureView
      eyebrow="Today / Daily chapter"
      title="A clear day, not a horoscope feed."
      description="Today will select one major theme and at most one supporting influence, each traceable to chart facts and reviewed content."
      milestone="M3"
      fetcher={getTodayReadings}
    />
  );
}
