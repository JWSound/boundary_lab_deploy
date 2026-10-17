import assert from "node:assert/strict";
import { Euler, MathUtils, Mesh, MeshPhongMaterial, Quaternion, Vector3 } from "three";
import { parseViewportModel } from "../src/io/viewportModel";
import { cabinetLocalBounds } from "../src/model/cabinetPlacement";
import { minimumSourceHeightM } from "../src/model/field";
import type { LoadedSpeakerPackage } from "../src/model/types";

const model = parseViewportModel(
  "v -1 -2 -3\nv 1 2 3\nv 0 0 0\nvn 0 1 0\nusemtl wood\nf 1//1 2//1 3//1\n",
  "newmtl wood\nKd 0.5 0.2 0.1\nmap_Kd https://invalid.example/texture.png\n",
);
const child = model.object.children[0] as Mesh;
assert.deepEqual(Array.from(child.geometry.getAttribute("position").array).slice(0, 3), [-1, 3, -2]);
assert.equal(child.geometry.getAttribute("normal").getZ(0), 1);
assert.equal((child.material as MeshPhongMaterial).map, null);
assert.equal((child.material as MeshPhongMaterial).name, "wood");
const pkg = { viewportModel: model, boundsM: [2, 4, 6], mesh: {
  positions: new Float32Array([0, 0, 4]), indices: new Uint32Array(),
} } as LoadedSpeakerPackage;
assert.deepEqual(cabinetLocalBounds(pkg).minimum, [0, -4, 0]);
assert.deepEqual(cabinetLocalBounds({ ...pkg, mesh: null }).minimum, [-1, -3, -2]);
assert.equal(minimumSourceHeightM(pkg), 4); // Acoustic mesh extends below the visual model.
pkg.mesh = null;
assert.equal(minimumSourceHeightM(pkg), 3);
const offset = parseViewportModel("v 0 0 -2\nv 1 0 -3\nv 0 1 -2\nf 1 2 3\n");
const offsetPackage = { ...pkg, viewportModel: offset };
assert.equal(minimumSourceHeightM(offsetPackage), 3); // No acoustic mesh: use bounds, ignoring decorative geometry.
const second = model.object.clone(true);
second.position.x = 10;
assert.equal(model.object.position.x, 0);
console.log("Viewport model transforms, materials, bounds, and ground placement passed.");

// Compare optimized ground clearance with the original full-vector calculation.
// Include off-center geometry, combined rotations, cache eviction and replacement.
const referenceHeight = (positions: Float32Array, pitch: number, roll: number) => {
  const rotation = new Quaternion().setFromEuler(new Euler(
    MathUtils.degToRad(pitch), 0, MathUtils.degToRad(roll), "YXZ",
  ));
  let minimum = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minimum = Math.min(minimum, new Vector3(positions[i], -positions[i + 2], positions[i + 1]).applyQuaternion(rotation).y);
  }
  return -minimum;
};
const acoustic = new Float32Array([1, 2, 3, -2, 4, -1, 0.5, -3, 2]);
const visual = new Float32Array([-3, 1, 2, 2, -4, 5, 1, 2, -2]);
const testAsset = {
  ...pkg, mesh: { positions: acoustic, indices: new Uint32Array() },
  viewportModel: { ...model, mesh: { positions: visual, indices: new Uint32Array() } },
};
for (let i = 0; i < 80; i++) {
  const pitch = i * 7.125 - 180, roll = i * -11.25 + 90;
  const expected = referenceHeight(acoustic, pitch, roll);
  assert.ok(Math.abs(minimumSourceHeightM(testAsset, pitch, roll) - expected) < 1e-12);
  assert.ok(Math.abs(minimumSourceHeightM({ ...testAsset }, pitch, roll) - expected) < 1e-12);
}
assert.equal(minimumSourceHeightM(testAsset), 3); // Visual mesh extends to 5, but must not lift the cabinet.
testAsset.mesh = { positions: new Float32Array([0, 0, 10]), indices: new Uint32Array() };
assert.equal(minimumSourceHeightM(testAsset), 10);
const box = { ...pkg, viewportModel: undefined, mesh: null };
assert.equal(minimumSourceHeightM(box), 3);
assert.ok(Math.abs(minimumSourceHeightM(box, 90, 0) - 2) < 1e-12);
console.log("Ground clearance agrees across combined rotations, shared meshes, and mesh replacement.");
