import { createDeployProject, parseDeployProject } from "../io/deployProject";
import { cabinetClearanceViolations, type BoundaryMeshAsset } from "./cabinetPlacement";
import { buildSourceInstance } from "./field";
import { buildRigidInstance } from "./sceneState";
import type { EditableScene } from "./sceneEditor";

export const CLIPBOARD_SCHEMA = "boundary-lab-deploy-selection";
export const MAX_CLIPBOARD_LENGTH = 2_000_000;
export const selectedObjectIds = (s: EditableScene) => new Set(
  [...s.sourceConfigs, ...s.rigidObjects, ...s.microphones, ...s.audiencePlanes].filter(o => s.selectedInstances.includes(o.id)).map(o => o.id),
);
export function copySelection(s: EditableScene, session: string): string {
  const ids = selectedObjectIds(s);
  if (!ids.size) throw new Error("Select speakers, rigid objects, microphones, or audience planes.");
  if (ids.size > 1000) throw new Error("Copy at most 1,000 scene objects at once.");
  const text = JSON.stringify({ schema: CLIPBOARD_SCHEMA, version: 1, session,
    sources: s.sourceConfigs.filter(o => ids.has(o.id)), rigid_objects: s.rigidObjects.filter(o => ids.has(o.id)),
    microphones: s.microphones.filter(o => ids.has(o.id)), audience_planes: s.audiencePlanes.filter(o => ids.has(o.id)) });
  if (text.length > MAX_CLIPBOARD_LENGTH) throw new Error("Clipboard selection is too large.");
  return text;
}
export function removeSelection(s: EditableScene, ids: ReadonlySet<string>): EditableScene {
  const sourceConfigs = s.sourceConfigs.filter(o => !ids.has(o.id));
  return { ...s, sourceConfigs, audiencePlanes: s.audiencePlanes.filter(p => !ids.has(p.id)), rigidObjects: s.rigidObjects.filter(o => !ids.has(o.id)),
    microphones: s.microphones.filter(o => !ids.has(o.id)), selectedInstances: s.selectedInstances.filter(id => !ids.has(id)),
    fidelity: sourceConfigs.length ? s.fidelity : "pattern" };
}
export function pasteSelection(s: EditableScene, text: string, session: string): EditableScene {
  if (text.length > MAX_CLIPBOARD_LENGTH) throw new Error("Clipboard selection is too large.");
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("Clipboard does not contain a Deploy selection."); }
  if (payload?.schema !== CLIPBOARD_SCHEMA || payload.version !== 1) throw new Error("Clipboard does not contain a supported Deploy selection.");
  if (payload.session !== session) throw new Error("Copy/paste is supported within the current open project. Copy these objects again in this project.");
  // Reuse the project contract to validate values, unique IDs, and loaded asset/channel references.
  const base = createDeployProject(s.projectName, s.packages, s.rigidMeshes, s.channels, [], [], [],
    s.audiencePlanes, 80, s.fidelity);
  const parsed = parseDeployProject(JSON.stringify({ ...base, sources: payload.sources,
    rigid_objects: payload.rigid_objects, microphones: payload.microphones, audience_planes: payload.audience_planes ?? [] }));
  const count = parsed.sources.length + parsed.rigid_objects.length + parsed.microphones.length + parsed.audience_planes.length;
  if (!count || count > 1000) throw new Error("Clipboard must contain between 1 and 1,000 scene objects.");
  const ids = new Set([...s.sourceConfigs, ...s.rigidObjects, ...s.microphones, ...s.audiencePlanes, ...parsed.sources, ...parsed.rigid_objects, ...parsed.microphones, ...parsed.audience_planes].map(o => o.id));
  const nextId = (prefix: string) => { let n = 1; while (ids.has(`${prefix}-${n}`)) n++; const id = `${prefix}-${n}`; ids.add(id); return id; };
  const sources = parsed.sources.map(o => ({ ...o, id: nextId("subwoofer"), name: `${o.name} copy` }));
  const rigid = parsed.rigid_objects.map(o => ({ ...o, id: nextId("rigid"), name: `${o.name} copy` }));
  const microphones = parsed.microphones.map(o => ({ ...o, id: nextId("microphone"), name: `${o.name} copy` }));
  const planes = parsed.audience_planes.map(o => ({ ...o, id: nextId("audience-plane"), name: `${o.name} copy` }));
  const assets = new Map<string, BoundaryMeshAsset>([...s.packages.map(p => [p.id, p] as const), ...s.rigidMeshes.map(p => [p.id, p] as const)]);
  const group = [...sources.map(buildSourceInstance), ...rigid.map(buildRigidInstance)];
  const occupied = [...s.sourceConfigs.map(buildSourceInstance), ...s.rigidObjects.map(buildRigidInstance)];
  if (cabinetClearanceViolations(assets, group).length) throw new Error("The copied group contains overlapping boundary objects. Resolve their clearance before pasting.");
  const step = Math.max(1, ...group.map(o => Math.max(...assets.get(o.packageId)!.boundsM))) + 0.1;
  for (let ring = 0; ring <= 100; ring++) {
    const offsets = ring ? [[ring, 0], [ring, ring], [0, ring], [-ring, ring], [-ring, 0], [-ring, -ring], [0, -ring], [ring, -ring]] : [[0, 0]];
    for (const [x, z] of offsets) {
      const dx = 0.5 + x * step, dz = 0.5 + z * step;
      const moved = group.map(o => ({ ...o, position: [o.position[0] + dx, o.position[1], o.position[2] + dz] as [number, number, number] }));
      if (moved.some(o => occupied.some(other => cabinetClearanceViolations(assets, [o, other]).length))) continue;
      if (microphones.some(o => s.microphones.some(other => Math.hypot(o.positionX + dx - other.positionX,
        o.positionHeightM - other.positionHeightM, o.positionZ + dz - other.positionZ) < 1e-5))) continue;
      const translate = <T extends { positionX: number; positionZ: number }>(o: T): T => ({ ...o, positionX: o.positionX + dx, positionZ: o.positionZ + dz });
      return { ...s, sourceConfigs: [...s.sourceConfigs, ...sources.map(translate)],
        rigidObjects: [...s.rigidObjects, ...rigid.map(translate)], microphones: [...s.microphones, ...microphones.map(translate)],
        audiencePlanes: [...s.audiencePlanes, ...planes.map(p => ({ ...p, ...s.heatmapScale, centerXM: p.centerXM + dx, nearM: p.nearM + dz }))],
        activePlaneId: planes.at(-1)?.id ?? s.activePlaneId,
        selectedInstances: [...sources, ...rigid, ...microphones, ...planes].map(o => o.id) };
    }
  }
  throw new Error("Could not place the copied group without collisions. Nothing was pasted.");
}
