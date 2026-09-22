import assert from "node:assert/strict";
import { initialScene, exampleScene } from "../src/model/sceneEditor";
import { createDeployProject, parseDeployProject, serializeDeployProject } from "../src/io/deployProject";
import { defaultObservation } from "../src/model/sceneState";
const blank = initialScene();
assert.equal(blank.packages.length, 0); assert.equal(blank.sourceConfigs.length, 0); assert.equal(blank.audiencePlanes.length, 0);
const make = () => createDeployProject(blank.projectName, [], [], blank.channels, [], [], [], [], 80, "pattern");
const project = make();
assert.deepEqual(parseDeployProject(serializeDeployProject(project)), project);
const planes = [1, 2].map(n => ({ ...defaultObservation, id: `plane-${n}`, name: `Plane ${n}`, heightM: n, pitchDeg: n * 10 }));
project.audience_planes = planes;
assert.deepEqual(parseDeployProject(serializeDeployProject(project)).audience_planes, planes);
assert.throws(() => parseDeployProject(JSON.stringify({ ...project, audience_planes: [planes[0], planes[0]] })), /unique/);
assert.throws(() => parseDeployProject(JSON.stringify({ ...project, audience_planes: [{ ...planes[0], widthM: -1 }] })), /widthM/);
assert.throws(() => parseDeployProject(JSON.stringify({ ...project, audience_planes: null })), /array/);
const example = exampleScene();
const old = createDeployProject(example.projectName, example.packages, [], example.channels, example.sourceConfigs, [], [], example.audiencePlanes, 80, "pattern");
for (const version of [5, 6, 7]) {
  const migrated = parseDeployProject(JSON.stringify({ ...old, schema_version: version, audience_planes: undefined, observation_plane: defaultObservation }));
  assert.equal(migrated.schema_version, 8); assert.equal(migrated.audience_planes.length, 1);
  assert.deepEqual(migrated.audience_planes[0], { ...defaultObservation, id: "audience-plane", name: "Audience plane" });
}
assert.throws(() => parseDeployProject(JSON.stringify({ ...old, packages: [] })), /imported package/);
assert.throws(() => parseDeployProject(JSON.stringify({ ...old, audience_planes: [{ ...planes[0], id: old.sources[0].id }] })), /unique/);
console.log("Blank projects, multiple planes, and v5/v6/v7 migration passed");

const scale = { heatmapMinimumDb: 65, heatmapMaximumDb: 125, heatmapBandingDb: 7, pressureScalePa: 32 };
const scaled = createDeployProject(blank.projectName, [], [], blank.channels, [], [], [], planes, 80, "pattern", scale);
assert.ok(parseDeployProject(serializeDeployProject(scaled)).audience_planes.every(p => p.pressureScalePa === 32 && p.heatmapBandingDb === 7));
scaled.audience_planes = [];
assert.deepEqual(parseDeployProject(serializeDeployProject(scaled)).heatmap_scale, scale, "Scale survives removing all planes");
const perPlane = { ...project, heatmap_scale: undefined, audience_planes: [{ ...planes[0], ...scale }, planes[1]] };
assert.ok(parseDeployProject(JSON.stringify(perPlane)).audience_planes.every(p => p.pressureScalePa === 32), "Legacy per-plane scales use the first plane");
assert.throws(() => parseDeployProject(JSON.stringify({ ...scaled, heatmap_scale: { ...scale, heatmapMaximumDb: 20 } })), /maximum/i);
