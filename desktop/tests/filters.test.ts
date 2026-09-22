import { webcrypto } from "node:crypto";
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { equalizerResponse, parseEqualizer, sourceDrive } from "../src/model/filters";
import { applyChannelProcessing } from "../src/model/channels";
import { exampleScene, equalScene } from "../src/model/sceneEditor";
import { EditorHistory } from "../src/model/editorHistory";
import { copySelection, pasteSelection } from "../src/model/sceneClipboard";
import { createDeployProject, parseDeployProject, serializeDeployProject } from "../src/io/deployProject";
const vectors = JSON.parse(readFileSync('../tests/filter_response_vectors.json','utf8'));
for (const c of vectors) {
  const h = equalizerResponse(parseEqualizer(c.bank), c.frequencyHz);
  assert.ok(Math.hypot(h[0]-c.real,h[1]-c.imag)<1e-12);
}
const f = { id:'f', type:'peq' as const, enabled:true, frequencyHz:100, gainDb:12, q:0.7 };
for (const patch of [{q:0},{frequencyHz:NaN},{gainDb:true},{enabled:1},{type:'unknown'},{family:'bad'},{order:2}]) {
  assert.throws(()=>parseEqualizer({bypassed:true,filters:[{...f,...patch}]}));
}
for (const bank of [null,{}, {filters:[f,f]}, {filters:[],bypassed:1}, {filters:[{...f,type:'lowpass',family:'linkwitz-riley',order:3}]}]) assert.throws(()=>parseEqualizer(bank));
const scene=exampleScene();
scene.sourceConfigs[0]={...scene.sourceConfigs[0],levelDb:0,equalizer:{filters:[f]}};
scene.channels[0]={...scene.channels[0],levelDb:0,equalizer:{filters:[f]}};
const driven=applyChannelProcessing(scene.sourceConfigs,scene.channels,0);
assert.ok(Math.abs(sourceDrive(driven[0],100)[0]-10**(24/20))<1e-12);
const bypassed=applyChannelProcessing(scene.sourceConfigs,[{...scene.channels[0],equalizer:{filters:[f],bypassed:true}}]);
assert.ok(Math.abs(sourceDrive(bypassed[0],100)[0]-10**(12/20))<1e-12);
assert.equal(scene.sourceConfigs[0].equalizer.filters[0].id,'f');
const project=createDeployProject(scene.projectName,scene.packages,[],scene.channels,scene.sourceConfigs,[],[],scene.audiencePlanes,80,'pattern',scene.heatmapScale,scene.systemGainDb);
assert.deepEqual(parseDeployProject(serializeDeployProject(project)),project);
const history=new EditorHistory(scene,equalScene);
history.run('Bypass EQ',()=>history.set('channels',scene.channels.map(c=>({...c,equalizer:{...c.equalizer,bypassed:true}}))));
history.undo(); assert.equal(history.present.channels[0].equalizer.bypassed,undefined);
history.redo(); assert.equal(history.present.channels[0].equalizer.bypassed,true);
scene.selectedInstances=[scene.sourceConfigs[0].id];
const pasted=pasteSelection(scene,copySelection(scene,history.session),history.session);
assert.deepEqual(pasted.sourceConfigs.at(-1)!.equalizer,scene.sourceConfigs[0].equalizer);
console.log('Filter references, validation, cascading, persistence, clipboard, and history passed');
