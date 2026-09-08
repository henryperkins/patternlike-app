import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ZODIAC_SIGNS } from "@patternlike/shared";
import {
  ACESFilmicToneMapping, Box3, Color, DirectionalLight, Fog, Group, HemisphereLight, LoadingManager, Matrix4, Mesh,
  MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator,
  Raycaster, RingGeometry, Scene, Spherical, TOUCH, Vector2, Vector3, WebGLRenderer,
  type Object3D, type WebGLRenderTarget,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { adaptCameraBookmark, cameraFrame, chapterLayout, disposeModel, firstVisibleIntersection, isCameraBookmark, MAX_GLB_BYTES, placeLabel, TapTracker, type LabelRect, verifyGlbAsset } from "./scene-utils.js";
import { facets, type CameraBookmark, type PortraitSceneProps, type SceneStatus } from "./types.js";
import { comparisonPosition, createObservatory, createReadingFolio, DISPLAY_HEIGHT, observatoryFrame, stationPosition, type ObservatoryWorld } from "./observatory-world.js";
import { BodyIcon, signLabel, skyBodyLabels } from "./SkyReader.js";
import type { PortraitSkyBody } from "../../lib/portrait-sky.js";

type LoadedForm = { id: string; root: Group; resources: Object3D[]; };
type Motion = { start: number; duration: number; from: CameraBookmark; to: CameraBookmark; positions: Vector3[]; goals: Vector3[]; };

function sceneDescription(props: PortraitSceneProps): string {
  if (!props.skyView && props.selectedIds.length === 2) {
    const names = props.selectedIds.map(id => props.chapters.find(chapter => chapter.id === id)?.title).filter(Boolean);
    return `Two saved chapter objects: ${names.join(" and ")}. Use their named source-passage links and scene controls to explore.`;
  }
  return props.experience ? `A zodiac observatory with a bronze twelve-sign instrument${props.sky?.placements.length ? ", birth-chart markers" : ""}, ${props.chapters.length} chapter displays, and opening reading desks. Use the named sky, chapter, and scene controls to explore.`
    : "Four sculptural chapter objects. Use the named chapter buttons and 3D controls to explore.";
}

async function loadForm(asset: PortraitSceneProps["assets"][number], signal: AbortSignal): Promise<LoadedForm> {
  const response = await fetch(asset.url, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error("Model delivery failed");
  if (Number(response.headers.get("content-length")) > MAX_GLB_BYTES) throw new Error("Model size exceeded");
  // Bound the response while reading, including a response without Content-Length.
  const reader = response.body?.getReader();
  let bytes: ArrayBuffer;
  if (reader) {
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (signal.aborted || length > MAX_GLB_BYTES) throw new Error("Model size or lifetime exceeded");
        chunks.push(next.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    bytes = joined.buffer;
  } else bytes = await response.arrayBuffer();
  if (signal.aborted) throw new Error("Model loading cancelled");
  await verifyGlbAsset(bytes, asset.sha256, asset.chapterId, asset);
  if (signal.aborted) throw new Error("Model loading cancelled");
  const manager = new LoadingManager();
  // Embedded image bufferViews become blob URLs inside GLTFLoader.
  manager.setURLModifier(url => {
    if (!url.startsWith("blob:")) throw new Error("Unexpected model resource");
    return url;
  });
  const model: GLTF = await new GLTFLoader(manager).parseAsync(bytes, "");
  const resources = model.scenes;
  try {
    if (signal.aborted) throw new Error("Model loading cancelled");
    const bounds = new Box3().setFromObject(model.scene);
    const size = bounds.getSize(new Vector3());
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
      || Math.max(size.x, size.y, size.z) > 10 || Math.min(size.x, size.y, size.z) < 0.02) throw new Error("Invalid volumetric model bounds");
    const root = new Group();
    root.userData.chapterId = asset.chapterId;
    root.add(model.scene);
    root.traverse(object => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.userData.chapterId = asset.chapterId;
      }
    });
    return { id: asset.chapterId, root, resources };
  } catch (error) { disposeModel(resources); throw error; }
}

/** Owns GPU resources, gestures, and demand rendering; prose stays in the sibling DOM reader. */
class PortraitRuntime {
  private props: PortraitSceneProps;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(38, 1, 0.05, 150);
  private controls!: OrbitControls;
  private environment: WebGLRenderTarget | null = null;
  private observer?: ResizeObserver;
  private labelObserver?: ResizeObserver;
  private raycaster = new Raycaster();
  private taps = new TapTracker();
  private animation: number | null = null;
  private motion: Motion | null = null;
  private disposed = false;
  private ready = false;
  private width = 1;
  private height = 1;
  private usableHeight = 1;
  private topInset = 0;
  private bottomInset = 0;
  private visible = true;
  private hovered: string | null = null;
  private orbiting = false;
  private ground!: Mesh;
  private rings: Mesh[] = [];
  private elevations: number[] = [];
  private localBoxes: Box3[] = [];
  private stationBoxes: Box3[] = [];
  private materials = new Map<MeshStandardMaterial, { emissive: Color; intensity: number; }>();
  private keyLight!: DirectionalLight;
  private hemisphere!: HemisphereLight;
  private rimLight!: DirectionalLight;
  private world: ObservatoryWorld | null = null;
  private lastFrame = 0;

