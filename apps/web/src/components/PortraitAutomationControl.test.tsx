import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPortraitAutomation, setPortraitAutomation } from "../lib/api-client.js";
import { PortraitAutomationControl } from "./PortraitAutomationControl.js";

vi.mock("../lib/api-client.js", async (original) => ({ ...await original<typeof import("../lib/api-client.js")>(), getPortraitAutomation: vi.fn(), setPortraitAutomation: vi.fn() }));
const preference = { schema_version: "portrait-automation/v1" as const, available: true, chart_id: "chart-current", enabled: false, consent_policy_version: "1.1.0" as const };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPortraitAutomation).mockResolvedValue(preference);
  vi.mocked(setPortraitAutomation).mockResolvedValue({ ...preference, enabled: true });
});
afterEach(() => vi.restoreAllMocks());

describe("automatic portrait permission", () => {
  it.each([
    { initialEnabled: false, returnedEnabled: false, returnedLegacy: false },
    { initialEnabled: true, returnedEnabled: true, returnedLegacy: false },
    { initialEnabled: true, returnedEnabled: false, returnedLegacy: true },
  ])("reports a concurrent permission change instead of confirming the requested choice: %j", async ({ initialEnabled, returnedEnabled, returnedLegacy }) => {
    const initial = { ...preference, schema_version: "portrait-automation/v2" as const, consent_policy_version: "2.0.0" as const, enabled: initialEnabled, legacy_enabled: false };
    vi.mocked(getPortraitAutomation).mockResolvedValue(initial);
    vi.mocked(setPortraitAutomation).mockResolvedValue({ ...initial, enabled: returnedEnabled, legacy_enabled: returnedLegacy });
    const changed = vi.fn();
    render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} onChanged={changed} />);
    await userEvent.click(await screen.findByRole("checkbox"));
    expect(await screen.findByText("Your artwork permission changed. Review the current choice and try again.")).toBeInTheDocument();
    expect(screen.queryByText(/^Automatic artwork is (on|off)\.$/)).not.toBeInTheDocument();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(returnedEnabled);
    if (returnedLegacy) expect(screen.getByRole("button", { name: "Stop four-chapter automatic artwork" })).toBeEnabled();
    expect(changed).toHaveBeenCalledOnce();
  });

  it.each(["disabled", "unknown"] as const)("does not save after stale permission refresh becomes %s and disallows enablement", async (grantStatus) => {
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
    const choice = await screen.findByRole("checkbox");
    vi.mocked(getPortraitAutomation).mockResolvedValue({ ...preference, available: false,
      state: { supported_protocols: ["v1"], generation_available: false, grant_status: grantStatus, grant_policy_version: null, allowed_actions: [] } });
    clock.mockReturnValue(start + 60_001);
    await userEvent.click(choice);
    await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument());
    expect(getPortraitAutomation).toHaveBeenCalledTimes(2);
    expect(setPortraitAutomation).not.toHaveBeenCalled();
    expect(screen.queryByText("Automatic artwork is on.")).not.toBeInTheDocument();
    if (grantStatus === "unknown") expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("withdraws the legacy grant after refreshing stale permission", async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    const legacy = { schema_version: "portrait-automation/v2" as const, legacy_enabled: true, available: false, chart_id: "chart-current", enabled: false, consent_policy_version: "2.0.0" as const };
    vi.mocked(getPortraitAutomation).mockResolvedValue(legacy);
    vi.mocked(setPortraitAutomation).mockResolvedValue({ ...legacy, legacy_enabled: false });
    render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
    const stop = await screen.findByRole("button", { name: "Stop four-chapter automatic artwork" });
    clock.mockReturnValue(start + 60_001);
    await userEvent.click(stop);
    expect(setPortraitAutomation).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, consent_policy_version: "1.1.0" }), expect.any(String), expect.any(AbortSignal));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop four-chapter automatic artwork" })).not.toBeInTheDocument());
  });

  it("requires a new choice when a stale legacy withdrawal refresh finds an adaptive grant", async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    const legacy = { schema_version: "portrait-automation/v2" as const, legacy_enabled: true, available: false, chart_id: "chart-current", enabled: false, consent_policy_version: "2.0.0" as const };
    vi.mocked(getPortraitAutomation).mockResolvedValueOnce(legacy).mockResolvedValue({ ...legacy, legacy_enabled: false, enabled: true });
    render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
    const stop = await screen.findByRole("button", { name: "Stop four-chapter automatic artwork" });
    clock.mockReturnValue(start + 60_001);
    await userEvent.click(stop);
    expect(setPortraitAutomation).not.toHaveBeenCalled();
    expect(await screen.findByRole("checkbox")).toBeChecked();
  });

  it("locks a stale permission refresh and aborts it when the chart changes", async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    let release!: (value: typeof preference) => void;
    vi.mocked(getPortraitAutomation).mockResolvedValueOnce(preference).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const unauthorized = vi.fn();
    const changed = vi.fn();
    const view = render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={unauthorized} onChanged={changed} />);
    const choice = await screen.findByRole("checkbox");
    clock.mockReturnValue(start + 60_001);
    await userEvent.click(choice);
    expect(choice).toBeDisabled();
    const signal = vi.mocked(getPortraitAutomation).mock.calls[1][0];
    vi.mocked(getPortraitAutomation).mockResolvedValue({ ...preference, chart_id: "chart-next" });
    view.rerender(<PortraitAutomationControl chartId="chart-next" onUnauthorized={unauthorized} onChanged={changed} />);
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    expect(signal?.aborted).toBe(true);
    await act(async () => release(preference));
    expect(setPortraitAutomation).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(changed).not.toHaveBeenCalled();
  });

  it("shows unknown permission with a reload action when the grant store is unavailable", async () => {
    vi.mocked(getPortraitAutomation).mockResolvedValue({ ...preference, available: false,
      state: { supported_protocols: ["v1", "v2"], generation_available: false, grant_status: "unknown", grant_policy_version: null, allowed_actions: [] } });
    render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
    await screen.findByText(/Automatic artwork permission could not be checked/);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(getPortraitAutomation).toHaveBeenCalledTimes(2);
    expect(setPortraitAutomation).not.toHaveBeenCalled();
  });

  it("respects the allowed actions when generation is operational but enablement is not permitted", async () => {
    vi.mocked(getPortraitAutomation).mockResolvedValue({ ...preference,
      state: { supported_protocols: ["v1", "v2"], generation_available: true, grant_status: "disabled", grant_policy_version: null, allowed_actions: [] } });
    render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
    const choice = await screen.findByRole("checkbox");
    expect(choice).toBeDisabled();
    await userEvent.click(choice);
    expect(setPortraitAutomation).not.toHaveBeenCalled();
  });

  it("requires a read-only status reload after an ambiguous save before another mutation", async () => {
    vi.mocked(setPortraitAutomation).mockRejectedValue(new Error("Network outcome unknown"));
    render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
    const choice = await screen.findByRole("checkbox");
    await userEvent.click(choice);
    await screen.findByText("Network outcome unknown");
    expect(choice).toBeDisabled();
    await userEvent.click(choice);
    expect(setPortraitAutomation).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(choice).toBeEnabled());
    expect(getPortraitAutomation).toHaveBeenCalledTimes(2);
    expect(setPortraitAutomation).toHaveBeenCalledTimes(1);
  });

  it("starts unchecked and records the explicit choice for this chart once", async () => {
    const changed = vi.fn();
    render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} onChanged={changed} />);
    const choice = await screen.findByRole("checkbox", { name: "Automatically create my 3D portrait" });
    expect(choice).not.toBeChecked();
    expect(screen.getByText(/chapter text and generated images.*Codex/)).toBeInTheDocument();
    expect(setPortraitAutomation).not.toHaveBeenCalled();
    await userEvent.click(choice);
    await waitFor(() => expect(choice).toBeChecked());
    expect(setPortraitAutomation).toHaveBeenCalledWith({ chart_id: "chart-current", enabled: true, confirm: "ENABLE AUTOMATIC PORTRAITS", consent_policy_version: "1.1.0" }, expect.any(String), expect.any(AbortSignal));
    expect(changed).toHaveBeenCalledOnce();
  });

  it("restores saved permission and withdraws it without hiding the current reading", async () => {
    vi.mocked(getPortraitAutomation).mockResolvedValue({ ...preference, enabled: true });
    vi.mocked(setPortraitAutomation).mockResolvedValue(preference);
    render(<><PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} /><p>Complete reading</p></>);
    const choice = await screen.findByRole("checkbox");
    expect(choice).toBeChecked();
    await userEvent.click(choice);
    await waitFor(() => expect(choice).not.toBeChecked());
    expect(vi.mocked(setPortraitAutomation).mock.calls[0][0]).toMatchObject({ enabled: false, confirm: "DISABLE AUTOMATIC PORTRAITS" });
    expect(screen.getByText("Complete reading")).toBeInTheDocument();
  });

  it("preserves the last saved choice when updating fails and never applies a different chart's preference", async () => {
    vi.mocked(setPortraitAutomation).mockRejectedValue(new Error("Could not save your choice."));
    const { unmount } = render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
    const choice = await screen.findByRole("checkbox");
    await userEvent.click(choice);
    await screen.findByText("Could not save your choice.");
    expect(choice).not.toBeChecked();
    unmount();
    vi.mocked(getPortraitAutomation).mockResolvedValue({ ...preference, chart_id: "different" });
    render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
    await screen.findByText(/no longer matches this chart/);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("blocks new opt-ins when creation is unavailable while keeping withdrawal available", async () => {
    const unauthorized = vi.fn();
    const view = render(<PortraitAutomationControl chartId="chart-current" canEnable={false} onUnauthorized={unauthorized} />);
    const choice = await screen.findByRole("checkbox");
    expect(choice).toBeDisabled();
    await userEvent.click(choice); expect(setPortraitAutomation).not.toHaveBeenCalled();
    view.unmount();
    vi.mocked(getPortraitAutomation).mockResolvedValue({ ...preference, enabled: true });
    vi.mocked(setPortraitAutomation).mockResolvedValue(preference);
    render(<PortraitAutomationControl chartId="chart-current" canEnable={false} onUnauthorized={unauthorized} />);
    const savedChoice = await screen.findByRole("checkbox");
    expect(savedChoice).toBeEnabled();
    await userEvent.click(savedChoice);
    await waitFor(() => expect(savedChoice).not.toBeChecked());
    expect(savedChoice).toBeDisabled();
  });

  it("aborts a pending choice on chart changes and permits a fresh action without applying the late result", async () => {
    let release!: (value: typeof preference) => void;
    vi.mocked(setPortraitAutomation).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const unauthorized = vi.fn(); const changed = vi.fn();
    const view = render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={unauthorized} onChanged={changed} />);
    await userEvent.click(await screen.findByRole("checkbox"));
    const oldSignal = vi.mocked(setPortraitAutomation).mock.calls[0][2]!;
    vi.mocked(getPortraitAutomation).mockResolvedValue({ ...preference, chart_id: "chart-next" });
    view.rerender(<PortraitAutomationControl chartId="chart-next" onUnauthorized={unauthorized} onChanged={changed} />);
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    expect(oldSignal.aborted).toBe(true);
    await act(async () => release({ ...preference, enabled: true }));
    expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(changed).not.toHaveBeenCalled();
    vi.mocked(setPortraitAutomation).mockResolvedValue({ ...preference, chart_id: "chart-next", enabled: true });
    await userEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
    expect(changed).toHaveBeenCalledOnce();
  });
});

