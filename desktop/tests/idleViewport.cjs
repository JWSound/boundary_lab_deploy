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
          onSelectInstance:noop, onTransformSource:noop, onTransformRigid:noop, onTransformSources:noop,
          onTransformMicrophone:noop, onTransformObservation:noop, onResizeObservation:noop,
          onSourceManipulationStart:noop, onSourceManipulationEnd:noop, onManipulationEnd:noop};
        window.updateScene=(patch)=>{ props={...props,...patch}; root.render(<SceneView {...props}/>); };
        window.updateObservation=(patch)=>window.updateScene({observation:{...props.observation,...patch}});
        window.replaceField=()=>window.updateScene({field:{...field,splDb:new Float32Array(64).fill(115)}});
        window.moveSpeaker=()=>window.updateScene({sources:props.sources.map((s,i)=>i ? s : {...s,position:[-4,1,0]})});
        window.readScene=()=>{
          const state=Array.from(_roots.values())[0]?.store.getState();
          if(!state) return null;
          let heatmap;
          state.scene.traverse(o=>{ if(o.material?.uniforms?.uPhaseRad) heatmap=o.material.uniforms; });
          return {frames:state.gl.info.render.frame, camera:state.camera.position.toArray(),
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
    const initial=await settled();
    await delay(500);
    assert.equal((await read()).frames, initial.frames, 'Static scene must draw no additional frames');
    const heatmap=await changed('window.updateObservation({heatmapMaximumDb:125})');
    assert.equal(heatmap.maximum,125,'Direct shader-uniform changes must appear');
    const result=await changed('window.replaceField()');
    assert.equal(result.spl,115,'New solve results must update the displayed texture');
    await changed('window.moveSpeaker()');
    await changed('window.updateScene({selectedInstances:["subwoofer-1"],activeInstance:"subwoofer-1",transformMode:"translate"})');
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
    await update('window.updateScene({phaseAnimationEnabled:true})'); await delay(250);
    const animationStart=await read(); await delay(350); const animationEnd=await read();
    assert.ok(animationEnd.frames>animationStart.frames+2,'Phase animation must render continuously');
    assert.notEqual(animationEnd.phase,animationStart.phase,'Phase must advance');
    await changed('window.updateObservation({displayMode:"spl"})');
    await delay(350); const spl=await read(); await delay(350);
    assert.equal((await read()).frames,spl.frames,'SPL must idle even when animation is enabled');
    await update('window.updateObservation({displayMode:"imag_pressure"})'); await delay(250);
    const imaginary=await read(); await delay(250);
    assert.ok((await read()).frames>imaginary.frames+2,'Imaginary-pressure animation must resume');
    await changed('window.updateScene({phaseAnimationEnabled:false})');
    const stopped=await read(); await delay(350);
    assert.equal((await read()).frames,stopped.frames,'Stopping phase animation must restore idle');
    assert.equal(stopped.phase,0,'Stopping animation resets the displayed phase');
    console.log('Viewport passed: zero idle frames; edits, controls, resize, and phase animation redraw correctly.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