  constructor(private host: HTMLDivElement, private labels: HTMLDivElement, private forms: LoadedForm[], props: PortraitSceneProps, private fail: () => void, private reportStatus: (status: SceneStatus) => void) {
    this.props = props;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    try {
    const canvas = this.renderer.domElement;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", sceneDescription(props));
    canvas.style.cssText = "display:block;width:100%;height:100%;cursor:grab";
    this.host.append(canvas);
    this.renderer.setClearColor("#091b21");
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.hemisphere = new HemisphereLight("#d4e8e4", "#3e3021", 0.8);
    this.scene.add(this.hemisphere);
    this.keyLight = new DirectionalLight("#ffe6bd", 2.7);
    this.keyLight.position.set(-3, 7, 5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.left = -5;
    this.keyLight.shadow.camera.right = 5;
    this.keyLight.shadow.camera.top = 5;
    this.keyLight.shadow.camera.bottom = -5;
    this.keyLight.shadow.normalBias = 0.025;
    this.keyLight.shadow.bias = -0.00015;
    this.scene.add(this.keyLight);
    const rim = new DirectionalLight("#aecbd7", 1.5);
    rim.position.set(3, 5, -5);
    this.scene.add(rim);
    this.rimLight = rim;
    this.ground = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: "#030b0d", roughness: 1, metalness: 0 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.025;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    if (props.experience) {
      this.world = createObservatory(forms.length, props.sky?.placements ?? []);
      this.scene.add(this.world.root);
      this.stationBoxes = this.world.stations.map(station => new Box3().setFromObject(station).translate(station.position.clone().negate()));
      this.keyLight.shadow.mapSize.set(2048, 2048);
      this.keyLight.shadow.camera.left = -11;
      this.keyLight.shadow.camera.right = 11;
      this.keyLight.shadow.camera.top = 11;
      this.keyLight.shadow.camera.bottom = -11;
      this.keyLight.shadow.camera.updateProjectionMatrix();
      this.ground.position.y = -0.46;
    }
    for (const [index, form] of forms.entries()) {
      const box = new Box3().setFromObject(form.root);
      this.localBoxes.push(box.clone());
      this.elevations.push(-box.min.y + (this.world ? DISPLAY_HEIGHT : 0));
      form.root.position.fromArray(this.layout(index, props.unfolded));
      form.root.position.y = this.elevations[index]!;
      this.scene.add(form.root);
      form.root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof MeshStandardMaterial) this.materials.set(material, { emissive: material.emissive.clone(), intensity: material.emissiveIntensity });
        }
      });
      const ring = new Mesh(new RingGeometry(1.06, 1.075, 64), new MeshStandardMaterial({ color: "#e89775", emissive: "#df8064", emissiveIntensity: 0.25, roughness: 1 }));
      ring.rotation.x = -Math.PI / 2;
      this.rings.push(ring);
      this.scene.add(ring);
    }
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = false;
    this.controls.touches.TWO = TOUCH.DOLLY_ROTATE;
    this.controls.rotateSpeed = 0.65;
    this.controls.minDistance = 2;
    this.controls.maxDistance = this.world ? 90 : 35;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI * (this.world ? 0.48 : 0.56);
    this.controls.addEventListener("change", this.invalidate);
    this.controls.addEventListener("start", this.onOrbitStart);
    this.controls.addEventListener("end", this.onOrbitEnd);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    for (const toolbar of host.closest(".explorer-scene")?.querySelectorAll(".explorer-scene-top, .explorer-scene-toolbar") ?? []) this.observer.observe(toolbar);
    this.labelObserver = new ResizeObserver(this.invalidate);
    this.observeLabels();
    this.resize();
    this.applyQuality();
    this.applyExperience();
    this.world?.tick(1);
    this.forms.forEach((form, index) => {
      form.root.rotation.y = (props.experience?.turns[form.id] ?? 0) * Math.PI / 4;
      form.root.position.fromArray(this.layout(index, props.unfolded));
      form.root.position.y = this.elevations[index]!;
    });
    const pose = isCameraBookmark(props.bookmark) ? adaptCameraBookmark(props.bookmark, this.frameDistance()) : this.frame();
    this.applyPose(pose);
    this.updateEmphasis();
    this.invalidate();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private snapshot = (): CameraBookmark => ({ position: this.camera.position.toArray(), target: this.controls.target.toArray(), frameDistance: this.frameDistance() });
  private comparison = () => !this.props.skyView && this.props.selectedIds.length === 2;
  private selectedIndices = () => this.props.selectedIds.flatMap(id => {
    const index = this.forms.findIndex(form => form.id === id);
    return index < 0 ? [] : [index];
  });
  private layout = (index: number, unfolded: boolean) => this.comparison() && this.props.selectedIds.includes(this.forms[index].id)
    ? comparisonPosition(index, this.selectedIndices(), this.localBoxes.map((box, i) => box.clone().applyMatrix4(new Matrix4().makeRotationY((this.props.experience?.turns[this.forms[i].id] ?? 0) * Math.PI / 4))))
    : this.world ? stationPosition(index, unfolded, this.forms.length) : chapterLayout(index, unfolded);
  private save = () => { if (this.ready) this.props.onBookmark(this.props.viewKey, this.snapshot()); };
  private bounds = (unfolded = this.props.unfolded) => this.localBoxes.map((box, index) => {
    const position = new Vector3().fromArray(this.layout(index, unfolded));
    position.y = this.elevations[index]!;
    const rotation = (this.props.experience?.turns[this.forms[index].id] ?? 0) * Math.PI / 4;
    return box.clone().applyMatrix4(new Matrix4().makeRotationY(rotation)).translate(position);
  });
  private frame = () => {
    if (this.world && this.props.skyView) {
      const aspect = this.width / this.usableHeight;
      const distance = 1.75 / Math.tan(38 * Math.PI / 360) / Math.min(1, aspect);
      const target = new Vector3(0, 0.9, 0);
      return { position: target.clone().addScaledVector(new Vector3(0, 0.999, 0.045).normalize(), distance).toArray(), target: target.toArray() };
    }
    const selected = this.forms.flatMap((form, index) => this.props.selectedIds.includes(form.id) ? [index] : []);
    if (this.comparison()) {
      const boxes = this.bounds();
      const pair = selected.map(index => this.stationBoxes[index]
        ? boxes[index].union(this.stationBoxes[index].clone().translate(new Vector3(...this.layout(index, this.props.unfolded)))) : boxes[index]);
      return cameraFrame(pair, [], this.width / this.usableHeight, new Vector3(0, 0.85, 1).normalize());
    }
    return this.world ? observatoryFrame(this.bounds(), selected, this.width / this.usableHeight, Boolean(this.props.experience?.inspect))
      : cameraFrame(this.bounds(), selected, this.width / this.usableHeight);
  };
  private frameDistance = () => {
    const frame = this.frame();
    return new Vector3(...frame.position).distanceTo(new Vector3(...frame.target));
  };
  private applyPose = (pose: CameraBookmark) => {
    this.camera.position.fromArray(pose.position);
    this.controls.target.fromArray(pose.target);
    this.controls.update();
  };

  private applyQuality() {
    const low = this.props.quality === "low";
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.6));
    this.renderer.shadowMap.enabled = !low;
    this.renderer.shadowMap.needsUpdate = true;
    this.controls.enableZoom = this.props.expanded;
    this.renderer.domElement.style.touchAction = this.props.expanded ? "none" : "pan-y";
    if (!low && !this.environment) {
      const generator = new PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      try { this.environment = generator.fromScene(room, 0.04); }
      finally { room.dispose(); generator.dispose(); }
    }
    this.scene.environment = low ? null : this.environment?.texture ?? null;
    this.scene.environmentIntensity = 0.42;
    this.renderer.setSize(this.width, this.height, false);
  }

  private applyExperience() {
    const experience = this.props.experience;
    if (!this.world || !experience) return;
    this.world.setState({ ...experience, open: this.forms.map(form => Boolean(experience.openDesks[form.id])), unfolded: this.props.unfolded,
      comparison: this.comparison() ? { indices: this.selectedIndices(), positions: this.forms.map((_, index) => this.layout(index, this.props.unfolded)) } : undefined });
    this.world.instrument.setSelection(this.props.selectedSkyBody ?? null, this.props.sky ? null : this.props.sunSign);
    this.world.instrument.setFocused(Boolean(this.props.skyView));
    const dusk = experience.lighting === "dusk";
    const sky = dusk ? "#233d40" : "#536a60";
    this.renderer.setClearColor(sky);
    this.scene.fog = new Fog(sky, dusk ? 20 : 30, 75);
    this.renderer.toneMappingExposure = dusk ? 1.05 : 1.1;
    this.scene.environmentIntensity = dusk ? 0.1 : 0.35;
    this.keyLight.color.set(dusk ? "#ffc991" : "#ffead0");
    this.keyLight.intensity = dusk ? 0.6 : 3.2;
    this.keyLight.position.set(-6, dusk ? 5 : 10, 8);
    this.hemisphere.intensity = dusk ? 0.5 : 1.35;
    this.hemisphere.color.set(dusk ? "#adc7da" : "#d9e8e3");
    this.rimLight.intensity = dusk ? 0.35 : 1.1;
    const ground = this.ground.material as MeshStandardMaterial;
    ground.color.set("#3b4839");
    if (this.props.reducedMotion) this.world.tick(1);
  }

  update(props: PortraitSceneProps) {
    const before = this.props;
    const turned = before.viewKey === props.viewKey && !props.skyView && props.selectedIds.length === 1
      && props.selectedIds.some(id => (before.experience?.turns[id] ?? 0) !== (props.experience?.turns[id] ?? 0));
    const previousBounds = turned ? this.selectedIndices().map(index => this.bounds()[index]) : null;
    if (before.viewKey !== props.viewKey) this.save();
    this.props = props;
    this.renderer.domElement.setAttribute("aria-label", sceneDescription(props));
    if (before.quality !== props.quality || before.expanded !== props.expanded) this.applyQuality();
    this.applyExperience();
    if (before.viewKey !== props.viewKey || before.unfolded !== props.unfolded) {
      this.moveTo(isCameraBookmark(props.bookmark) && before.viewKey !== props.viewKey ? adaptCameraBookmark(props.bookmark, this.frameDistance()) : this.frame(), before.unfolded !== props.unfolded ? 540 : 420);
    } else if (previousBounds) {
      this.frameTurn(previousBounds);
    }
    if (before.command.serial !== props.command.serial) this.command(before.unfolded !== props.unfolded ? 540 : 420);
    if (props.reducedMotion && this.motion) {
      this.forms.forEach((form, index) => form.root.position.copy(this.motion!.goals[index]!));
      this.applyPose(this.motion.to);
      this.motion = null;
      this.save();
    }
    this.updateEmphasis();
    this.observeLabels();
    this.invalidate();
  }

  private observeLabels() {
    // Text zoom and wrapping can change a label without resizing the canvas.
    // Reproject it without reframing the reader's camera.
    this.labelObserver?.disconnect();
    for (const label of this.labels.querySelectorAll("[data-form-index], [data-sign-index], [data-sky-body]")) this.labelObserver?.observe(label);
  }

  private moveTo(pose: CameraBookmark, duration: number) {
    const goals = this.forms.map((_, index) => {
      const goal = new Vector3().fromArray(this.layout(index, this.props.unfolded));
      goal.y = this.elevations[index]!;
      return goal;
    });
    if (this.props.reducedMotion) {
      this.forms.forEach((form, index) => form.root.position.copy(goals[index]!));
      this.applyPose(pose);
      this.motion = null;
      this.save();
    } else this.motion = { start: performance.now(), duration, from: this.snapshot(), to: pose, positions: this.forms.map(form => form.root.position.clone()), goals };
    this.invalidate();
  }

  private fitsView(boxes: readonly Box3[]) {
    return boxes.every(box => {
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const point = new Vector3(x, y, z).project(this.camera);
        const screenY = (1 - point.y) * this.height / 2;
        if (Math.abs(point.x) > 0.98 || point.z < -1 || point.z > 1 || screenY < this.topInset + 2 || screenY > this.height - this.bottomInset - 2) return false;
      }
      return true;
    });
  }

  private frameTurn(previousBounds: readonly Box3[]) {
    // Correct clipping introduced by the turn, while preserving an already
    // cropped view chosen through the camera controls.
    if (!this.fitsView(previousBounds)) return;
    const boxes = this.bounds();
    const selected = this.selectedIndices().map(index => boxes[index]);
    if (this.fitsView(selected)) return;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const pose = cameraFrame(selected, [], this.width / this.usableHeight, direction);
    const target = new Vector3(...pose.target);
    const distance = Math.max(this.camera.position.distanceTo(this.controls.target),
      new Vector3(...pose.position).distanceTo(target) * (this.props.experience?.inspect ? 1 : 1.2));
    this.moveTo({ position: target.clone().addScaledVector(direction, distance).toArray(), target: target.toArray() }, 260);
  }

  private command(frameDuration = 420) {
    const kind = this.props.command.kind;
    if (kind === "reset" || kind === "frame") { this.moveTo(this.frame(), frameDuration); return; }
    this.stopMotion();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new Spherical().setFromVector3(offset);
    if (kind === "left" || kind === "right") spherical.theta += kind === "left" ? -Math.PI / 8 : Math.PI / 8;
    if (kind === "up" || kind === "down") spherical.phi = Math.max(this.controls.minPolarAngle, Math.min(this.controls.maxPolarAngle, spherical.phi + (kind === "up" ? -Math.PI / 12 : Math.PI / 12)));
    if (kind === "closer" || kind === "farther") spherical.radius = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, spherical.radius * (kind === "closer" ? 0.84 : 1.19)));
    const pose = { position: this.controls.target.clone().add(new Vector3().setFromSpherical(spherical)).toArray(), target: this.controls.target.toArray() };
    this.moveTo(pose, 260);
  }

  private stopMotion() {
    // Direct input interrupts camera motion; assembly finishes at its stable destination.
    if (this.motion) this.forms.forEach((form, index) => form.root.position.copy(this.motion!.goals[index]!));
    this.motion = null;
  }
  private onOrbitStart = () => { this.stopMotion(); this.orbiting = true; this.renderer.domElement.style.cursor = "grabbing"; };
  private onOrbitEnd = () => { this.orbiting = false; this.renderer.domElement.style.cursor = this.hovered ? "pointer" : "grab"; this.save(); };
  private onPointerDown = (event: PointerEvent) => this.taps.down(event, window.scrollX, window.scrollY);
  private onPointerMove = (event: PointerEvent) => {
    this.taps.move(event);
    if (event.buttons === 0 && event.pointerType !== "touch") this.highlight(this.pick(event));
  };
  private onPointerUp = (event: PointerEvent) => {
    if (event.pointerType !== "touch") this.highlight(this.pick(event));
    if (!this.taps.up(event, window.scrollX, window.scrollY)) return;
    const id = this.pick(event);
    if (id?.startsWith("sky:")) this.props.onSelectSkyBody?.(id.slice(4) as PortraitSkyBody);
    else if (id && !this.props.skyView && this.props.selectedIds.length === 1 && this.props.selectedIds[0] === id && this.props.onOperate) this.props.onOperate(id);
    else if (id) this.props.onSelect(id);
  };
  private onPointerCancel = () => { this.taps.cancel(); this.highlight(null); };
  private onPointerLeave = () => this.highlight(null);
  private onContextLost = (event: Event) => { event.preventDefault(); this.dispose(); this.fail(); };
  private onVisibility = () => {
    if (document.hidden) {
      if (this.animation !== null) cancelAnimationFrame(this.animation);
      this.animation = null;
      this.save();
    } else this.invalidate();
  };

  private visibleHit = () => firstVisibleIntersection(this.raycaster, [...this.forms.map(form => form.root), ...(this.world ? [this.world.root] : [])]);

  private pick(event: PointerEvent): string | null {
    const box = this.renderer.domElement.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    this.raycaster.setFromCamera(new Vector2((event.clientX - box.left) / box.width * 2 - 1, -(event.clientY - box.top) / box.height * 2 + 1), this.camera);
    const data = this.visibleHit()?.object.userData;
    return data?.skyBody ? `sky:${data.skyBody}` : data?.chapterId ?? null;
  }
  highlight(id: string | null) {
    if (!this.orbiting) this.renderer.domElement.style.cursor = id ? "pointer" : "grab";
    if (this.hovered === id) return;
    this.hovered = id;
    this.updateEmphasis();
    this.invalidate();
  }
  private updateEmphasis() {
    this.forms.forEach((form, index) => {
      const selected = !this.props.skyView && this.props.selectedIds.includes(form.id);
      form.root.visible = !this.comparison() || selected;
      const highlighted = this.hovered === form.id;
      this.rings[index]!.visible = form.root.visible && (selected || highlighted);
      form.root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof MeshStandardMaterial)) continue;
          const base = this.materials.get(material)!;
          material.emissive.copy(base.emissive);
          material.emissiveIntensity = base.intensity;
          if (selected || highlighted) { material.emissive.set("#735442"); material.emissiveIntensity = highlighted ? 0.16 : 0.075; }
        }
      });
    });
  }

  private resize = () => {
    const bounds = this.host.getBoundingClientRect();
    this.visible = bounds.width > 0 && bounds.height > 0;
    if (!this.visible) return;
    const before = this.ready ? this.snapshot() : null;
    this.width = Math.max(1, bounds.width);
    this.height = Math.max(1, bounds.height);
    const parent = this.host.closest(".explorer-scene");
    const top = parent?.querySelector(".explorer-scene-top")?.getBoundingClientRect();
    const bottom = parent?.querySelector(".explorer-scene-toolbar")?.getBoundingClientRect();
    this.topInset = top ? Math.max(0, Math.min(this.height * 0.33, top.bottom - bounds.top + 8)) : 0;
    this.bottomInset = bottom ? Math.max(0, Math.min(this.height * 0.4, bounds.bottom - bottom.top + 8)) : 0;
    this.usableHeight = Math.max(60, this.height - this.topInset - this.bottomInset);
    // Extend the viewport around its unobscured center instead of drawing objects behind controls.
    this.camera.setViewOffset(this.width, this.usableHeight, 0, -this.topInset, this.width, this.height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    if (before) {
      const distance = this.frameDistance();
      this.applyPose(adaptCameraBookmark(before, distance));
      if (this.motion) {
        // Both animation endpoints share the old viewport, even if the destination has not been saved yet.
        this.motion.from = adaptCameraBookmark({ ...this.motion.from, frameDistance: before.frameDistance }, distance);
        this.motion.to = adaptCameraBookmark({ ...this.motion.to, frameDistance: before.frameDistance }, distance);
      }
      this.save();
    }
    this.invalidate();
  };

  private projectLabels() {
    this.projectSkyLabels();
    const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
    const objectRects: LabelRect[] = this.comparison() ? this.forms.filter(form => form.root.visible).map(form => {
      const box = new Box3().setFromObject(form.root);
      const min = new Vector2(Infinity, Infinity), max = new Vector2(-Infinity, -Infinity);
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const point = new Vector3(x, y, z).project(this.camera);
        const screen = new Vector2((point.x + 1) * this.width / 2, (1 - point.y) * this.height / 2);
        min.min(screen); max.max(screen);
      }
      return { x: min.x - 6, y: min.y - 6, width: max.x - min.x + 12, height: max.y - min.y + 12 };
    }) : [];
    // The selected annotation gets first claim on space. Occluded labels remain in the native chapter rail.
    const ordered = this.forms.map((form, index) => ({ form, index })).sort((a, b) => Number(this.props.selectedIds.includes(b.form.id)) - Number(this.props.selectedIds.includes(a.form.id)));
    for (const { form, index } of ordered) {
      const label = this.labels.querySelector<HTMLButtonElement>(`[data-form-index="${index}"]`);
      if (!label) continue;
      if (this.props.skyView) { label.style.visibility = "hidden"; continue; }
      label.dataset.highlighted = String(this.hovered === form.id);
      const box = new Box3().setFromObject(form.root);
      const anchor = box.getCenter(new Vector3());
      anchor.y = box.max.y + 0.12;
      const projected = anchor.clone().project(this.camera);
      let visible = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
      const compact = this.width < 520 && this.height < 420 && !this.props.selectedIds.includes(form.id);
      label.dataset.compact = String(compact);
      this.raycaster.set(this.camera.position, anchor.clone().sub(this.camera.position).normalize());
      const hit = this.visibleHit();
      if (hit && hit.distance < this.camera.position.distanceTo(anchor) - 0.1 && hit.object.userData.chapterId !== form.id) visible = false;
      const width = label.offsetWidth || (compact ? 44 : 110);
      const height = label.offsetHeight || 44;
      let x = Math.max(8, Math.min(this.width - width - 8, (projected.x + 1) * this.width / 2 - width / 2));
      let y = Math.max(this.topInset + 4, Math.min(this.height - this.bottomInset - height - 4, (1 - projected.y) * this.height / 2 - height));
      let unplaceable = false;
      if ((compact || this.comparison()) && visible) {
        const placed = placeLabel({ x, y, width, height }, {
          x: 8, y: this.topInset + 4, width: this.width - 16, height: this.usableHeight - 8,
        }, [...objectRects, ...occupied.map(other => ({ x: other.x - 3, y: other.y - 3, width: other.width + 6, height: other.height + 6 }))]);
        if (placed) { x = placed.x; y = placed.y; } else { visible = false; unplaceable = true; }
      } else if (occupied.some(other => x < other.x + other.width + 8 && x + width + 8 > other.x && y < other.y + other.height + 8 && y + height + 8 > other.y)) visible = false;
      // Enlarged comparison labels can outgrow the canvas. Keep keyboard access
      // in their matching native link instead of forcing an obstructing overlay.
      if (document.activeElement === label) {
        const fallback = this.comparison() && unplaceable
          ? [...this.host.closest(".explorer-visual")?.querySelectorAll<HTMLButtonElement>(".explorer-compared-chapters button") ?? []].find(button => button.dataset.chapterId === form.id) : undefined;
        if (fallback) { fallback.focus({ preventScroll: true }); fallback.scrollIntoView({ behavior: "instant", block: "nearest" }); }
        else visible = true;
      }
      label.style.visibility = visible ? "visible" : "hidden";
      label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      if (visible) occupied.push({ x, y, width, height });
    }
  }

  private projectSkyLabels() {
    if (!this.world) return;
    const connector = this.labels.querySelector<SVGLineElement>("[data-sky-connector]");
    if (connector) connector.style.visibility = "hidden";
    const occupied: LabelRect[] = [];
    const place = (element: HTMLElement, anchor: Vector3, marker?: PortraitSkyBody) => {
      const projected = anchor.clone().project(this.camera);
      let visible = Boolean(this.props.skyView) && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
      this.raycaster.set(this.camera.position, anchor.clone().sub(this.camera.position).normalize());
      const hit = this.visibleHit();
      if (hit && hit.distance < this.camera.position.distanceTo(anchor) - 0.15 && (!marker || hit.object.userData.skyBody !== marker)) visible = false;
      const width = element.offsetWidth || (marker ? 65 : 44);
      const height = element.offsetHeight || (marker ? 44 : 20);
      const x = Math.max(6, Math.min(this.width - width - 6, (projected.x + 1) * this.width / 2 - width / 2));
      const y = Math.max(this.topInset + 2, Math.min(this.height - this.bottomInset - height - 2, (1 - projected.y) * this.height / 2 - height / 2));
      element.style.visibility = visible || (this.props.skyView && document.activeElement === element) ? "visible" : "hidden";
      element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      return { x: Math.round(x), y: Math.round(y), width, height, visible };
    };
    this.world.instrument.signAnchors.forEach((anchor, index) => {
      const label = this.labels.querySelector<HTMLElement>(`[data-sign-index="${index}"]`);
      if (label) {
        const box = place(label, this.world!.instrument.root.localToWorld(new Vector3(...anchor)));
        if (box.visible) occupied.push(box);
      }
    });
    for (const [body, marker] of this.world.instrument.markers) {
      const label = this.labels.querySelector<HTMLElement>(`[data-sky-body="${body}"]`);
      if (!label) continue;
      if (body === this.props.selectedSkyBody) {
        // The readout stays clear of crowded placements; a leader terminates at the actual chart marker.
        const markerAnchor = marker.getWorldPosition(new Vector3());
        const projected = markerAnchor.clone().project(this.camera);
        const readoutAnchor = marker.position.clone().setY(0).normalize().multiplyScalar(-0.55).setY(1.12);
        const readout = place(label, this.world.instrument.root.localToWorld(readoutAnchor), body);
        this.raycaster.set(this.camera.position, markerAnchor.clone().sub(this.camera.position).normalize());
        const hit = this.visibleHit();
        const visible = readout.visible && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1
          && (!hit || hit.distance >= this.camera.position.distanceTo(markerAnchor) - 0.15 || hit.object.userData.skyBody === body);
        // Reserve the projected marker's full bounds, not only its center point.
        const markerBox = new Box3().setFromObject(marker);
        const markerMin = new Vector2(Infinity, Infinity);
        const markerMax = new Vector2(-Infinity, -Infinity);
        for (const x of [markerBox.min.x, markerBox.max.x]) for (const y of [markerBox.min.y, markerBox.max.y]) for (const z of [markerBox.min.z, markerBox.max.z]) {
          const corner = new Vector3(x, y, z).project(this.camera);
          const point = new Vector2((corner.x + 1) * this.width / 2, (1 - corner.y) * this.height / 2);
          markerMin.min(point);
          markerMax.max(point);
        }
        const position = placeLabel(readout, { x: 6, y: this.topInset + 2, width: this.width - 12, height: this.usableHeight - 4 }, [
          ...occupied,
          { x: markerMin.x, y: markerMin.y, width: markerMax.x - markerMin.x, height: markerMax.y - markerMin.y },
        ]);
        // Extreme user zoom can leave no clear rectangle; the native placement strip still exposes the selection.
        if (!position) { label.style.visibility = "hidden"; continue; }
        label.style.transform = `translate(${position.x}px, ${position.y}px)`;
        if (connector && visible) {
          connector.setAttribute("x1", String(position.x + position.width / 2));
          connector.setAttribute("y1", String(position.y + position.height / 2));
          connector.setAttribute("x2", String((projected.x + 1) * this.width / 2));
          connector.setAttribute("y2", String((1 - projected.y) * this.height / 2));
          connector.style.visibility = "visible";
        }
      } else label.style.visibility = "hidden";
    }
  }

  private invalidate = () => {
    if (this.disposed || document.hidden || !this.visible || this.animation !== null) return;
    this.animation = requestAnimationFrame(this.draw);
  };
  private draw = (now: number) => {
    this.animation = null;
    if (this.disposed) return;
    try {
      const seconds = this.props.reducedMotion ? 1 : Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      let worldMoving = this.world?.tick(seconds) ?? false;
      this.forms.forEach(form => {
        const goal = (this.props.experience?.turns[form.id] ?? 0) * Math.PI / 4;
        form.root.rotation.y = seconds >= 1 || Math.abs(form.root.rotation.y - goal) < 0.001 ? goal
          : form.root.rotation.y + (goal - form.root.rotation.y) * (1 - Math.exp(-seconds * 10));
        worldMoving ||= form.root.rotation.y !== goal;
      });
      if (this.motion) {
        const amount = Math.min(1, Math.max(0, (now - this.motion.start) / this.motion.duration));
        const eased = amount * amount * (3 - 2 * amount);
        this.camera.position.lerpVectors(new Vector3().fromArray(this.motion.from.position), new Vector3().fromArray(this.motion.to.position), eased);
        this.controls.target.lerpVectors(new Vector3().fromArray(this.motion.from.target), new Vector3().fromArray(this.motion.to.target), eased);
        this.forms.forEach((form, index) => form.root.position.lerpVectors(this.motion!.positions[index]!, this.motion!.goals[index]!, eased));
        this.controls.update();
        if (amount === 1) { this.motion = null; this.save(); }
      }
      this.rings.forEach((ring, index) => {
        const position = this.forms[index]!.root.position;
        // The artifact owns the unfolding trajectory; its furniture follows it on every frame.
        this.world?.stations[index]?.position.set(position.x, 0, position.z);
        ring.position.set(position.x, this.world ? 0.56 : 0.005, position.z);
      });
      this.renderer.render(this.scene, this.camera);
      this.projectLabels();
      if (!this.ready) { this.ready = true; this.reportStatus("ready"); }
      if (this.motion || worldMoving) this.invalidate();
    } catch { this.dispose(); this.fail(); }
  };

  dispose = () => {
    if (this.disposed) return;
    this.save();
    this.disposed = true;
    if (this.animation !== null) cancelAnimationFrame(this.animation);
    this.observer?.disconnect();
    this.labelObserver?.disconnect();
    this.controls?.removeEventListener("change", this.invalidate);
    this.controls?.removeEventListener("start", this.onOrbitStart);
    this.controls?.removeEventListener("end", this.onOrbitEnd);
    this.controls?.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerCancel);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.taps.cancel();
    this.environment?.dispose();
    this.keyLight?.shadow.dispose();
    if (this.world) disposeModel([this.world.root]);
    disposeModel([...(this.ground ? [this.ground] : []), ...this.rings]);
    this.renderer.dispose();
    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    canvas.remove();
  };
}

