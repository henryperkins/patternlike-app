import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TimezoneLookupResponse } from "@patternlike/shared";
import { Onboarding } from "./Onboarding.js";

describe("birth onboarding", () => {
  it("keeps unknown birth time as a first-class path", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await user.click(screen.getByRole("radio", { name: /I do not know/i }));
    expect(screen.queryByLabelText("Local time")).not.toBeInTheDocument();
    expect(screen.getByText("Suppressed")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByRole("group", { name: /Where was the birth/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", {
        name: /allow Pattern\/Like to encrypt these details/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracy: "unknown",
        birth_date: "1990-05-15",
        birth_time_local: null,
      }),
    );
  });

  /**
   * The primary button must stay a submit button on every step. When it changed
   * from type="button" to type="submit" on the way into step three, React
   * flushed that change during the click and the browser then ran the submit
   * default action on the very same node — posting the profile straight from
   * step two. jsdom does not run that default action, so this asserts the shape
   * that caused it rather than the symptom.
   */
  it("never swaps the type of the primary action button between steps", async () => {
    const user = userEvent.setup();
    render(<Onboarding onSubmit={vi.fn()} />);

    const primary = () => screen.getByRole("button", { name: /Continue|Create my chart/i });

    expect(primary()).toHaveAttribute("type", "submit");
    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");

    await user.click(primary());
    expect(primary()).toHaveAttribute("type", "submit");

    await user.click(primary());
    expect(primary()).toHaveAttribute("type", "submit");
    expect(primary()).toHaveAccessibleName(/Create my chart/i);
  });

  it("reaches the review step without submitting anything", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByRole("group", { name: /Review the boundary/i })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still requires the consent box once the review step has been seen", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /allow Pattern\/Like to encrypt these details/i }),
    );

    // Leaving and re-entering the review step must not stand in for pressing the
    // create button, even though consent is already recorded.
    await user.click(screen.getByRole("button", { name: /Back/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Create my chart/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not advance without the required chart date", async () => {
    const user = userEvent.setup();
    render(<Onboarding onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a birth date");
    expect(screen.getByRole("group", { name: /How precise is the birth time/i })).toBeInTheDocument();
  });
});

describe("historical timezone lookup", () => {
  const RESOLVED: TimezoneLookupResponse = {
    schema_version: "0.2.0",
    timezone: "America/Los_Angeles",
    source: "coordinates",
    confidence: "high",
    boundary_nearby: false,
    hint_overridden: null,
    tzdb_stable_from_year: 1970,
    local: {
      utc_instant: "1990-05-15T19:34:00.000Z",
      utc_offset_minutes: -420,
      utc_offset_label: "UTC-07:00",
      resolution: "unique",
      alternate_utc_instant: null,
      alternate_utc_offset_minutes: null,
    },
    qualifiers: [],
  };

  function mockLookup(response: TimezoneLookupResponse | "unreachable") {
    const fetchMock = vi.fn().mockImplementation(async () => {
      if (response === "unreachable") throw new TypeError("network down");
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /** Fills step one and advances, returning the local time as the field kept it. */
  async function reachLocationStep(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<string> {
    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    const time = screen.getByLabelText("Local time");
    await user.type(time, "12:34:00");
    const entered = (time as HTMLInputElement).value;
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    return entered;
  }

  it("resolves the zone from the birthplace instead of asking the user to vouch for it", async () => {
    const user = userEvent.setup();
    const fetchMock = mockLookup(RESOLVED);
    render(<Onboarding onSubmit={vi.fn()} />);

    const localTime = await reachLocationStep(user);
    await user.type(screen.getByLabelText("Latitude"), "34.0522");
    await user.type(screen.getByLabelText("Longitude"), "-118.2437");

    await waitFor(() =>
      expect(screen.getByLabelText(/IANA timezone/)).toHaveValue("America/Los_Angeles"),
    );
    expect(screen.getByText("UTC-07:00 on this date")).toBeInTheDocument();

    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(init.body as string)).toMatchObject({
      latitude: 34.0522,
      longitude: -118.2437,
      birth_date: "1990-05-15",
      // The birth time goes with the request: whether the offset was daylight
      // or standard can turn on the hour, not just the date.
      birth_time_local: localTime,
    });
  });

  /** The copy this replaced said the lookup "is not connected yet". */
  it("no longer asks the user to confirm an unchecked value", async () => {
    const user = userEvent.setup();
    mockLookup(RESOLVED);
    render(<Onboarding onSubmit={vi.fn()} />);

    await reachLocationStep(user);
    await user.type(screen.getByLabelText("Latitude"), "34.0522");
    await user.type(screen.getByLabelText("Longitude"), "-118.2437");

    await waitFor(() =>
      expect(screen.getByLabelText(/IANA timezone/)).toHaveValue("America/Los_Angeles"),
    );
    expect(screen.queryByText(/not connected yet/i)).not.toBeInTheDocument();
  });

  it("shows the caveats the resolution came back with", async () => {
    const user = userEvent.setup();
    mockLookup({
      ...RESOLVED,
      confidence: "low",
      boundary_nearby: true,
      qualifiers: [
        { code: "near_zone_boundary", message: "Sits on a timezone boundary." },
        { code: "pre_1970_zone_boundary", message: "Rules before 1970 are not guaranteed." },
      ],
    });
    render(<Onboarding onSubmit={vi.fn()} />);

    await reachLocationStep(user);
    await user.type(screen.getByLabelText("Latitude"), "40.7377");
    await user.type(screen.getByLabelText("Longitude"), "-114.0372");

    await waitFor(() =>
      expect(screen.getByText("Sits on a timezone boundary.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Rules before 1970 are not guaranteed.")).toBeInTheDocument();
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
  });

  it("leaves the zone editable when there is no birthplace to resolve from", async () => {
    const user = userEvent.setup();
    const fetchMock = mockLookup(RESOLVED);
    render(<Onboarding onSubmit={vi.fn()} />);

    await reachLocationStep(user);

    const field = screen.getByLabelText(/IANA timezone/);
    expect(field).not.toHaveAttribute("readonly");
    await user.clear(field);
    await user.type(field, "Europe/Lisbon");
    expect(field).toHaveValue("Europe/Lisbon");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still lets the user continue when the lookup cannot be reached", async () => {
    const user = userEvent.setup();
    mockLookup("unreachable");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await reachLocationStep(user);
    await user.type(screen.getByLabelText("Latitude"), "34.0522");
    await user.type(screen.getByLabelText("Longitude"), "-118.2437");

    await waitFor(() =>
      expect(screen.getByText(/could not be reached/i)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /allow Pattern\/Like to encrypt these details/i }),
    );
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    // The server resolves from the same coordinates, so a failed preview costs
    // the confirmation, not the chart.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        birthplace: expect.objectContaining({ latitude: 34.0522, longitude: -118.2437 }),
      }),
    );
  });
});
