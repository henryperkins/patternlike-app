import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createRoot, events, extend, useFrame, useThree, type ReconcilerRoot, type RootStore } from "@react-three/fiber";
import { AdditiveBlending, Color, Float32BufferAttribute, LineBasicMaterial, LineSegments, PerspectiveCamera, Points, ShaderMaterial, Vector3, type BufferGeometry, type Camera } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createImageSculpture } from "../lib/image-sculpture.js";
import { loadPortraitImages } from "../lib/portrait-images.js";
import type { ZodiacSignName } from "@patternlike/shared";

export interface CameraAction {
  kind: "left" | "right" | "closer" | "farther" | "reset";
  serial: number;
}
interface SculptureProps {
  imageUrls: readonly string[];
  sunSign: ZodiacSignName | null;
  selectedIndex: number;
  onSelect: (index: number | null) => void;
  reducedMotion: boolean;
  action: CameraAction;
  onReady: () => void;
  onUnavailable: () => void;
}
type SculptureModel = ReturnType<typeof createImageSculpture>;
type CanvasProps = SculptureProps & { model: SculptureModel };
const SHORT_AXIS_FOV = 39;
const HOME_DIRECTION = new Vector3(0, 0.04, 1).normalize();
extend({ LineBasicMaterial, LineSegments, Points, ShaderMaterial });

/** A sphere fit remains safe as the viewer turns the graph through any angle. */
export function sculptureCameraFrame(geometry: BufferGeometry) {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  const radius = sphere && Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 0.1;
  const distance = radius * 1.12 / Math.sin(SHORT_AXIS_FOV * Math.PI / 360);
  return {
    center: sphere?.center.clone() ?? new Vector3(),
    distance,
    minDistance: distance * 0.72,
    maxDistance: distance * 1.55,
  };
}

/** Picking uses CSS pixels, independent of device pixel ratio or star depth. */
export function closestSculptureStar(
  geometry: BufferGeometry,
  camera: Camera,
  hit: { width: number; height: number; x: number; y: number; tolerance: number },
): number | null {
  if (hit.width <= 0 || hit.height <= 0) return null;
  const positions = geometry.getAttribute("position");
  if (!positions) return null;
  camera.updateMatrixWorld();
  const point = new Vector3();
  let closest: number | null = null;
  let bestDistance = hit.tolerance * hit.tolerance;
  let bestDepth = Infinity;
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index).project(camera);
    if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue;
    const x = (point.x + 1) * hit.width / 2;
    const y = (1 - point.y) * hit.height / 2;
    const squaredDistance = (x - hit.x) ** 2 + (y - hit.y) ** 2;
    if (squaredDistance < bestDistance || (squaredDistance === bestDistance && point.z < bestDepth)) {
      closest = index; bestDistance = squaredDistance; bestDepth = point.z;
    }
  }
  return closest;
}

// One draw for the stars, one for their connections. The soft light is part of
// each point sprite, so no bloom pass or continuous animation is necessary.
const starVertex = `
  attribute float starStrength;
  varying vec3 starColor;
  uniform float pixelRatio;
  void main() {
    starColor = color;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = (3.0 + starStrength * starStrength * 14.0) * pixelRatio * 7.4 / -viewPosition.z;
  }
`;
const starFragment = `
  varying vec3 starColor;
  void main() {
    vec2 offset = gl_PointCoord - 0.5;
    float radius = length(offset);
    if (radius > 0.5) discard;
    float core = 1.0 - smoothstep(0.07, 0.19, radius);
    float halo = pow(max(0.0, 1.0 - radius * 2.0), 3.0) * 0.48;
    gl_FragColor = vec4(starColor, min(1.0, core + halo));
    #include <colorspace_fragment>
  }
`;

type ControlsCleanup = RefObject<(() => void) | null>;

