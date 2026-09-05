import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createRoot, events, extend, useFrame, useThree, type ReconcilerRoot, type RootStore } from "@react-three/fiber";
import { AmbientLight, DirectionalLight, Color, Float32BufferAttribute, Group, HemisphereLight, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createImageSculpture } from "../lib/image-sculpture.js";
import { loadPortraitImages } from "../lib/portrait-images.js";

export interface CameraAction {
  kind: "left" | "right" | "closer" | "farther" | "reset";
  serial: number;
}
interface SculptureProps {
  imageUrls: readonly string[];
  selectedIndex: number;
  onSelect: (index: number | null) => void;
  reducedMotion: boolean;
  action: CameraAction;
  onReady: () => void;
  onUnavailable: () => void;
}
type SculptureModel = ReturnType<typeof createImageSculpture>;
type CanvasProps = SculptureProps & { model: SculptureModel };
const HOME: [number, number, number] = [0, 0.3, 7.4];
extend({ AmbientLight, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial });

type ControlsCleanup = RefObject<(() => void) | null>;

function CameraRig({ selectedIndex, model, reducedMotion, action, onReady, controlsCleanup }: CanvasProps & { controlsCleanup: ControlsCleanup }) {
  const { camera, gl, invalidate } = useThree();
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
    orbit.minDistance = 4.6;
    orbit.maxDistance = 10;
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
  }, [camera, gl, invalidate, controlsCleanup]);

  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const target = new Vector3();
    if (selectedIndex >= 0) {
      const positions = model.geometry.getAttribute("position");
      const sources = model.geometry.getAttribute("sourceIndex");
      let count = 0;
      for (let i = 0; i < positions.count; i++) {
        if (sources?.getX(i) !== selectedIndex) continue;
        target.add(new Vector3().fromBufferAttribute(positions, i));
        count++;
      }
      if (count) target.multiplyScalar(0.18 / count);
    }
    const direction = camera.position.clone().sub(orbit.target).normalize();
    const position = direction.multiplyScalar(selectedIndex < 0 ? 7.4 : 7.2).add(target);
    if (reducedMotion) {
      orbit.target.copy(target);
      camera.position.copy(position);
      orbit.update();
      transition.current = null;
    } else {
      transition.current = { target, position };
    }
    invalidate();
  }, [selectedIndex, model, reducedMotion, camera, invalidate]);

  useEffect(() => {
    const orbit = controls.current;
    if (!orbit || action.serial === 0) return;
    transition.current = null;
    if (action.kind === "reset") {
      orbit.target.set(0, 0, 0);
      camera.position.set(...HOME);
    } else if (action.kind === "left" || action.kind === "right") {
      orbit.rotateLeft(action.kind === "left" ? Math.PI / 8 : -Math.PI / 8);
    } else {
      const offset = camera.position.clone().sub(orbit.target);
      offset.setLength(Math.max(4.6, Math.min(10, offset.length() * (action.kind === "closer" ? 0.85 : 1.18))));
      camera.position.copy(orbit.target).add(offset);
    }
    orbit.update();
    invalidate();
  }, [action, camera, invalidate]);

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

function Forms({ model, selectedIndex, onSelect }: CanvasProps) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    const attribution = model.geometry.getAttribute("sourceIndex");
    let colors = model.geometry.getAttribute("color");
    if (!colors) {
      colors = new Float32BufferAttribute(new Float32Array(model.geometry.getAttribute("position").count * 3), 3);
      model.geometry.setAttribute("color", colors);
    }
    const base = new Color(...model.color);
    const accent = new Color("#c76043");
    for (let index = 0; index < colors.count; index++) {
      const color = selectedIndex >= 0 && attribution?.getX(index) === selectedIndex ? base.clone().lerp(accent, 0.45) : base;
      colors.setXYZ(index, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    invalidate();
  }, [model, selectedIndex, invalidate]);
  useEffect(() => {
    gl.domElement.style.cursor = "grab";
    return () => { gl.domElement.style.cursor = ""; };
  }, [gl]);
  return <mesh geometry={model.geometry}
    onClick={(event) => {
      if (event.delta > 5 || !event.face) return;
      event.stopPropagation();
      const index = model.geometry.getAttribute("sourceIndex")?.getX(event.face.a);
      if (index !== undefined) onSelect(index);
    }}>
    <meshStandardMaterial vertexColors roughness={0.48} metalness={0.12} />
  </mesh>;
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
      <ambientLight intensity={0.8} />
      <hemisphereLight args={["#fff7e8", "#64765d", 2]} />
      <directionalLight position={[3, 6, 5]} intensity={3.4} color="#fff3dc" />
      <directionalLight position={[-4, -1, 2]} intensity={0.9} color="#d9e4db" />
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
    canvas.setAttribute("aria-label", "Rotatable sculpture of the Pattern chapters. Use the chapter buttons for keyboard access.");
    container.append(canvas);
    const renderer = createRoot(canvas);
    let disposed = false;
    let store: RootStore | undefined;
    const resize = () => {
      const bounds = container.getBoundingClientRect();
      store?.getState().setSize(bounds.width, bounds.height, bounds.top, bounds.left);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const onLost = (event: Event) => { event.preventDefault(); if (!disposed) onFailure(); };
    canvas.addEventListener("webglcontextlost", onLost);
    const initialize = async () => {
      try {
        const bounds = container.getBoundingClientRect();
        await renderer.configure({
          events, frameloop: "demand", dpr: [1, 1.5],
          size: { width: bounds.width, height: bounds.height, top: bounds.top, left: bounds.left },
          camera: { position: HOME, fov: 39, near: 0.1, far: 40 },
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

/** Geometry receives pixels only. Reading metadata never crosses this boundary. */
export default function PatternSculpture(props: SculptureProps) {
  const imageKey = JSON.stringify(props.imageUrls);
  const [loaded, setLoaded] = useState<{ key: string; model: SculptureModel } | null>(null);
  const model = loaded?.key === imageKey ? loaded.model : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let owned: SculptureModel | null = null;
    setLoaded(null);
    setFailed(false);
    void loadPortraitImages(props.imageUrls, controller.signal).then((images) => {
      if (controller.signal.aborted) return;
      owned = createImageSculpture(images);
      setLoaded({ key: imageKey, model: owned });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); owned?.geometry.dispose(); };
  }, [imageKey]);
  useEffect(() => { if (failed) props.onUnavailable(); }, [failed, props.onUnavailable]);
  if (failed) return <p className="portrait-graphics-message" role="status">The four images could not be shaped into a sculpture. You can still read every chapter.</p>;
  return model ? <SculptureCanvas {...props} model={model} /> : <p className="portrait-graphics-message" role="status">Shaping the four chapter images…</p>;
}
