# Task 2 feedback implementation

Base: `codex/portrait-observatory` at `2e7dab059643f382b040d305170475a7e46eef3d`.
Production source and focused tests are frozen for root's detached build/browser pass. No commits, pushes, installs, services, .impeccable files or output files were changed by this implementation agent.

## Diagnosis and corrections

1. Raw camera bookmarks lacked the fitted distance for their viewport, and resize updated only the projection. Bookmarks now store the fitted distance; remount, return to an existing view, resize and animation endpoints scale camera offsets relative to that distance while retaining target, orientation and relative user zoom. A short expanded viewport uses the full available height for the canvas beside a scrollable 238px support column; an accessible Scene options disclosure collapses atmosphere and other secondary controls. Chapter/placement navigation, chapter reading, close and retry remain reachable.
2. The fixed three-column strip retained a side-by-side icon and text arrangement below its content width. A placement-strip container query stacks its icons above complete text at narrow widths, with 66px minimum button targets; unavailable qualifications wrap within their own cell.
3. The selected body name used an unrelated center anchor. The native readout now has a leader ending at the real projected marker, stays away from that marker, and shares a ring-and-center Sun, neutral pearl Moon and faceted diamond Rising key with the controls. Saved-sign-only views still create no invented longitude or marker; unavailable/missing placements remain honest.
4. Phone entry now includes a concise invitation and an active named first-chapter action before the canvas. Read chapter selects the first chapter on initial use and retains an existing chapter/facet thereafter. Reading from the expanded scene exits that overlay and moves focus to the reading instead of restoring focus to the old expansion opener.
5. Unavailable graphics remove active rotation/desk/sky-ring instructions and offer Continue reading beside Try 3D again. Reading and retry retain chapter, facet, lighting and desk state. Sky-reader bridge headings now follow their parent heading level; touched 9–11px helper labels are raised to 12px.

## Verification

Only portrait-related tests and the portrait build were run. No aggregate suite, API, calculation, signer, contracts, runner or content-generation tests were invoked.

Meaningful new regressions cover preserved orbit/relative zoom, all twelve zodiac labels after expansion and resize reversal, leader coordinates at the actual plotted marker, immediate initial reading, graphics-loss reading/retry context, and the short-height disclosure plus expanded-to-reading focus handoff. Existing portrait lifecycle, idle rendering, reduced motion, source text, uncertainty, reading restoration, navigation and resource checks remain in the final explicit lane.

Red evidence: the initial new runtime expansion test showed only 6 of 12 labels after remount; the new reading/invitation and graphics-guidance checks failed before their changes; the new adaptation helper was absent. A subsequent intermediate run caught the changed normal expanded tab order (restored). The new short-height test initially assumed jsdom provided matchMedia; its test environment was corrected. These intermediate failures are not represented as final passing results.

Node: 22 via `/home/henry/.nvm/nvm.sh` and `nvm use 22`.

Final command:

```bash
npm exec --workspace @patternlike/web -- vitest run src/components/portrait-explorer/PortraitExplorer.test.tsx src/components/portrait-explorer/PortraitScene.runtime.test.tsx src/components/portrait-explorer/PortraitScene.test.tsx src/components/portrait-explorer/content.test.ts src/components/portrait-explorer/explorer-state.test.ts src/components/portrait-explorer/observatory-world.test.ts src/components/portrait-explorer/scene-utils.test.ts src/components/portrait-explorer/use-explorer-navigation.test.tsx src/components/portrait-explorer/zodiac-instrument.test.ts
```

Final log: `/tmp/portrait-feedback-final-tests.log`.

```text
RUN  v4.1.11 /home/henry/patternlike-app/apps/web


 Test Files  9 passed (9)
      Tests  119 passed (119)
   Start at  09:17:41
   Duration  26.30s (transform 2.37s, setup 1.97s, import 3.86s, tests 45.67s, environment 9.80s)
```

`git diff --check`: pass on frozen source.

`npm run build:portrait --workspace @patternlike/web`: passed earlier in implementation with the existing >500kB chunk advisory, log `/tmp/portrait-feedback-build.log`. This build preceded the final small follow-up changes; root owns the authoritative frozen-source build and browser pass.