function CameraRig({ selectedIndex, model, reducedMotion, action, onReady, controlsCleanup }: CanvasProps & { controlsCleanup: ControlsCleanup }) {
  const { camera, gl, invalidate } = useThree();
  const frame = useMemo(() => sculptureCameraFrame(model.geometry), [model]);
  const controls = useRef<OrbitControls | null>(null);
  const transition = useRef<{ target: Vector3; position: Vector3 } | null>(null);
  const didRender = useRef(false);

  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    controls.current = orbit;
    orbit.enablePan = false;
    orbit.enableDamping = false;
    // Keep page scrolling available. Zoom has explicit mouse, keyboard, and touch buttons.
    orbit.enableZoom = false;
    orbit.minDistance = frame.minDistance;
    orbit.maxDistance = frame.maxDistance;
    orbit.target.copy(frame.center);
    orbit.minPolarAngle = 0.35;
    orbit.maxPolarAngle = Math.PI - 0.35;
    orbit.rotateSpeed = 0.65;
    gl.domElement.style.touchAction = "pan-y";
    const redraw = () => invalidate();
    const cancelTransition = () => { transition.current = null; };
    orbit.addEventListener("change", redraw);
    orbit.addEventListener("start", cancelTransition);
    orbit.update();
    invalidate();
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      orbit.removeEventListener("change", redraw);
      orbit.removeEventListener("start", cancelTransition);
      orbit.dispose();
      controls.current = null;
      if (controlsCleanup.current === dispose) controlsCleanup.current = null;
    };
    controlsCleanup.current = dispose;
    return dispose;
  }, [camera, gl, invalidate, controlsCleanup, frame]);

  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const target = frame.center.clone();
    if (selectedIndex >= 0) {
      const selectedCenter = new Vector3();
      const positions = model.geometry.getAttribute("position");
      const sources = model.geometry.getAttribute("sourceIndex");
      let count = 0;
      for (let i = 0; i < positions.count; i++) {
        if (sources?.getX(i) !== selectedIndex) continue;
        selectedCenter.add(new Vector3().fromBufferAttribute(positions, i));
        count++;
      }
      // This small shift fits within the sphere's framing margin.
      if (count) target.lerp(selectedCenter.multiplyScalar(1 / count), 0.08);
    }
    const direction = camera.position.clone().sub(orbit.target).normalize();
    const position = direction.multiplyScalar(frame.distance).add(target);
    if (reducedMotion) {
      orbit.target.copy(target);
      camera.position.copy(position);
      orbit.update();
      transition.current = null;
    } else {
      transition.current = { target, position };
    }
    invalidate();
  }, [selectedIndex, model, reducedMotion, camera, invalidate, frame]);

  useEffect(() => {
    const orbit = controls.current;
    if (!orbit || action.serial === 0) return;
    transition.current = null;
    if (action.kind === "reset") {
      orbit.target.copy(frame.center);
      camera.position.copy(frame.center).addScaledVector(HOME_DIRECTION, frame.distance);
    } else if (action.kind === "left" || action.kind === "right") {
      orbit.rotateLeft(action.kind === "left" ? Math.PI / 8 : -Math.PI / 8);
    } else {
      const offset = camera.position.clone().sub(orbit.target);
      offset.setLength(Math.max(frame.minDistance, Math.min(frame.maxDistance, offset.length() * (action.kind === "closer" ? 0.85 : 1.18))));
      camera.position.copy(orbit.target).add(offset);
    }
    orbit.update();
    invalidate();
  }, [action, camera, invalidate, frame]);

  useFrame((_, delta) => {
    if (!didRender.current) { didRender.current = true; onReady(); }
    const goal = transition.current;
    const orbit = controls.current;
    if (!goal || !orbit) return;
    const amount = 1 - Math.exp(-Math.min(delta, 0.05) * 9);
    orbit.target.lerp(goal.target, amount);
    camera.position.lerp(goal.position, amount);
    if (camera.position.distanceTo(goal.position) < 0.003 && orbit.target.distanceTo(goal.target) < 0.003) {
      camera.position.copy(goal.position);
      orbit.target.copy(goal.target);
      transition.current = null;
    }
    orbit.update();
    if (transition.current) invalidate();
  });
  return null;
}

