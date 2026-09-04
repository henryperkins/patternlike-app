import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PlaceResolutionResponse } from "@patternlike/shared";
import { PlaceAutocomplete } from "./PlaceAutocomplete.js";
import { capturedFor, mockApiResponses } from "../test/api-mock.js";
import { geocoderGranted, geocoderNotGranted } from "../test/geocoder-consent-fixture.js";

const RESOLVED: PlaceResolutionResponse = {
  schema_version: "0.8.0", place_id: "plc_00000000000000000000000000000001",
  label: "London, UK", latitude: 51.5074, longitude: -0.1278,
  geocode_confidence: "high", qualifiers: [],
};

function Harness() {
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState<PlaceResolutionResponse | null>(null);
  return <PlaceAutocomplete value={value} selectedPlaceId={selected?.place_id ?? null}
    selectedConfidence={selected?.geocode_confidence ?? null}
    onInputChange={(text) => { setValue(text); setSelected(null); }}
    onResolved={(place) => { setSelected(place); setValue(place.label); }} />;
}

function renderSearch(searchResponse = { status: 200, body: {
  schema_version: "0.8.0", candidates: [{ candidate_id: "geoapify-london", primary_label: "London", secondary_label: "UK" }],
} } as { status: number; body: unknown }) {
  mockApiResponses({
    "GET /v1/consents/geocoder": { status: 200, body: geocoderNotGranted },
    "PUT /v1/consents/geocoder": { status: 200, body: geocoderGranted },
    "DELETE /v1/consents/geocoder": { status: 200, body: geocoderNotGranted },
    "/v1/places/search": searchResponse,
    "/v1/places/resolve": { status: 200, body: RESOLVED },
  });
  render(<Harness />);
}

describe("Geoapify birthplace search", () => {
  it("requires opt-in, supports keyboard selection, and attributes the selected result", async () => {
    const user = userEvent.setup();
    renderSearch();
    const toggle = await screen.findByRole("checkbox", { name: "Enable optional Geoapify birthplace search" });
    const input = screen.getByRole("combobox", { name: "Place label" });
    await user.type(input, "London");
    expect(capturedFor("/v1/places/search")).toHaveLength(0);
    await user.click(toggle);
    await screen.findByRole("option");
    expect(screen.getByRole("link", { name: "Powered by Geoapify" })).toHaveAttribute("href", "https://www.geoapify.com/");
    expect(screen.getByRole("link", { name: "© OpenStreetMap contributors" })).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(input).toHaveValue("London, UK"));
    expect(screen.getByText(/Selected with high confidence/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Powered by Geoapify" })).toBeInTheDocument();
    expect(capturedFor("/v1/places/resolve")[0]?.body).toMatchObject({ candidate_id: "geoapify-london" });
    expect(capturedFor("/v1/places/search")[0]?.headers.has("x-api-key")).toBe(false);
  });

  it("withdraws permission and clears suggestions without disabling manual entry", async () => {
    const user = userEvent.setup();
    renderSearch();
    const toggle = await screen.findByRole("checkbox", { name: "Enable optional Geoapify birthplace search" });
    await user.click(toggle);
    await user.type(screen.getByRole("combobox"), "London");
    await screen.findByRole("option");
    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(capturedFor("/v1/consents/geocoder").at(-1)).toMatchObject({ method: "DELETE", body: null });
  });

  it("offers manual entry when the provider is unavailable", async () => {
    const user = userEvent.setup();
    renderSearch({ status: 503, body: { error: { code: "geocoder_unavailable", message: "Place search is unavailable" } } });
    await user.click(await screen.findByRole("checkbox", { name: "Enable optional Geoapify birthplace search" }));
    await user.type(screen.getByRole("combobox"), "London");
    expect(await screen.findByText("Geoapify search is unavailable. Enter the place and coordinates manually.")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
