import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Sphere, Vector3 } from "three";
import PatternSculpture, { closestSculptureStar, sculptureCameraFrame } from "./PatternSculpture.js";

const loader = vi.hoisted(() => ({ load: vi.fn() }));
const models = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../lib/portrait-images.js", () => ({ loadPortraitImages: loader.load }));
vi.mock("../lib/image-sculpture.js", () => ({ createImageSculpture: models.create }));

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
  models.create.mockReset().mockImplementation(() => trackedModel().model);
  renderer.configure.mockReset();
  renderer.render.mockReset();
  renderer.unmount.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

function trackedModel() {
  const geometry = new BufferGeometry();
  const lineGeometry = new BufferGeometry();
  const pointsReleased = vi.fn();
  const linesReleased = vi.fn();
  geometry.addEventListener("dispose", pointsReleased);
  lineGeometry.addEventListener("dispose", linesReleased);
  return {
    model: { geometry, lineGeometry, color: [0.5, 0.4, 0.3], contributions: [] },
    pointsReleased,
    linesReleased,
  };
}

const props = {
  imageUrls: ["1.png", "2.png", "3.png", "4.png"],
  sunSign: null,
  selectedIndex: -1,
  onSelect: vi.fn(),
  reducedMotion: true,
  action: { kind: "reset" as const, serial: 0 },
  onReady: vi.fn(),
};

describe("Sculpture camera framing and star picking", () => {
  it("fits the actual bounding sphere with space around it on narrow and wide viewports", () => {
    const geometry = new BufferGeometry();
    geometry.boundingSphere = new Sphere(new Vector3(0.2, -0.15, 0.1), 1.5);
    const frame = sculptureCameraFrame(geometry);
    expect(frame.center).toEqual(geometry.boundingSphere.center);
    expect(frame.distance).toBeGreaterThan(4.9);
    expect(frame.distance).toBeLessThan(5.2);
    expect(frame.minDistance).toBeGreaterThan(geometry.boundingSphere.radius);
    expect(frame.minDistance).toBeLessThan(frame.distance);
    expect(frame.maxDistance).toBeGreaterThan(frame.distance);
    for (const aspect of [0.65, 1, 2]) {
      const camera = new PerspectiveCamera(2 * Math.atan(Math.tan(39 * Math.PI / 360) / Math.min(1, aspect)) * 180 / Math.PI, aspect, 0.1, 40);
      for (const direction of [new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(1, 0.5, 1)]) {
        camera.position.copy(frame.center).addScaledVector(direction.normalize(), frame.distance);
        camera.lookAt(frame.center); camera.updateMatrixWorld();
        let extent = 0;
        for (let latitude = 0; latitude <= 18; latitude++) for (let longitude = 0; longitude < 36; longitude++) {
          const phi = latitude * Math.PI / 18; const theta = longitude * Math.PI / 18;
          const point = new Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
            .multiplyScalar(1.5).add(frame.center).project(camera);
          extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
        }
        expect(extent).toBeLessThan(0.9);
        expect(extent).toBeGreaterThan(0.82);
      }
    }
    geometry.boundingSphere.radius = 3;
    expect(sculptureCameraFrame(geometry).distance).toBeCloseTo(frame.distance * 2, 12);
  });

  function pickingScene(positions: number[]) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const camera = new PerspectiveCamera(90, 1, 0.1, 40);
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    return { geometry, camera };
  }

  it("uses CSS-pixel tolerance for touch targets and selects the nearest star on screen", () => {
    const { geometry, camera } = pickingScene([0.3, 0, 5, 0, 0, 0]);
    const hit = { width: 200, height: 200, x: 100, y: 100, tolerance: 20 };
    expect(closestSculptureStar(geometry, camera, hit)).toBe(1);
    const single = pickingScene([0, 0, 0]);
    expect(closestSculptureStar(single.geometry, single.camera, { ...hit, x: 118 })).toBe(0);
    expect(closestSculptureStar(single.geometry, single.camera, { ...hit, x: 118, tolerance: 8 })).toBeNull();
    expect(closestSculptureStar(single.geometry, single.camera, { ...hit, x: 121 })).toBeNull();
  });

  it("ignores clipped stars and uses depth only to break equal screen distances", () => {
    const hidden = pickingScene([0, 0, 11, 10.1, 0, 0]);
    const hit = { width: 200, height: 200, x: 100, y: 100, tolerance: 20 };
    expect(closestSculptureStar(hidden.geometry, hidden.camera, hit)).toBeNull();
    expect(closestSculptureStar(hidden.geometry, hidden.camera, { ...hit, x: 199 })).toBeNull();
    const overlap = pickingScene([0, 0, 0, 0, 0, 5]);
    expect(closestSculptureStar(overlap.geometry, overlap.camera, hit)).toBe(1);
  });
});

