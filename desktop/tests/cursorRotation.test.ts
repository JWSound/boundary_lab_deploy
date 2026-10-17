import assert from "node:assert/strict";
import { Group, PerspectiveCamera, OrthographicCamera, Quaternion, Scene, Vector3 } from "three";
import { TransformControls } from "three-stdlib";
import { installCursorRotation } from "../src/model/cursorRotation";

for (const orthographic of [false, true]) for (const local of [false, true]) for (const axisName of ["X", "Y", "Z"]) {
  const scene = new Scene();
  const parent = new Group(); parent.rotation.set(0.2, 0.3, -0.1); scene.add(parent);
  const object = new Group(); object.rotation.set(0.1, -0.2, 0.3); parent.add(object);
  const camera = orthographic ? new OrthographicCamera(-4, 4, 3, -3, 0.1, 100) : new PerspectiveCamera(50, 4 / 3, 0.1, 100);
  camera.position.set(6, 7, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  // The library marks pointer handlers private in its declarations, but exposes
  // them on the control instance used by its DOM event handlers.
  const control = new TransformControls(camera, undefined) as any;
  scene.add(control); control.attach(object); control.setMode("rotate"); control.setSpace(local ? "local" : "world"); control.rotationSnap = null;
  scene.updateMatrixWorld(true);
  installCursorRotation(control); const handler = control.pointerMove; installCursorRotation(control); assert.equal(control.pointerMove, handler);
  const start = object.quaternion.clone();
  const axis = new Vector3(axisName === "X" ? 1 : 0, axisName === "Y" ? 1 : 0, axisName === "Z" ? 1 : 0);
  const worldAxis = axis.clone(); if (local) worldAxis.applyQuaternion(object.getWorldQuaternion(new Quaternion()));
  const radial = new Vector3().crossVectors(worldAxis, new Vector3(0.3, 0.5, 0.7)).normalize();
  const pointer = (degrees: number, button: number, radius = 1) => {
    const p = radial.clone().applyAxisAngle(worldAxis, degrees * Math.PI / 180).multiplyScalar(radius).project(camera);
    return { x: p.x, y: p.y, button };
  };
  const expected = (degrees: number) => local
    ? start.clone().multiply(new Quaternion().setFromAxisAngle(axis, degrees * Math.PI / 180))
    : new Quaternion().setFromAxisAngle(axis.clone().applyQuaternion(parent.getWorldQuaternion(new Quaternion()).invert()), degrees * Math.PI / 180).multiply(start);
  let changes = 0; control.addEventListener("objectChange", () => changes++);
  control.axis = axisName; control.pointerDown(pointer(0, 0)); assert.equal(control.dragging, true);
  for (let degrees = 10; degrees <= 720; degrees += 10) {
    control.pointerMove(pointer(degrees, -1, 1.2));
    assert.ok(object.quaternion.angleTo(expected(degrees)) < 1e-6, `${orthographic}/${local}/${axisName}: ${degrees}`);
  }
  control.rotationSnap = Math.PI / 36;
  control.pointerMove(pointer(732, -1)); assert.ok(object.quaternion.angleTo(expected(730)) < 1e-6);
  control.rotationSnap = null;
  control.pointerMove(pointer(732, -1)); assert.ok(object.quaternion.angleTo(expected(732)) < 1e-6);
  const before = object.quaternion.clone();
  control.pointerMove(pointer(820, -1, 0.01)); assert.ok(object.quaternion.angleTo(before) < 1e-6);
  control.pointerUp({ button: 0, x: 0, y: 0 }); assert.equal(control.dragging, false);
  control.pointerMove(pointer(760, -1)); assert.ok(object.quaternion.angleTo(before) < 1e-6);
  assert.equal(changes, 74);
}
console.log("Cursor rotation: all axes, perspective/orthographic, world/local, parent transforms, full turns, snapping, pivot dead zone and release passed.");

// Edge-on rings retain the library tangent behavior; translation is untouched.
for (const mode of ["rotate", "translate"]) {
  const run = (install: boolean) => {
    const scene = new Scene(), object = new Group(); scene.add(object);
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const control = new TransformControls(camera, undefined) as any;
    scene.add(control); control.attach(object); control.setMode(mode); control.axis = "X";
    scene.updateMatrixWorld(true); if (install) installCursorRotation(control);
    control.pointerDown({ x: 0.2, y: 0.2, button: 0 });
    control.pointerMove({ x: 0.4, y: 0.4, button: -1 });
    return { position: object.position.toArray(), quaternion: object.quaternion.toArray() };
  };
  assert.deepEqual(run(true), run(false));
}
console.log("Edge-on fallback and unchanged translation passed.");
