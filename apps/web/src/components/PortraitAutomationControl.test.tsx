import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPortraitAutomation, setPortraitAutomation } from "../lib/api-client.js";
import { PortraitAutomationControl } from "./PortraitAutomationControl.js";

vi.mock("../lib/api-client.js", async (original) => ({ ...await original<typeof import("../lib/api-client.js")>(), getPortraitAutomation: vi.fn(), setPortraitAutomation: vi.fn() }));
const preference = { schema_version: "portrait-automation/v1" as const, available: true, chart_id: "chart-current", enabled: false, consent_policy_version: "1.1.0" as const };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPortraitAutomation).mockResolvedValue(preference);
  vi.mocked(setPortraitAutomation).mockResolvedValue({ ...preference, enabled: true });
});

describe("automatic portrait permission", () => {
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