it("can withdraw a saved adaptive grant while new creation is switched off", async () => {
  vi.mocked(getPortraitAutomation).mockResolvedValue({ schema_version: "portrait-automation/v2", legacy_enabled: false, available: false, chart_id: "chart-current", enabled: true, consent_policy_version: "2.0.0" });
  vi.mocked(setPortraitAutomation).mockResolvedValue({ schema_version: "portrait-automation/v2", legacy_enabled: false, available: false, chart_id: "chart-current", enabled: false, consent_policy_version: "2.0.0" });
  render(<PortraitAutomationControl chartId="chart-current" canEnable={false} onUnauthorized={vi.fn()} />);
  const choice = await screen.findByRole("checkbox");
  expect(choice).toBeEnabled(); expect(choice).toBeChecked();
  await userEvent.click(choice);
  expect(setPortraitAutomation).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, consent_policy_version: "2.0.0" }), expect.any(String), expect.any(AbortSignal));
});

it("shows and stops earlier four-chapter permission even with adaptive creation unavailable", async () => {
  vi.mocked(getPortraitAutomation).mockResolvedValue({ schema_version: "portrait-automation/v2", legacy_enabled: true, available: false, chart_id: "chart-current", enabled: false, consent_policy_version: "2.0.0" });
  vi.mocked(setPortraitAutomation).mockResolvedValue({ schema_version: "portrait-automation/v2", legacy_enabled: false, available: false, chart_id: "chart-current", enabled: false, consent_policy_version: "2.0.0" });
  render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
  const stop = await screen.findByRole("button", { name: "Stop four-chapter automatic artwork" });
  expect(stop).toBeEnabled(); expect(screen.getByRole("checkbox")).toBeDisabled();
  await userEvent.click(stop);
  expect(setPortraitAutomation).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, consent_policy_version: "1.1.0" }), expect.any(String), expect.any(AbortSignal));
});

