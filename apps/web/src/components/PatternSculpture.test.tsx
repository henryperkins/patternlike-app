import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BufferGeometry } from "three";
import PatternSculpture from "./PatternSculpture.js";

const loader = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../lib/portrait-images.js", () => ({ loadPortraitImages: loader.load }));
vi.mock("../lib/image-sculpture.js", () => ({ createImageSculpture: () => ({ geometry: new BufferGeometry(), color: [0.5, 0.4, 0.3], contributions: [] }) }));

const renderer = vi.hoisted(() => ({ configure: vi.fn(), render: vi.fn(), unmount: vi.fn() }));
vi.mock("@react-three/fiber", () => ({
  Canvas: () => <canvas />,
  createRoot: () => renderer,
  extend: vi.fn(),
  events: vi.fn(),
  useFrame: vi.fn(),
  useThree: vi.fn(),
}));

beforeEach(() => {
  loader.load.mockReset().mockResolvedValue([]);
  renderer.configure.mockReset();
  renderer.render.mockReset();
  renderer.unmount.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

const props = {
  imageUrls: ["1.png", "2.png", "3.png", "4.png"],
  sunSign: null,
  selectedIndex: -1,
  onSelect: vi.fn(),
  reducedMotion: true,
  action: { kind: "reset" as const, serial: 0 },
  onReady: vi.fn(),
};

describe("Pattern sculpture graphics lifecycle", () => {
  it("shows image failure without creating any substitute geometry scene", async () => {
    loader.load.mockRejectedValue(new Error("Missing fourth image"));
    const onUnavailable = vi.fn();
    render(<PatternSculpture {...props} onUnavailable={onUnavailable} />);
    expect(await screen.findByText(/could not be shaped/)).toBeInTheDocument();
    expect(renderer.configure).not.toHaveBeenCalled();
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
  });

  it("aborts pending image loading on removal and never initializes a late scene", async () => {
    let complete!: (images: unknown[]) => void;
    loader.load.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const { unmount } = render(<PatternSculpture {...props} onUnavailable={vi.fn()} />);
    const signal = loader.load.mock.calls[0][1] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { complete([]); });
    expect(renderer.configure).not.toHaveBeenCalled();
  });
  it("replaces failed asynchronous renderer initialization with a visible reading fallback", async () => {
    renderer.configure.mockRejectedValue(new Error("Error creating WebGL context"));
    const onUnavailable = vi.fn();
    render(<PatternSculpture {...props} onUnavailable={onUnavailable} />);
    expect(await screen.findByText(/3D is unavailable/)).toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeNull();
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
    await waitFor(() => expect(renderer.unmount).toHaveBeenCalled());
  });

  it("does not publish a scene when initialization finishes after removal", async () => {
    let complete!: () => void;
    renderer.configure.mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
    const { unmount } = render(<PatternSculpture {...props} onUnavailable={vi.fn()} />);
    await waitFor(() => expect(renderer.configure).toHaveBeenCalled());
    unmount();
    await act(async () => { complete(); });
    expect(renderer.render).not.toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBeNull();
    expect(renderer.unmount).toHaveBeenCalled();
  });

  it("removes an initialized scene after context loss and retains the reading fallback", async () => {
    renderer.configure.mockResolvedValue(renderer);
    const onUnavailable = vi.fn();
    render(<PatternSculpture {...props} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(renderer.render).toHaveBeenCalled());
    fireEvent(document.querySelector("canvas")!, new Event("webglcontextlost", { cancelable: true }));
    expect(await screen.findByText(/3D is unavailable/)).toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeNull();
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
    expect(renderer.unmount).toHaveBeenCalled();
  });
});
