// Exercise the real WebGL viewport: idle frames, edits, controls, and phase animation.
const { app, BrowserWindow } = require("electron");
const { build } = require("esbuild");
const assert = require("node:assert/strict");
const { join } = require("node:path");

app.whenReady().then(async () => {
  setTimeout(() => { console.error("Viewport test timed out"); app.exit(1); }, 60000).unref();
  const win = new BrowserWindow({ show: false, width: 900, height: 700,
    webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.on("console-message", (_event, level, message) => { if (level >= 2) console.error(message); });
  try {
    const bundle = await build({
      absWorkingDir: join(__dirname, ".."), bundle: true, write: false, format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      stdin: { resolveDir: join(__dirname, ".."), loader: "tsx", contents: `
        import React from 'react';
        import {Raycaster,Vector3} from 'three';
        import {createRoot} from 'react-dom/client';
        import {_roots} from '@react-three/fiber';
        import {SceneView} from './src/components/SceneView';
        import {createDemoPackage} from './src/model/demoPackage';
        import {defaultObservation, defaultSources, emptyFieldFrame} from './src/model/sceneState';
        import {buildSourceInstance} from './src/model/field';
        const pkg=createDemoPackage(), root=createRoot(document.getElementById('root'));
        const observation={...defaultObservation, columns:8, rows:8};
        const field=emptyFieldFrame(observation);
        field.validMask.fill(1); field.splDb.fill(110); field.pressureReal.fill(1);
        const noop=()=>{};
        let props={packages:[pkg], rigidMeshes:[], sources:defaultSources(pkg).map(buildSourceInstance),
          rigidObjects:[], microphones:[], observation, field, phaseAnimationEnabled:false,
          selectedInstances:[], activeInstance:null, transformMode:'select', angleSnapDisabled:false,
          onSelectInstance:(id)=>{window.selectionEvents.push(id);}, onTransformSource:noop, onTransformRigid:noop, onTransformSources:noop,
          onTransformMicrophone:noop, onTransformObservation:noop, onResizeObservation:noop,
          onSourceManipulationStart:noop, onSourceManipulationEnd:noop, onManipulationEnd:noop};
        window.selectionEvents=[];
        const sceneState=()=>Array.from(_roots.values())[0].store.getState();
        window.handleSizes=()=>{
          const state=sceneState(), sizes=[];
          state.scene.traverse(o=>{if(o.name==='scene-corner-handle') {
            const p=o.getWorldPosition(new Vector3()).applyMatrix4(state.camera.matrixWorldInverse);
            sizes.push(o.scale.x * state.camera.projectionMatrix.elements[5] * state.size.height / (2*Math.abs(p.z)));
          }});
          return sizes;
        };
        window.zoomScene=(factor)=>{
          const state=sceneState();state.camera.position.sub(state.controls.target).multiplyScalar(factor).add(state.controls.target);
          state.controls.update();state.invalidate();
        };
        window.objectPoint=()=>{
          const state=sceneState(), p=new Vector3(...props.sources[1].position).project(state.camera);
          const r=state.gl.domElement.getBoundingClientRect();
          return {x:Math.round(r.left+(p.x+1)*r.width/2),y:Math.round(r.top+(1-p.y)*r.height/2)};
        };
        window.gizmoEvent=(type)=>{
          sceneState().scene.traverse(o=>{if(o.isTransformControls) o.dispatchEvent({type});});
        };
        window.updateScene=(patch)=>{ props={...props,...patch}; root.render(<SceneView {...props}/>); };
        window.updateObservation=(patch)=>window.updateScene({observation:{...props.observation,...patch}});
        window.replaceField=()=>window.updateScene({field:{...field,splDb:new Float32Array(64).fill(115)}});
        window.moveSpeaker=()=>window.updateScene({sources:props.sources.map((s,i)=>i ? s : {...s,position:[-4,1,0]})});
        window.readScene=()=>{
          const state=Array.from(_roots.values())[0]?.store.getState();
          if(!state) return null;
          let heatmap, heatmapMesh;
          state.scene.traverse(o=>{ if(o.material?.uniforms?.uPhaseRad) { heatmap=o.material.uniforms; heatmapMesh=o; } });
          const hits=[];
          if(heatmapMesh) {
            const center=heatmapMesh.getWorldPosition(new Vector3());
            heatmapMesh.raycast(new Raycaster(center.add(new Vector3(0,10,0)),new Vector3(0,-1,0)),hits);
          }
          return {planeHits:hits.length, frames:state.gl.info.render.frame, camera:state.camera.position.toArray(),
            maximum:heatmap?.uMaximumDb.value, spl:heatmap?.uSplMap.value.image.data[0], phase:heatmap?.uPhaseRad.value};
        };
        window.updateScene({});
      ` },
    });
    await win.loadURL('data:text/html,' + encodeURIComponent(
      '<style>html,body,#root{margin:0;width:100%;height:100%;}</style><div id="root"></div>'));
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text);
    const read = () => win.webContents.executeJavaScript('window.readScene()');
    const update = (code) => win.webContents.executeJavaScript(code);
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    async function settled() {
      for (let attempt=0; attempt<25; attempt++) {
        const before=await read(); await delay(200); const after=await read();
        if (after?.frames > 0 && before?.frames===after.frames) return after;
      }
      throw Error('Viewport kept rendering while idle');
    }
    async function changed(code) {
      const before=await read(); await update(code);
      for (let attempt=0; attempt<50 && (await read()).frames===before.frames; attempt++) await delay(100);
      const after=await settled();
      assert.ok(after.frames>before.frames, 'Scene change must render: '+code+' '+JSON.stringify({before,after}));
      return after;
    }
    async function animated(label) {
      // Virtual macOS runners have variable WebGL frame rates. Require
      // sustained frame/phase progress in two successive windows, not a
      // particular number of frames in 250-350 ms.
      for (let window=0; window<2; window++) {
        const before=await read();
        let after=before;
        for (let attempt=0; attempt<50; attempt++) {
          await delay(100); after=await read();
          if (after.frames>before.frames+2 && after.phase!==before.phase) break;
        }
        assert.ok(after.frames>before.frames+2 && after.phase!==before.phase,
          label+' must keep rendering and advancing phase: '+JSON.stringify({before,after}));
      }
    }
    const initial=await settled();
    assert.equal(initial.planeHits,0,"Audience heatmaps must not intercept viewport picking rays");
    await delay(500);
    assert.equal((await read()).frames, initial.frames, 'Static scene must draw no additional frames');
    const heatmap=await changed('window.updateObservation({heatmapMaximumDb:125})');
    assert.equal(heatmap.maximum,125,'Direct shader-uniform changes must appear');
    const result=await changed('window.replaceField()');
    assert.equal(result.spl,115,'New solve results must update the displayed texture');
    await changed('window.moveSpeaker()');
    await changed('window.updateScene({selectedInstances:["subwoofer-1"],activeInstance:"subwoofer-1",transformMode:"translate"})');
    assert.equal(await update('document.querySelectorAll(".scene-label").length'),0,'Selection must not add viewport name labels');
    const assertHandles=async count=>{
      const sizes=await update('window.handleSizes()');
      assert.equal(sizes.length,count);
      sizes.forEach(radius=>assert.ok(Math.abs(radius-5)<0.05,'Corner radius must stay at five CSS pixels: '+radius));
    };
    await assertHandles(8);
    for (const scale of [1.25, 1.5, 2, 1]) {
      win.webContents.setZoomFactor(scale);
      await delay(200);await settled();await assertHandles(8);
    }
    await changed('window.zoomScene(2)');await assertHandles(8);
    await changed('window.zoomScene(0.5)');await assertHandles(8);
    for (const mode of ['translate','rotate']) {
      await changed('window.updateScene({selectedInstances:["subwoofer-1","subwoofer-2"],activeInstance:"subwoofer-2",transformMode:'+JSON.stringify(mode)+'})');
      await assertHandles(8);
      const point=await update('window.objectPoint()');
      await update('window.selectionEvents=[]');
      win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});await delay(50);
      // Reproduce the control lifecycle followed by the browser's release click
      // over a selected cabinet, including a gesture below the movement threshold.
      await update('window.gizmoEvent("mouseDown");window.gizmoEvent("mouseUp")');
      win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await delay(100);
      assert.deepEqual(await update('window.selectionEvents'),[],mode+' release must preserve the multi-selection');
      await changed('window.updateScene({transformMode:"select"})');
      win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
      win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await delay(100);
      assert.deepEqual(await update('window.selectionEvents'),['subwoofer-2'],'The next deliberate click must still select');
    }
    await changed('window.zoomScene(2)');await assertHandles(8);
    await changed('window.zoomScene(0.5)');await assertHandles(8);
    const beforeCamera=await read();
    win.webContents.sendInputEvent({type:'mouseWheel',x:400,y:300,deltaY:120,deltaX:0});
    await delay(200);
    const afterCamera=await settled();
    assert.notDeepEqual(afterCamera.camera,beforeCamera.camera,'Orbit controls must move the camera');
    assert.ok(afterCamera.frames>beforeCamera.frames,'Camera movement must render');
    win.setSize(1000,750); await delay(200);
    const resized=await settled();
    assert.ok(resized.frames>afterCamera.frames,'Resizing must render');
    await changed('window.updateObservation({displayMode:"real_pressure"})');
    await update('window.updateScene({phaseAnimationEnabled:true})');
    await animated('Real-pressure animation');
    await changed('window.updateObservation({displayMode:"spl"})');
    await delay(350); const spl=await read(); await delay(350);
    assert.equal((await read()).frames,spl.frames,'SPL must idle even when animation is enabled');
    await update('window.updateObservation({displayMode:"imag_pressure"})');
    await animated('Imaginary-pressure animation');
    await changed('window.updateScene({phaseAnimationEnabled:false})');
    const stopped=await read(); await delay(350);
    assert.equal((await read()).frames,stopped.frames,'Stopping phase animation must restore idle');
    assert.equal(stopped.phase,0,'Stopping animation resets the displayed phase');
    console.log('Viewport passed: zero idle frames; edits, controls, resize, and phase animation redraw correctly.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