export default function PortraitScene(props: PortraitSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const runtime = useRef<PortraitRuntime | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [status, setStatus] = useState<SceneStatus>("loading");
  const assetKey = JSON.stringify([props.chapters.map(chapter => chapter.id), props.assets.map(asset => [asset.chapterId, asset.url, asset.sha256, asset.sourceImageSha256, asset.provenance])]);

  useLayoutEffect(() => {
    runtime.current?.update(props);
  });
  // Controls must release document listeners and capture the camera before React detaches the canvas.
  useLayoutEffect(() => () => runtime.current?.dispose(), []);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    const owned: LoadedForm[] = [];
    setStatus("loading");
    latest.current.onStatus("loading");
    latest.current.onArtworkFallback?.(false);
    const failure = () => {
      if (stopped) return;
      controller.abort();
      runtime.current?.dispose();
      runtime.current = null;
      disposeModel(owned.splice(0).flatMap(form => form.resources));
      setStatus("unavailable");
      latest.current.onStatus("unavailable");
    };
    const initialize = async () => {
      try {
        const current = latest.current;
        if (!current.chapters.length) throw new Error("Missing chapters");
        let artworkFallback = false;
        const forms = await Promise.all(current.chapters.map(async chapter => {
          const asset = current.assets.find(asset => asset.chapterId === chapter.id);
          if (!asset && !current.experience) throw new Error("Missing chapter model");
          const folio = (): LoadedForm => {
            const root = createReadingFolio(chapter.id);
            return { id: chapter.id, root, resources: [root] };
          };
          let form: LoadedForm;
          try { form = asset ? await loadForm(asset, controller.signal) : folio(); }
          catch (cause) {
            if (stopped || controller.signal.aborted || !current.experience) throw cause;
            // Optional artwork must not take away a usable reading station.
            artworkFallback = true;
            form = folio();
          }
          if (stopped || controller.signal.aborted) { disposeModel(form.resources); throw new Error("Model loading cancelled"); }
          owned.push(form);
          return form;
        }));
        if (stopped || !host.current || !labels.current) return;
        latest.current.onArtworkFallback?.(artworkFallback);
        runtime.current = new PortraitRuntime(host.current, labels.current, forms, latest.current, failure,
          state => { if (!stopped) { setStatus(state); latest.current.onStatus(state); } });
      } catch {
        controller.abort();
        if (!stopped) failure();
      }
    };
    void initialize();
    return () => {
      stopped = true;
      controller.abort();
      runtime.current?.dispose();
      runtime.current = null;
      disposeModel(owned.flatMap(form => form.resources));
    };
  }, [assetKey]);

  const facet = facets.find(item => item.id === props.facet)!;
  return <div className="explorer-scene-renderer" style={{ position: "relative", width: "100%", height: "100%" }}>
    <div className="explorer-canvas-host" ref={host} style={{ position: "absolute", inset: 0 }} />
    <div className="explorer-labels" ref={labels} style={{ position: "absolute", inset: 0, pointerEvents: "none", visibility: status === "ready" ? "visible" : "hidden" }}>
      {props.experience && ZODIAC_SIGNS.map((sign, index) => <span key={sign} className="sky-sign-label" data-sign-index={index} aria-hidden="true" style={{ visibility: "hidden" }}>{signLabel(sign)}</span>)}
      <svg className="sky-marker-connector" aria-hidden="true"><line data-sky-connector style={{ visibility: "hidden" }} /></svg>
      {props.sky?.placements.map(placement => <button key={placement.body} type="button" className="sky-body-label" data-sky-body={placement.body} data-selected={props.selectedSkyBody === placement.body}
        aria-label={`${skyBodyLabels[placement.body]} in ${signLabel(placement.sign)}`} style={{ visibility: "hidden" }} onClick={() => props.onSelectSkyBody?.(placement.body)}><BodyIcon body={placement.body} />{skyBodyLabels[placement.body]}</button>)}
      {props.chapters.map((chapter, index) => {
        const selected = props.selectedIds.includes(chapter.id);
        const comparing = !props.skyView && props.selectedIds.length === 2;
        if (comparing && !selected) return null;
        const annotation = selected && (comparing || chapter.id === props.selectedIds[0]);
        const passage = props.activePassages[chapter.id] ?? 0;
        return <button key={chapter.id} type="button" data-form-index={index} data-chapter-id={chapter.id} data-selected={selected} data-active-passage={annotation ? passage : undefined}
          className={annotation ? "explorer-annotation" : "explorer-chapter-label"}
          style={{ position: "absolute", top: 0, left: 0, minWidth: 44, minHeight: 44, pointerEvents: "auto" }}
          aria-label={annotation ? `${facet.label}: show source passage ${passage + 1} for ${chapter.title}` : `Explore chapter ${chapter.ordinal}: ${chapter.title}`}
          aria-pressed={annotation ? undefined : selected}
          onFocus={() => runtime.current?.highlight(chapter.id)} onBlur={() => runtime.current?.highlight(null)}
          onPointerEnter={() => runtime.current?.highlight(chapter.id)} onPointerLeave={() => runtime.current?.highlight(null)}
          onClick={() => annotation ? props.onAnnotation(chapter.id) : props.onSelect(chapter.id)}>
          {annotation ? <>{comparing && <span className="explorer-label-title">{chapter.title}</span>}<span><span aria-hidden="true">●</span> {facet.label}<span className="explorer-passage-number"> · {passage + 1}</span></span></> : <><span className="explorer-label-ordinal"><span className="explorer-label-prefix">Chapter </span>{String(chapter.ordinal).padStart(2, "0")}</span><span className="explorer-label-title">{chapter.title}</span></>}
        </button>;
      })}
    </div>
  </div>;
}
