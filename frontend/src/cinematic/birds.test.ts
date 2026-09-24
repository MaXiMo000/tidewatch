import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CameraRig } from "../scene/camera";
import { Birds } from "./birds";

/** Cinematic's framing (cinematic.ts `shot`) over a small archipelago, landscape. */
function cinematicView(): { rig: CameraRig; camera: THREE.PerspectiveCamera } {
  const rig = new CameraRig();
  rig.camera.aspect = 16 / 9;
  rig.setShot({ elevation: 0.1, distance: 0.6, targetY: 1.4, sweep: 0.28 });
  rig.frame(0, 0, 10, [
    { x: -5, z: 0 },
    { x: 5, z: 2 },
    { x: 0, z: -6 },
  ]);
  const camera = rig.camera;
  camera.position.copy(rig.base.eye);
  camera.lookAt(rig.base.target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return { rig, camera };
}

describe("birds", () => {
  it("each pass crosses the camera's frame, and passes recur", () => {
    const { rig, camera } = cinematicView();
    const birds = new Birds();
    const p = new THREE.Vector3();
    const m = new THREE.Matrix4();
    let passesSeen = 0;
    for (let cycle = 0; cycle < 10; cycle++) {
      let inFrame = false;
      for (let s = 0; s < 42; s += 0.5) {
        birds.tick(cycle * 42 + s, rig.base, false);
        for (let i = 0; i < birds.mesh.count; i++) {
          birds.mesh.getMatrixAt(i, m);
          p.setFromMatrixPosition(m).project(camera);
          if (Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9 && p.z < 1) inFrame = true;
        }
      }
      if (inFrame) passesSeen += 1;
    }
    // ~20% of cycles are skipped on purpose; the rest must actually be visible.
    expect(passesSeen).toBeGreaterThanOrEqual(6);
    birds.dispose();
  });

  it("never flies under reduced motion", () => {
    const { rig } = cinematicView();
    const birds = new Birds();
    for (let t = 0; t < 200; t += 1) {
      birds.tick(t, rig.base, true);
      expect(birds.mesh.count).toBe(0);
    }
    birds.dispose();
  });
});