it("explicitly renews visible legacy permission for every chapter with policy 2.0", async () => {
  const preference = { schema_version: "portrait-automation/v2" as const, legacy_enabled: true, available: true, chart_id: "chart-current", enabled: false, consent_policy_version: "2.0.0" as const };
  vi.mocked(getPortraitAutomation).mockResolvedValue(preference);
  vi.mocked(setPortraitAutomation).mockResolvedValue({ ...preference, legacy_enabled: false, enabled: true });
  render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
  const choice = await screen.findByRole("checkbox", { name: "Renew automatic artwork for every chapter" });
  expect(screen.getByText(/one image and one 3D model.*three to six/)).toBeInTheDocument();
  expect(setPortraitAutomation).not.toHaveBeenCalled();
  await userEvent.click(choice);
  expect(setPortraitAutomation).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, consent_policy_version: "2.0.0" }), expect.any(String), expect.any(AbortSignal));
});
it.each([{ chart_id: "wrong-chart", enabled: false }, { chart_id: "chart-current", enabled: true }])("rejects contradictory or wrong-chart legacy grants", async patch => {
  vi.mocked(getPortraitAutomation).mockResolvedValue({ schema_version: "portrait-automation/v2", legacy_enabled: true, available: false, consent_policy_version: "2.0.0", ...patch });
  render(<PortraitAutomationControl chartId="chart-current" onUnauthorized={vi.fn()} />);
  await screen.findByText(/no longer matches this chart/);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