function Forms({ model, selectedIndex }: CanvasProps) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    const palette = ["#e8d7b2", "#bcd5e6", "#e2bca8", "#e9cf96"].map((hex) => new Color(hex));
    for (const geometry of [model.geometry, model.lineGeometry]) {
      const attribution = geometry.getAttribute("sourceIndex");
      let colors = geometry.getAttribute("color");
      if (!colors) {
        colors = new Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 3), 3);
        geometry.setAttribute("color", colors);
      }
      for (let index = 0; index < colors.count; index++) {
        const source = attribution.getX(index);
        const color = palette[source] ?? palette[0]!;
        const emphasis = selectedIndex < 0 || source === selectedIndex ? 1 : 0.22;
        colors.setXYZ(index, color.r * emphasis, color.g * emphasis, color.b * emphasis);
      }
      colors.needsUpdate = true;
    }
    invalidate();
  }, [model, selectedIndex, invalidate]);
  useEffect(() => {
    gl.domElement.style.cursor = "grab";
    return () => { gl.domElement.style.cursor = ""; };
  }, [gl]);
  return <>
    <lineSegments geometry={model.lineGeometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.48} depthWrite={false} />
    </lineSegments>
    <points geometry={model.geometry}>
      <shaderMaterial vertexColors transparent depthWrite={false} blending={AdditiveBlending}
        uniforms={{ pixelRatio: { value: gl.getPixelRatio() } }} vertexShader={starVertex} fragmentShader={starFragment} />
    </points>
  </>;
}

function GraphicsUnavailable({ onUnavailable }: { onUnavailable: () => void }) {
  useEffect(onUnavailable, [onUnavailable]);
  return <p className="portrait-graphics-message" role="status">3D is unavailable. You can still select and read every chapter.</p>;
}

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function scene(props: CanvasProps, onFailure: () => void, controlsCleanup: ControlsCleanup) {
  return (
    <SceneBoundary onFailure={onFailure}>
      <Forms {...props} />
      <CameraRig {...props} controlsCleanup={controlsCleanup} />
    </SceneBoundary>
  );
}