No current built-browser or physical-device verification is claimed by this agent. Root should check desktop, 390x844 expansion with twelve usable labels and no Reset, 320px Cancer/Taurus/unavailable text plus leader visibility, 844x390 expanded height/disclosure, initial chapter invitation, and graphics-loss reading/retry. Production, signed-in account flows, Safari, physical GPU performance and screen readers remain outside this agent's verification.

## Frozen source identity

Complete binary diff SHA-256: `219bf2e3bae08d988676499b5f3605ac2b3aaed82fbfb095712f89bd37fbb45f`.

```text
9fa15421f0e7b253f6cb4eb7763778163ff4b7cf0ccb3194281a31a931b6db56  apps/web/src/components/portrait-explorer/ObservatoryControls.tsx
27b3059d2efb22fe4debc30b43281ad228b1c9e9fdfb3b887159b0eb6cd88d27  apps/web/src/components/portrait-explorer/PortraitExplorer.test.tsx
4852a2a35b2fc16398e7c6695fdf64b4e4123a962508c6a5713e99d00ebb1e99  apps/web/src/components/portrait-explorer/PortraitExplorer.tsx
77c8a871c28f9b1cd8fc1e1a7326be621667195328b5046e2376b33adb44fdac  apps/web/src/components/portrait-explorer/PortraitScene.runtime.test.tsx
efb1e01bdc9480e0a4558002b7bc1004faa796a6ad1fac69f6ddd66a32d2a389  apps/web/src/components/portrait-explorer/PortraitScene.tsx
712d61b123a49b7af5a544ce25c7800f1433afee508ab8522554f6ef2fdea6e8  apps/web/src/components/portrait-explorer/SkyReader.tsx
9610d4cd64548c3d5d16740958855c8ff360f0e091a7e03c257bb5509d6c2b31  apps/web/src/components/portrait-explorer/observatory.css
e7a804980b4d0ba001b59321188a266d10ba7ce328cef9986b268450d30cfee6  apps/web/src/components/portrait-explorer/scene-utils.test.ts
df631444e28f31534374d930c3e852f81fc4d195e10fa86275f12f82f4d75a38  apps/web/src/components/portrait-explorer/scene-utils.ts
e926d29885734e5fd0d120fb7f651a0986804b3145ff9fd2bb0aaf21b099174a  apps/web/src/components/portrait-explorer/types.ts
```

Diff statistics:

```text
 .../portrait-explorer/ObservatoryControls.tsx      |  2 +-
 .../portrait-explorer/PortraitExplorer.test.tsx    | 57 ++++++++++++++++++++++
 .../portrait-explorer/PortraitExplorer.tsx         | 57 ++++++++++++++++------
 .../PortraitScene.runtime.test.tsx                 | 38 ++++++++++++++-
 .../components/portrait-explorer/PortraitScene.tsx | 55 ++++++++++++++++-----
 .../src/components/portrait-explorer/SkyReader.tsx | 18 ++++---
 .../components/portrait-explorer/observatory.css   | 51 +++++++++++++++++--
 .../portrait-explorer/scene-utils.test.ts          | 16 +++++-
 .../components/portrait-explorer/scene-utils.ts    | 12 +++++
 apps/web/src/components/portrait-explorer/types.ts |  2 +-
 10 files changed, 266 insertions(+), 42 deletions(-)

```

Memory used only for the preservation/focus/lifecycle constraints already verified in current source: MEMORY.md lines 80–94, prior rollout 01a0771d-52a4-7241-b851-dde7db06213e. Current task restriction overrides older aggregate-test guidance.


# Consolidated fix round 1 — frozen correction

Base: `0a9251773c90194af4891901893c8082fa634fe3`. Scope: the two Important findings in `task-2-feedback-review.md`, confirmed against root's first built-browser screenshots and geometry. No build, browser, installs, service changes, unrelated tests, commits or pushes were run in this round. Root-owned artifacts, .impeccable and output were preserved.

## Corrected causes

The selected sky readout previously used a fixed world-space offset and did not share the measured rectangles of zodiac labels. It now gathers those visible rectangles, reserves the projected full bounding box of the actual selected marker, and chooses the nearest collision-free label position inside the canvas area left clear by primary controls. The line retains its exact marker endpoint. A one-pixel clearance accommodates fractional text widths; four pixels proved too restrictive for the narrow dial's available center. At extreme user zoom with no clear rectangle the native placement strip still exposes the selected placement. Camera adaptation, marker identities, source facts and saved-sign-only behavior are unchanged.

