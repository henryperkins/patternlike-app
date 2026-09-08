import { Box3, Mesh, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createObservatory, observatoryFrame, stationPosition } from "./observatory-world.js";
import { disposeModel } from "./scene-utils.js";

describe("observatory geometry and navigation", () => {
  it("gives shallow objects a clear elevated approach while keeping complete bounds in view", () => {
    const shallow = new Box3(new Vector3(-1, 0.6, -1), new Vector3(1, 0.85, 1));
    const tall = new Box3(new Vector3(-0.7, 0.6, -0.7), new Vector3(0.7, 2.5, 0.7));
    const long = new Box3(new Vector3(-1.2, 0.6, -0.3), new Vector3(1.2, 1, 0.3));
    for (const box of [shallow, tall, long]) for (const aspect of [0.5, 1.5, 3]) {
      const spans: number[] = [];
      for (const inspect of [false, true]) {
        const pose = observatoryFrame([box], [0], aspect, inspect);
        const offset = new Vector3(...pose.position).sub(new Vector3(...pose.target));
        if (box !== tall) expect(offset.y).toBeGreaterThan(Math.hypot(offset.x, offset.z));
        const camera = new PerspectiveCamera(38, aspect, 0.05, 150);
        camera.position.fromArray(pose.position); camera.lookAt(new Vector3(...pose.target)); camera.updateMatrixWorld();
        const points: Vector3[] = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const point = new Vector3(x, y, z).project(camera); points.push(point);
          expect(Math.abs(point.x)).toBeLessThan(0.9);
          expect(Math.abs(point.y)).toBeLessThan(0.9);
        }
        spans.push(Math.max(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))));
      }
      expect(spans[0]).toBeGreaterThan(1);
      expect(spans[1]).toBeGreaterThan(spans[0]);
    }
  });

  it("opens actual desk hinges, carries the furniture when unfolding, and stops at rest", () => {
    const world = createObservatory(4);
    const before = world.desks[0].rotation.x;
    world.setState({ roofOpen: false, lighting: "dusk", open: [true, false, false, false], unfolded: true });
    expect(world.tick(0.2)).toBe(true);
    expect(world.desks[0].rotation.x).not.toBe(before);
    world.tick(1);
    expect(world.tick(1)).toBe(false);
    expect(world.desks[0].rotation.x).toBeCloseTo(-1.25);
    expect(world.desks[1].rotation.x).toBe(0);
    expect(world.stations[0].position.toArray()).toEqual(stationPosition(0, true));
    expect(world.roof.visible).toBe(true);
    disposeModel([world.root]);
  });

  it("approaches a selected chapter and fits the whole architecture on a narrow screen", () => {
    const boxes = [0, 1, 2, 3].map(index => new Box3(new Vector3(-1, 0.6, -1), new Vector3(1, 2.5, 1)).translate(new Vector3(...stationPosition(index, false))));
    const overview = observatoryFrame(boxes, [], 1.5, false);
    const selected = observatoryFrame(boxes, [0], 1.5, false);
    const inspection = observatoryFrame(boxes, [0], 1.5, true);
    const distance = (pose: typeof overview) => new Vector3(...pose.position).distanceTo(new Vector3(...pose.target));
    expect(distance(selected)).toBeLessThan(distance(overview));
    expect(distance(inspection)).toBeLessThan(distance(selected));
    expect(distance(observatoryFrame(boxes, [], 0.5, false))).toBeGreaterThan(distance(overview));
    expect(new Vector3(...selected.target).distanceTo(boxes[0].getCenter(new Vector3()))).toBeLessThan(0.3);
  });

  it("builds solid architectural geometry with finite bounds and no chapter attribution", () => {
    const world = createObservatory(4);
    const bounds = new Box3().setFromObject(world.root);
    expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
    expect(bounds.getSize(new Vector3()).y).toBeGreaterThan(4);
    let meshes = 0;
    world.root.traverse(object => { if (object instanceof Mesh) meshes++; expect(object.userData.chapterId).toBeUndefined(); });
    expect(meshes).toBeGreaterThan(20);
    expect(meshes).toBeLessThan(160);
    disposeModel([world.root]);
  });
});
