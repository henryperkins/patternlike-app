import { ApiFirstFeatureView } from "./ApiFirstFeatureView.js";
import { getTimeTravel } from "../lib/api-client.js";

export function TimeTravelView() {
  return (
    <ApiFirstFeatureView
      eyebrow="Time travel"
      title="Date reconstruction returns context for another day."
      description="This surface is available by API result when a full reconstruction payload is returned."
      milestone="M4"
      fetcher={getTimeTravel}
    />
  );
}