The standalone phone header had a more-specific 64px fixed-height rule overriding the existing flexible-height protection. Its observatory rule now uses auto height with a 64px minimum, allowing its wrapped 12px metadata and Full reading row to contribute to layout height. Desktop rules and the larger helper text remain unchanged. Final rendered header bounds remain root's browser check.

## Actual test evidence

All commands used Node 22 via nvm. New runtime cases use representative real text/button dimensions, a 288x300 narrow canvas and a 544x296 landscape canvas. Each cycles Sun, Moon and Rising and requires: readout visible; all twelve sign labels visible; no readout/sign intersections; readout inside the usable canvas; selected marker not under the readout; and leader endpoint at the actual projected marker.

RED command:

```bash
npm exec --workspace @patternlike/web -- vitest run src/components/portrait-explorer/PortraitScene.runtime.test.tsx -t 'measured sign labels'
```

Log `/tmp/portrait-feedback-fix1-red.log`: 2 failed, 12 skipped; both new cases reproduced readout overlap with Sagittarius before the correction. Realistic fixture geometry differs slightly from root's exact font/camera snapshot but reproduces the same overlap cause.

After the first correction, the explicit nine-file portrait lane documented above ran once. Log `/tmp/portrait-feedback-fix1-final-tests.log`: **8 files passed, 1 failed; 120 tests passed, 1 failed**. The new narrow case found no free placement because the initial four-pixel extra clearance excluded the center. This run is not a passing final aggregate result.

The diagnostic targeted rerun `/tmp/portrait-feedback-fix1-geometry-diagnosis.log` exposed the exact sign bounds and confirmed the too-large clearance. After reducing only the extra clearance to one pixel, the RED command above passed both new cases: log `/tmp/portrait-feedback-fix1-geometry-green.log`, **2 passed, 12 skipped**.

Per the instruction permitting only targeted corrections/reruns after new failures, the final affected-file command was:

```bash
npm exec --workspace @patternlike/web -- vitest run src/components/portrait-explorer/PortraitScene.runtime.test.tsx src/components/portrait-explorer/scene-utils.test.ts
```

Final frozen-source log `/tmp/portrait-feedback-fix1-final-affected.log`:

```text
RUN  v4.1.11 /home/henry/patternlike-app/apps/web


 Test Files  2 passed (2)
      Tests  29 passed (29)
   Start at  09:45:56
   Duration  23.41s (transform 428ms, setup 288ms, import 653ms, tests 21.86s, environment 1.62s)
```

This final run covers both production modules changed after the nine-file run; the other portrait test files remain at their earlier passing result. `git diff --check`: pass. Root owns the authoritative build and one batched browser confirmation; this agent claims no rendered success for the correction.

## Frozen correction identity

Complete binary diff SHA-256: `c716d45a0b73d7eb4e84faf09fd26ad7756e13d3923c11fef99fe410ace63a8f`.

```text
7f9af6c174b7b46b8f5178fd963778be686cbac9d6ea3791c3e892312c9a12e6  apps/web/src/components/portrait-explorer/PortraitScene.runtime.test.tsx
9e23d30a28a5751ddf04a4bcb17763c7cf63cfda88060fffb0aafc8577708c5a  apps/web/src/components/portrait-explorer/PortraitScene.tsx
5693c2935c89417c2d5f31c4372febb651ace4bb2378a7266115d21ee3f80fa4  apps/web/src/components/portrait-explorer/observatory.css
39dcc26ffebc7c47246cf8e71e8ef245294c1e1502656bf5eac461cd56cca9e7  apps/web/src/components/portrait-explorer/scene-utils.ts
```

Exact diff against `0a9251773c90194af4891901893c8082fa634fe3`:

```diff
diff --git a/apps/web/src/components/portrait-explorer/PortraitScene.runtime.test.tsx b/apps/web/src/components/portrait-explorer/PortraitScene.runtime.test.tsx
index d8cdfe8..89ae01d 100644
--- a/apps/web/src/components/portrait-explorer/PortraitScene.runtime.test.tsx
+++ b/apps/web/src/components/portrait-explorer/PortraitScene.runtime.test.tsx
@@ -332,3 +332,61 @@ it("keeps all zodiac labels in frame across expansion and resize and connects th
   expect(gpu.position[0]).toBeCloseTo(initialPosition[0], 6);
   expect(gpu.position[2]).toBeCloseTo(initialPosition[2], 6);
 }, 12_000);
+
+
+it.each([{ width: 288, height: 300 }, { width: 544, height: 296 }])("keeps the selected readout clear of measured sign labels and its marker in a $width by $height canvas", async ({ width, height }) => {
+  const signWidths: Record<string, number> = { Aries: 42, Taurus: 49, Gemini: 52, Cancer: 51, Leo: 30, Virgo: 42, Libra: 40, Scorpio: 53, Sagittarius: 76, Capricorn: 73, Aquarius: 64, Pisces: 43 };
+  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
+    return this.matches("[data-sign-index]") ? signWidths[this.textContent ?? ""] ?? 50 : this.matches("[data-sky-body]") ? 80 : 0;
+  });
+  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
+    return this.matches("[data-sign-index]") ? 25 : this.matches("[data-sky-body]") ? 44 : 0;
+  });
+  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
+    if (this.matches(".explorer-scene-top")) return new DOMRect(8, 8, width - 16, 44);
+    if (this.matches(".explorer-scene-toolbar")) return new DOMRect(8, height - 58, width - 16, 50);
+    return new DOMRect(0, 0, width, height);
+  });
+  const callbacks = { ...props(), bookmark: undefined, selectedIds: [], skyView: true, viewKey: "sky",
+    experience: { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} },
+    sky: { chartId: "fictional", placements: [
+      { body: "sun" as const, longitude: 115, sign: "cancer" as const, degree: 25 },
+      { body: "moon" as const, longitude: 42.5, sign: "taurus" as const, degree: 12.5 },
+      { body: "ascendant" as const, longitude: 193, sign: "libra" as const, degree: 13 },
+    ], unavailable: {} },
+  };
+  const scene = (body: "sun" | "moon" | "ascendant") => <div className="explorer-scene"><div className="explorer-scene-top" /><PortraitScene {...callbacks} selectedSkyBody={body} /><div className="explorer-scene-toolbar" /></div>;
+  const view = render(scene("sun"));
+  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
+  const rect = (element: HTMLElement) => {
+    const [x, y] = element.style.transform.match(/-?[\d.]+/g)!.map(Number);
+    return { left: x, right: x + element.offsetWidth, top: y, bottom: y + element.offsetHeight };
+  };
+  for (const body of ["sun", "moon", "ascendant"] as const) {
+    const renders = gpu.renders;
+    view.rerender(scene(body));
+    await waitFor(() => expect(gpu.renders).toBeGreaterThan(renders));
+    const readout = view.container.querySelector<HTMLElement>(`[data-sky-body="${body}"]`)!;
+    expect(readout.style.visibility, JSON.stringify({ body, readout: rect(readout), signs: [...view.container.querySelectorAll<HTMLElement>("[data-sign-index]")].map(label => ({ sign: label.textContent, ...rect(label) })) })).toBe("visible");
+    const box = rect(readout);
+    expect(box.left).toBeGreaterThanOrEqual(6);
+    expect(box.right).toBeLessThanOrEqual(width - 6);
+    expect(box.top).toBeGreaterThanOrEqual(62);
+    expect(box.bottom).toBeLessThanOrEqual(height - 68);
+    const signs = [...view.container.querySelectorAll<HTMLElement>("[data-sign-index]")];
+    expect(signs.filter(label => label.style.visibility === "visible")).toHaveLength(12);
+    for (const sign of signs) {
+      const labelBox = rect(sign);
+      expect(box.right <= labelBox.left || box.left >= labelBox.right || box.bottom <= labelBox.top || box.top >= labelBox.bottom, `${body} readout overlaps ${sign.textContent}`).toBe(true);
+    }
+    const marker = gpu.scene!.getObjectByName(`${body} zodiac marker`)!;
+    const projected = marker.getWorldPosition(new Vector3()).project(gpu.camera!);
+    const x = (projected.x + 1) * width / 2;
+    const y = (1 - projected.y) * height / 2;
+    expect(x < box.left || x > box.right || y < box.top || y > box.bottom, `${body} marker hidden by its readout`).toBe(true);
+    const connector = view.container.querySelector<SVGLineElement>("[data-sky-connector]")!;
+    expect(connector.style.visibility).toBe("visible");
+    expect(Number(connector.getAttribute("x2"))).toBeCloseTo(x, 1);
+    expect(Number(connector.getAttribute("y2"))).toBeCloseTo(y, 1);
+  }
+}, 10_000);
diff --git a/apps/web/src/components/portrait-explorer/PortraitScene.tsx b/apps/web/src/components/portrait-explorer/PortraitScene.tsx
index 843e452..9065854 100644
--- a/apps/web/src/components/portrait-explorer/PortraitScene.tsx
+++ b/apps/web/src/components/portrait-explorer/PortraitScene.tsx
@@ -9,7 +9,7 @@ import {
 import { OrbitControls } from "three/addons/controls/OrbitControls.js";
 import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
 import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
-import { adaptCameraBookmark, cameraFrame, chapterLayout, disposeModel, firstVisibleIntersection, isCameraBookmark, MAX_GLB_BYTES, TapTracker, verifyGlbAsset } from "./scene-utils.js";
+import { adaptCameraBookmark, cameraFrame, chapterLayout, disposeModel, firstVisibleIntersection, isCameraBookmark, MAX_GLB_BYTES, placeLabel, TapTracker, type LabelRect, verifyGlbAsset } from "./scene-utils.js";
 import { facets, type CameraBookmark, type PortraitSceneProps, type SceneStatus } from "./types.js";
 import { createObservatory, DISPLAY_HEIGHT, observatoryFrame, stationPosition, type ObservatoryWorld } from "./observatory-world.js";
 import { BodyIcon, signLabel, skyBodyLabels } from "./SkyReader.js";
@@ -456,6 +456,7 @@ class PortraitRuntime {
     if (!this.world) return;
     const connector = this.labels.querySelector<SVGLineElement>("[data-sky-connector]");
     if (connector) connector.style.visibility = "hidden";
+    const occupied: LabelRect[] = [];
     const place = (element: HTMLElement, anchor: Vector3, marker?: PortraitSkyBody) => {
       const projected = anchor.clone().project(this.camera);
       let visible = Boolean(this.props.skyView) && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
@@ -468,11 +469,14 @@ class PortraitRuntime {
       const y = Math.max(this.topInset + 2, Math.min(this.height - this.bottomInset - height - 2, (1 - projected.y) * this.height / 2 - height / 2));
       element.style.visibility = visible || (this.props.skyView && document.activeElement === element) ? "visible" : "hidden";
       element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
-      return { x: x + width / 2, y: y + height / 2, visible };
+      return { x: Math.round(x), y: Math.round(y), width, height, visible };
     };
     this.world.instrument.signAnchors.forEach((anchor, index) => {
       const label = this.labels.querySelector<HTMLElement>(`[data-sign-index="${index}"]`);
-      if (label) place(label, this.world!.instrument.root.localToWorld(new Vector3(...anchor)));
+      if (label) {
+        const box = place(label, this.world!.instrument.root.localToWorld(new Vector3(...anchor)));
+        if (box.visible) occupied.push(box);
+      }
     });
     for (const [body, marker] of this.world.instrument.markers) {
       const label = this.labels.querySelector<HTMLElement>(`[data-sky-body="${body}"]`);
@@ -487,9 +491,26 @@ class PortraitRuntime {
         const hit = this.visibleHit();
         const visible = readout.visible && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1
           && (!hit || hit.distance >= this.camera.position.distanceTo(markerAnchor) - 0.15 || hit.object.userData.skyBody === body);
+        // Reserve the projected marker's full bounds, not only its center point.
+        const markerBox = new Box3().setFromObject(marker);
+        const markerMin = new Vector2(Infinity, Infinity);
+        const markerMax = new Vector2(-Infinity, -Infinity);
+        for (const x of [markerBox.min.x, markerBox.max.x]) for (const y of [markerBox.min.y, markerBox.max.y]) for (const z of [markerBox.min.z, markerBox.max.z]) {
+          const corner = new Vector3(x, y, z).project(this.camera);
+          const point = new Vector2((corner.x + 1) * this.width / 2, (1 - corner.y) * this.height / 2);
+          markerMin.min(point);
+          markerMax.max(point);
+        }
+        const position = placeLabel(readout, { x: 6, y: this.topInset + 2, width: this.width - 12, height: this.usableHeight - 4 }, [
+          ...occupied,
+          { x: markerMin.x, y: markerMin.y, width: markerMax.x - markerMin.x, height: markerMax.y - markerMin.y },
+        ]);
+        // Extreme user zoom can leave no clear rectangle; the native placement strip still exposes the selection.
+        if (!position) { label.style.visibility = "hidden"; continue; }
+        label.style.transform = `translate(${position.x}px, ${position.y}px)`;
         if (connector && visible) {
-          connector.setAttribute("x1", String(readout.x));
-          connector.setAttribute("y1", String(readout.y));
+          connector.setAttribute("x1", String(position.x + position.width / 2));
+          connector.setAttribute("y1", String(position.y + position.height / 2));
           connector.setAttribute("x2", String((projected.x + 1) * this.width / 2));
           connector.setAttribute("y2", String((1 - projected.y) * this.height / 2));
           connector.style.visibility = "visible";
diff --git a/apps/web/src/components/portrait-explorer/observatory.css b/apps/web/src/components/portrait-explorer/observatory.css
index c632bda..463967d 100644
--- a/apps/web/src/components/portrait-explorer/observatory.css
+++ b/apps/web/src/components/portrait-explorer/observatory.css
@@ -61,7 +61,7 @@
   .observatory-explorer .explorer-scene { height:480px; }
 }
 @media (max-width:767px) {
-  .observatory-explorer .explorer-header { height:64px; }
+  .observatory-explorer .explorer-header { height:auto; min-height:64px; }
   .observatory-explorer .explorer-title { padding:19px 0 14px; display:block; }
   .observatory-explorer .explorer-title h1 { font-size:1.8rem; }
   .observatory-explorer .explorer-title > p { margin:7px 0 0; font-size:.75rem; }
diff --git a/apps/web/src/components/portrait-explorer/scene-utils.ts b/apps/web/src/components/portrait-explorer/scene-utils.ts
index b6f393b..6c30870 100644
--- a/apps/web/src/components/portrait-explorer/scene-utils.ts
+++ b/apps/web/src/components/portrait-explorer/scene-utils.ts
@@ -120,6 +120,35 @@ export function adaptCameraBookmark(bookmark: CameraBookmark, frameDistance: num
   };
 }
 
+export interface LabelRect { x: number; y: number; width: number; height: number; }
+
+/** Choose the nearest free rectangle from the usable viewport and obstacle edges. */
+export function placeLabel(preferred: LabelRect, viewport: LabelRect, obstacles: readonly LabelRect[]): LabelRect | null {
+  const maxX = viewport.x + viewport.width - preferred.width;
+  const maxY = viewport.y + viewport.height - preferred.height;
+  if (maxX < viewport.x || maxY < viewport.y) return null;
+  // A pixel of clearance covers fractional text widths without excluding the narrow dial’s center.
+  const gap = 1;
+  const xs = [preferred.x, viewport.x, maxX];
+  const ys = [preferred.y, viewport.y, maxY];
+  for (const box of obstacles) {
+    xs.push(box.x - preferred.width - gap, box.x + box.width + gap);
+    ys.push(box.y - preferred.height - gap, box.y + box.height + gap);
+  }
+  const columns = new Set(xs.map(x => Math.max(Math.ceil(viewport.x), Math.min(Math.floor(maxX), Math.round(x)))));
+  const rows = new Set(ys.map(y => Math.max(Math.ceil(viewport.y), Math.min(Math.floor(maxY), Math.round(y)))));
+  let best: LabelRect | null = null;
+  let distance = Infinity;
+  for (const x of columns) for (const y of rows) {
+    const score = (x - preferred.x) ** 2 + (y - preferred.y) ** 2;
+    if (score >= distance || obstacles.some(box => x < box.x + box.width + gap && x + preferred.width + gap > box.x
+      && y < box.y + box.height + gap && y + preferred.height + gap > box.y)) continue;
+    best = { ...preferred, x, y };
+    distance = score;
+  }
+  return best;
+}
+
 /** Four-chapter composition in published order; model Y is seated separately. */
 export function chapterLayout(index: number, unfolded: boolean): Point3 {
   const layouts: Point3[] = [[1.13, 0, 1.05], [-1.15, 0, -1.08], [1.2, 0, -1.12], [-1.18, 0, 1.24]];

```
