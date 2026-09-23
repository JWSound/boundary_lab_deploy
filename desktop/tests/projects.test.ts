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
  assert.equal(migrated.schema_version, 11); assert.equal(migrated.audience_planes.length, 1);
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

assert.equal(blank.systemGainDb, 32);
assert.equal(blank.channels[0].levelDb, -24);
assert.equal(example.systemGainDb, 0);
assert.equal(example.channels[0].levelDb, 0);
const gainProject = createDeployProject(blank.projectName, [], [], blank.channels, [], [], [], [], 80, "pattern", blank.heatmapScale, 26.5);
assert.equal(parseDeployProject(serializeDeployProject(gainProject)).system_gain_db, 26.5);
const v8 = parseDeployProject(JSON.stringify({ ...gainProject, schema_version: 8, system_gain_db: undefined, channels: [{ ...blank.channels[0], levelDb: 6 }] }));
assert.equal(v8.system_gain_db, 0);
assert.equal(v8.channels[0].levelDb, 6);
for (const bad of [undefined, null, "32", 61, -61]) {
  assert.throws(() => parseDeployProject(JSON.stringify({ ...gainProject, system_gain_db: bad })), /system_gain_db/);
}

const { densityGrid, resizedPlaneGrid, withPlaneDensity, validateGrid } = await import("../src/model/planeSampling");
assert.equal(defaultObservation.heatmapMinimumDb,70);
assert.equal(defaultObservation.heatmapMaximumDb,125);
assert.deepEqual(densityGrid(24,24,0.5),[13,13]);
assert.deepEqual(densityGrid(24,24,2),[49,49]);
assert.deepEqual(densityGrid(24,24,10),[241,241]);
assert.deepEqual(densityGrid(0.1,0.1,0.5),[2,2]);
assert.deepEqual(densityGrid(49.9,49.9,10),[500,500]);
assert.throws(()=>densityGrid(50,49.9,10),/250,000/);
assert.throws(()=>densityGrid(24,24,10.1),/0.5 and 10/);
assert.throws(()=>densityGrid(24,24,0.4),/0.5 and 10/);
assert.throws(()=>densityGrid(24,24,NaN));
assert.throws(()=>validateGrid(2.5,20));
const dense=withPlaneDensity(defaultObservation,10);
assert.deepEqual(resizedPlaneGrid(dense,30,20),[301,201]);
assert.throws(()=>resizedPlaneGrid(dense,100,100),/250,000/);
const densityProject={...project,audience_planes:[{...dense,id:'density-plane',name:'Density plane'}]};
assert.equal(parseDeployProject(serializeDeployProject(densityProject)).audience_planes[0].pointsPerMeter,10);
assert.equal(parseDeployProject(serializeDeployProject(densityProject)).audience_planes[0].columns,241,'Grids above the previous 200-axis limit reload');
const legacyPlane={...defaultObservation,pointsPerMeter:undefined,columns:54,rows:27};
const legacyProject={...project,schema_version:10,audience_planes:[{...legacyPlane,id:'legacy-plane',name:'Legacy plane'}]};
const loadedLegacy=parseDeployProject(JSON.stringify(legacyProject)).audience_planes[0];
assert.equal(loadedLegacy.pointsPerMeter,undefined);
assert.equal(loadedLegacy.columns,54);assert.equal(loadedLegacy.rows,27);
assert.deepEqual(resizedPlaneGrid(loadedLegacy,48,24),[54,28]);
assert.equal(parseDeployProject(serializeDeployProject({...project,audience_planes:[loadedLegacy]})).audience_planes[0].pointsPerMeter,undefined);
for(const invalid of [{...dense,columns:240},{...dense,pointsPerMeter:11},{...dense,pointsPerMeter:null},{...legacyPlane,columns:501,rows:500}]) {
  assert.throws(()=>parseDeployProject(JSON.stringify({...project,audience_planes:[{...invalid,id:'invalid-plane',name:'Invalid'}]})));
}