function SculptureCanvas(props: CanvasProps) {
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<ReconcilerRoot<HTMLCanvasElement> | null>(null);
  const controlsCleanup = useRef<(() => void) | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const onFailure = useCallback(() => { controlsCleanup.current?.(); setFailed(true); }, []);

  // OrbitControls removes a document listener through canvas.getRootNode().
  // Dispose before React detaches the host; Fiber's own unmount is asynchronous.
  useLayoutEffect(() => () => controlsCleanup.current?.(), []);

  useEffect(() => {
    const container = host.current;
    if (!container || failed) return;
    // Own initialization so asynchronous WebGL failures reach the reading fallback.
    // A fresh canvas also isolates StrictMode and document-replacement cleanup.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Rotatable constellation of the Pattern chapters. Use the chapter buttons for keyboard access.");
    container.append(canvas);
    const renderer = createRoot(canvas);
    let disposed = false;
    let store: RootStore | undefined;
    let gesture: { id: number; x: number; y: number; scrollX: number; scrollY: number; coarse: boolean; dragged: boolean } | null = null;
    const cancelGesture = () => { gesture = null; };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false) { cancelGesture(); return; }
      gesture = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        scrollX: window.scrollX, scrollY: window.scrollY, dragged: false,
        coarse: event.pointerType === "touch" || event.pointerType === "pen"
          || (!event.pointerType && (window.matchMedia?.("(pointer: coarse)").matches ?? false)),
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (gesture?.id === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.dragged = true;
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = gesture;
      cancelGesture();
      if (disposed || !store || !start || event.pointerId !== start.id || start.dragged
        || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
        || Math.abs(window.scrollX - start.scrollX) > 1 || Math.abs(window.scrollY - start.scrollY) > 1) return;
      const bounds = canvas.getBoundingClientRect();
      const geometry = latest.current.model.geometry;
      const star = closestSculptureStar(geometry, store.getState().camera, {
        width: bounds.width, height: bounds.height,
        x: event.clientX - bounds.left, y: event.clientY - bounds.top,
        tolerance: start.coarse ? 20 : 8,
      });
      if (star !== null) latest.current.onSelect(geometry.getAttribute("sourceIndex").getX(star));
    };
    // Observe taps without preventing OrbitControls rotation or native pan-y scrolling.
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", cancelGesture);
    canvas.addEventListener("contextmenu", cancelGesture);
    const resize = () => {
      const bounds = container.getBoundingClientRect();
      const state = store?.getState();
      state?.setSize(bounds.width, bounds.height, bounds.top, bounds.left);
      if (state?.camera instanceof PerspectiveCamera && bounds.width > 0 && bounds.height > 0) {
        // Frame the whole graph against the shorter dimension, including a
        // narrow phone held vertically. Rotation must not hide its extremities.
        state.camera.aspect = bounds.width / bounds.height;
        state.camera.fov = 2 * Math.atan(Math.tan(SHORT_AXIS_FOV * Math.PI / 360) / Math.min(1, state.camera.aspect)) * 180 / Math.PI;
        state.camera.updateProjectionMatrix();
        state.invalidate();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const onLost = (event: Event) => { event.preventDefault(); if (!disposed) onFailure(); };
    canvas.addEventListener("webglcontextlost", onLost);
    const initialize = async () => {
      try {
        const bounds = container.getBoundingClientRect();
        const frame = sculptureCameraFrame(latest.current.model.geometry);
        await renderer.configure({
          events, frameloop: "demand", dpr: [1, 1.5],
          size: { width: bounds.width, height: bounds.height, top: bounds.top, left: bounds.left },
          camera: { position: frame.center.clone().addScaledVector(HOME_DIRECTION, frame.distance), fov: SHORT_AXIS_FOV, near: 0.1, far: 40 },
          gl: { alpha: true, antialias: true, powerPreference: "low-power" },
        });
        if (disposed) { renderer.unmount(); return; }
        root.current = renderer;
        store = renderer.render(scene(latest.current, onFailure, controlsCleanup));
        resize();
      } catch {
        if (!disposed) onFailure();
      }
    };
    void initialize();
    return () => {
      disposed = true;
      root.current = null;
      observer.disconnect();
      cancelGesture();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", cancelGesture);
      canvas.removeEventListener("contextmenu", cancelGesture);
      canvas.removeEventListener("webglcontextlost", onLost);
      renderer.unmount();
      canvas.remove();
    };
  }, [failed, onFailure]);

  useEffect(() => { root.current?.render(scene(props, onFailure, controlsCleanup)); }, [props, onFailure]);
  return failed
    ? <GraphicsUnavailable onUnavailable={props.onUnavailable} />
    : <div className="portrait-canvas" ref={host} />;
}

/** Geometry receives image pixels and an explicit Sun sign; never reading metadata. */
export default function PatternSculpture(props: SculptureProps) {
  const sculptureKey = JSON.stringify([props.imageUrls, props.sunSign]);
  const [loaded, setLoaded] = useState<{ key: string; model: SculptureModel } | null>(null);
  const model = loaded?.key === sculptureKey ? loaded.model : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let owned: SculptureModel | null = null;
    setLoaded(null);
    setFailed(false);
    void loadPortraitImages(props.imageUrls, controller.signal).then((images) => {
      if (controller.signal.aborted) return;
      owned = createImageSculpture(images, props.sunSign);
      setLoaded({ key: sculptureKey, model: owned });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); owned?.geometry.dispose(); owned?.lineGeometry.dispose(); };
  }, [sculptureKey]);
  useEffect(() => { if (failed) props.onUnavailable(); }, [failed, props.onUnavailable]);
  if (failed) return <p className="portrait-graphics-message" role="status">The constellation could not be drawn from the four images. You can still read every chapter.</p>;
  return model ? <SculptureCanvas {...props} model={model} /> : <p className="portrait-graphics-message" role="status">Tracing the four chapter images…</p>;
}