describe("Pattern sculpture graphics lifecycle", () => {
  it("selects a nearby star on a touch tap while rejecting drags and canceled gestures", async () => {
    const owned = trackedModel();
    owned.model.geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
    owned.model.geometry.setAttribute("sourceIndex", new Float32BufferAttribute([2], 1));
    models.create.mockReturnValueOnce(owned.model);
    const camera = new PerspectiveCamera(39, 1, 0.1, 40);
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    renderer.render.mockReturnValue({ getState: () => ({ camera, setSize: vi.fn(), invalidate: vi.fn() }) });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200, toJSON() {} });
    const onSelect = vi.fn();
    try {
      const { unmount } = render(<PatternSculpture {...props} onSelect={onSelect} onUnavailable={vi.fn()} />);
      await waitFor(() => expect(renderer.render).toHaveBeenCalled());
      const canvas = document.querySelector("canvas")!;
      const pointer = (type: string, x: number) => fireEvent(canvas, Object.assign(new Event(type), {
        pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: 100,
      }));
      pointer("pointerdown", 118); pointer("pointerup", 118);
      expect(onSelect).toHaveBeenLastCalledWith(2);
      expect(onSelect).toHaveBeenCalledTimes(1);
      pointer("pointerdown", 100); pointer("pointermove", 140); pointer("pointerup", 100);
      pointer("pointerdown", 100); pointer("pointercancel", 100); pointer("pointerup", 100);
      expect(onSelect).toHaveBeenCalledTimes(1);
      unmount();
      pointer("pointerdown", 100); pointer("pointerup", 100);
      expect(onSelect).toHaveBeenCalledTimes(1);
    } finally {
      rect.mockRestore();
    }
  });

  it("releases both owned geometries when an initialized portrait is removed", async () => {
    const owned = trackedModel();
    models.create.mockReturnValueOnce(owned.model);
    const { unmount } = render(<PatternSculpture {...props} onUnavailable={vi.fn()} />);
    await waitFor(() => expect(renderer.render).toHaveBeenCalled());
    const signal = loader.load.mock.calls[0][1] as AbortSignal;

    expect(owned.pointsReleased).not.toHaveBeenCalled();
    expect(owned.linesReleased).not.toHaveBeenCalled();
    unmount();

    expect(signal.aborted).toBe(true);
    expect(owned.pointsReleased).toHaveBeenCalledTimes(1);
    expect(owned.linesReleased).toHaveBeenCalledTimes(1);
    expect(document.querySelector("canvas")).toBeNull();
  });

  it.each([
    { changed: "images", next: { imageUrls: ["new-1.png", "new-2.png", "new-3.png", "new-4.png"] } },
    { changed: "Sun sign", next: { sunSign: "aries" as const } },
  ])("releases the old geometries while replacement $changed are loading", async ({ next }) => {
    const previous = trackedModel();
    const replacement = trackedModel();
    models.create.mockReturnValueOnce(previous.model).mockReturnValueOnce(replacement.model);
    let complete!: (images: unknown[]) => void;
    loader.load.mockResolvedValueOnce([]).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const { rerender, unmount } = render(<PatternSculpture {...props} onUnavailable={vi.fn()} />);
    await waitFor(() => expect(renderer.render).toHaveBeenCalled());
    const previousSignal = loader.load.mock.calls[0][1] as AbortSignal;

    rerender(<PatternSculpture {...props} {...next} onUnavailable={vi.fn()} />);

    expect(previousSignal.aborted).toBe(true);
    expect(previous.pointsReleased).toHaveBeenCalledTimes(1);
    expect(previous.linesReleased).toHaveBeenCalledTimes(1);
    expect(document.querySelector("canvas")).toBeNull();
    await act(async () => { complete([]); });
    await waitFor(() => expect(document.querySelector("canvas")).not.toBeNull());
    expect(replacement.pointsReleased).not.toHaveBeenCalled();
    expect(replacement.linesReleased).not.toHaveBeenCalled();

    unmount();

    expect(previous.pointsReleased).toHaveBeenCalledTimes(1);
    expect(previous.linesReleased).toHaveBeenCalledTimes(1);
    expect(replacement.pointsReleased).toHaveBeenCalledTimes(1);
    expect(replacement.linesReleased).toHaveBeenCalledTimes(1);
  });

  it("keeps the live geometries and canvas when only chapter selection changes", async () => {
    const owned = trackedModel();
    models.create.mockReturnValueOnce(owned.model);
    const { rerender, unmount } = render(<PatternSculpture {...props} onUnavailable={vi.fn()} />);
    await waitFor(() => expect(renderer.render).toHaveBeenCalled());
    const canvas = document.querySelector("canvas");

    rerender(<PatternSculpture {...props} selectedIndex={2} onUnavailable={vi.fn()} />);

    expect(document.querySelector("canvas")).toBe(canvas);
    expect(owned.pointsReleased).not.toHaveBeenCalled();
    expect(owned.linesReleased).not.toHaveBeenCalled();
    unmount();
    expect(owned.pointsReleased).toHaveBeenCalledTimes(1);
    expect(owned.linesReleased).toHaveBeenCalledTimes(1);
  });

  it("shows image failure without creating any substitute geometry scene", async () => {
    loader.load.mockRejectedValue(new Error("Missing fourth image"));
    const onUnavailable = vi.fn();
    render(<PatternSculpture {...props} onUnavailable={onUnavailable} />);
    expect(await screen.findByText(/could not be drawn/)).toBeInTheDocument();
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
