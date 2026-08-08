import { ApiFirstFeatureView } from "./ApiFirstFeatureView.js";
import { getTiming } from "../lib/api-client.js";

export function TimingView() {
  return (
    <ApiFirstFeatureView
      eyebrow="Timing"
      title="Timing will show cycle movement."
      description="This route resolves timing states through the API and renders them when they are present."
      milestone="M3"
      fetcher={getTiming}
    />
  );
}
