import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChartResponse } from "../lib/api-client.js";
import { ChartView } from "./ChartView.js";

vi.mock("./PatternExperience.js", () => ({ PatternExperience: () => null }));

function chart(qualifiedFeatures: ChartResponse["uncertainty"]["qualified_features"]): ChartResponse {
  return {
    schema_version: "0.2.0",
    id: "cht_location_uncertainty_0001",
    user_id: "usr_location_uncertainty_0001",
    profile_version: 1,
    fingerprint: `sha256:${"a".repeat(64)}`,
    contract_id: "calc-contract-launch",
    contract_version: "0.2.0",
    container_digest: `sha256:${"b".repeat(64)}`,
    tzdb_version: "2026a",
    birth: {
      accuracy: "exact",
      utc_instant: null,
      timezone: null,
      place_label: null,
      latitude: null,
      longitude: null,
    },
    positions: [],
    houses: null,
    angles: null,
    aspects: [],
    uncertainty: {
      accuracy: "exact",
      window: null,
      suppressed_features: [],
      qualified_features: qualifiedFeatures,
      user_facing_summary: "Location details need confirmation.",
    },
    calculated_at: "2026-08-28T00:00:00.000Z",
    status: "active",
  };
}

describe("ChartView location qualifications", () => {
  it("renders plain-language location qualifications", () => {
    render(<ChartView chart={chart([
      { feature_id: "birthplace", qualification: "technique_specific" },
      { feature_id: "birth_instant", qualification: "technique_specific" },
    ])} onUnauthorized={vi.fn()} />);

    expect(screen.getByText("Birthplace resolution needs confirmation.")).toBeInTheDocument();
    expect(screen.getByText("The civil-time conversion needs confirmation.")).toBeInTheDocument();
    expect(screen.queryByText("technique_specific")).not.toBeInTheDocument();
  });

  it("omits the list when no location feature is qualified", () => {
    render(<ChartView chart={chart([
      { feature_id: "moon", qualification: "low_confidence_moon" },
    ])} onUnauthorized={vi.fn()} />);

    expect(screen.queryByText(/needs confirmation/i)).not.toBeInTheDocument();
  });
});
