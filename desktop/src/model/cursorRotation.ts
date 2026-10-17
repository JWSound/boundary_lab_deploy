import { type Camera, type Object3D, Plane, Quaternion, Raycaster, Vector2, Vector3 } from "three";

type Pointer = { x: number; y: number; button: number };
// Adapter for the pinned three-stdlib control; keep its picking and drag lifecycle.
interface RotationControl {
  camera: Camera;
  object?: Object3D;
  mode: string;
  space: string;
  axis: string | null;
  dragging: boolean;
  rotationSnap: number | null;
  rotationAngle: number;
  rotationAxis: Vector3;
  pointerDown(pointer: Pointer): void;
  pointerMove(pointer: Pointer): void;
  pointerUp(pointer: Pointer): void;
  dispatchEvent(event: { type: string }): void;
}
const installed = new WeakSet<object>();

export function installCursorRotation(value: unknown): void {
  const control = value as RotationControl | null;
  if (!control?.pointerDown || installed.has(control)) return;
  installed.add(control);
  const down = control.pointerDown.bind(control);
  const move = control.pointerMove.bind(control);
  const up = control.pointerUp.bind(control);
  const raycaster = new Raycaster();
  const pointerPosition = new Vector2();
  const plane = new Plane();
  const center = new Vector3();
  const axis = new Vector3();
  const previous = new Vector3();
  const current = new Vector3();
  const cross = new Vector3();
  const start = new Quaternion();
  const parentInverse = new Quaternion();
  const delta = new Quaternion();
  let active = false;
  let angle = 0;
  let radius = 0;
  let local = false;
  let object: Object3D | undefined;
  let selectedAxis: string | null = null;
  const direction = (pointer: Pointer): boolean => {
    raycaster.setFromCamera(pointerPosition.set(pointer.x, pointer.y), control.camera);
    if (Math.abs(raycaster.ray.direction.dot(plane.normal)) < 0.03) return false;
    if (!raycaster.ray.intersectPlane(plane, current)) return false;
    current.sub(center);
    // Near the pivot the cursor angle is undefined; hold the last valid angle.
    if (current.length() < Math.max(1e-8, radius * 0.1)) return false;
    current.normalize();
    return true;
  };
  control.pointerDown = pointer => {
    if (control.dragging || pointer.button !== 0) { down(pointer); return; }
    active = false;
    down(pointer);
    object = control.object;
    selectedAxis = control.axis;
    if (!object || !control.dragging || control.mode !== "rotate" || !["X", "Y", "Z"].includes(selectedAxis ?? "")) return;
    local = control.space === "local";
    axis.set(selectedAxis === "X" ? 1 : 0, selectedAxis === "Y" ? 1 : 0, selectedAxis === "Z" ? 1 : 0);
    object.getWorldPosition(center);
    const worldAxis = axis.clone();
    if (local) worldAxis.applyQuaternion(object.getWorldQuaternion(new Quaternion()));
    plane.setFromNormalAndCoplanarPoint(worldAxis, center);
    raycaster.setFromCamera(pointerPosition.set(pointer.x, pointer.y), control.camera);
    // An edge-on ring has no stable plane intersection. Use the library's
    // tangent drag for this whole gesture, rather than switching mid-drag.
    if (Math.abs(raycaster.ray.direction.dot(worldAxis)) < 0.15) return;
    radius = 0;
    if (!raycaster.ray.intersectPlane(plane, current)) return;
    radius = current.distanceTo(center);
    if (!direction(pointer)) return;
    previous.copy(current);
    start.copy(object.quaternion);
    parentInverse.copy(object.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()).invert();
    angle = 0;
    active = true;
  };
  control.pointerMove = pointer => {
    if (!active) { move(pointer); return; }
    if (!control.dragging || control.object !== object || control.axis !== selectedAxis || control.mode !== "rotate") { active = false; return; }
    if (pointer.button !== -1 || !direction(pointer)) return;
    angle += Math.atan2(plane.normal.dot(cross.crossVectors(previous, current)), previous.dot(current));
    previous.copy(current);
    const snapped = control.rotationSnap ? Math.round(angle / control.rotationSnap) * control.rotationSnap : angle;
    control.rotationAngle = snapped;
    control.rotationAxis.copy(axis);
    if (local) {
      object!.quaternion.copy(start).multiply(delta.setFromAxisAngle(axis, snapped)).normalize();
    } else {
      control.rotationAxis.applyQuaternion(parentInverse);
      object!.quaternion.copy(delta.setFromAxisAngle(control.rotationAxis, snapped)).multiply(start).normalize();
    }
    control.dispatchEvent({ type: "change" });
    control.dispatchEvent({ type: "objectChange" });
  };
  control.pointerUp = pointer => {
    if (pointer.button === 0) active = false;
    up(pointer);
  };
}
