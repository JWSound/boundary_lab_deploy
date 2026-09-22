const {app,BrowserWindow}=require('electron');
const {build}=require('esbuild');
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
app.whenReady().then(async()=>{
  setTimeout(()=>{console.error('Editing test timed out');app.exit(1);},90000).unref();
  const win=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{backgroundThrottling:false,offscreen:true}});
  const errors=[];
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3) errors.push(message);});
  try {
    const mesh=Array.from(readFileSync(join(__dirname,'../library/RigidStage_LOD.msh')));
    const bundle=await build({absWorkingDir:join(__dirname,'..'),bundle:true,write:false,format:'iife',jsx:'automatic',
      plugins:[{name:'disk-backed-demo',setup(b){b.onLoad({filter:/demoPackage\.ts$/},args=>({
        contents:readFileSync(args.path,'utf8').replace('sourcePath: null','sourcePath: "fixture.blabsp"'),loader:'ts'}));}}],
      outdir:'unused',define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:join(__dirname,'..'),loader:'tsx',contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {App} from './src/App'; import './src/styles.css';
      window.clipText=''; window.failWrite=false;
      window.boundaryLabDesktop={loadBundledExample:async()=>null,onSolveStatus:()=>()=>{},onMicrophoneSweepProgress:()=>()=>{},
        solveLevel2:async()=>new Promise(resolve=>{window.finishSolve=resolve;}),
        calculateMicrophoneSweep:async()=>new Promise(resolve=>{window.finishSweep=resolve;}),
        cancelMicrophoneSweep:async()=>{window.cancelledSweeps=(window.cancelledSweeps||0)+1;return true;},
        readSceneClipboard:async()=>window.clipText,writeSceneClipboard:async(text)=>{if(window.failWrite)throw Error('Clipboard unavailable');window.clipText=text;},
        saveProject:async(text)=>{window.saved=JSON.parse(text);return 'study.blabdeploy.json';},
        openRigidMesh:async()=>({name:'Stage.msh',path:'Stage.msh',bytes:Uint8Array.from(${JSON.stringify(mesh)}).buffer})};
      createRoot(document.getElementById('root')).render(<App/>);
      `}});
    const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
    const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
    const dir=join(__dirname,'../node_modules/.tmp');mkdirSync(dir,{recursive:true});
    const html=join(dir,'scene-editing.html');writeFileSync(html,'<div id="root"></div><style>'+css+'</style>');
    await win.loadFile(html);await win.webContents.executeJavaScript(js+";void 0;");
    const run=code=>win.webContents.executeJavaScript(code).catch(error=>{throw Error(code+"\n"+error);});
    const delay=ms=>new Promise(r=>setTimeout(r,ms));
    async function wait(code){for(let i=0;i<100;i++){if(await run(`Boolean(${code})`))return;await delay(50);}throw Error('Waiting for '+code);}
    const click=async selector=>{await run(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(80);};
    const key=async(k,mods='')=>{
      const modifiers=['control',...(mods.includes('shiftKey:true')?['shift']:[])];
      win.webContents.sendInputEvent({type:'keyDown',keyCode:k.toUpperCase(),modifiers});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:k.toUpperCase(),modifiers});
      await delay(150);
    };
    const count=prefix=>run(`document.querySelectorAll('.tree-button[data-object-id^="${prefix}-"]').length`);
    const save=async()=>{await click('button[title="Save project"]');return run('window.saved');};
    await wait('document.querySelectorAll(".tree-button").length>=3');
    const start=await save();assert.equal(start.sources.length,2);
    await key('d');assert.equal(await count('subwoofer'),2,'Ctrl+D is removed');
    assert.equal(await run('document.querySelectorAll(\'button[aria-label="Duplicate selected boundary objects"]\').length'),0);
    await key('c');await key('v');assert.equal(await count('subwoofer'),3);
    await key('z');assert.equal(await count('subwoofer'),2);await key('y');assert.equal(await count('subwoofer'),3);
    await key('z');
    await click('button[aria-label="Add microphone"]');
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Import mesh').click()`);
    await wait('document.querySelector(".rigid-mesh-library .package-card")');
    await click('button[aria-label="Add rigid object"]');
    await run(`document.querySelector('.tree-button[data-object-id="subwoofer-1"]').click();`);
    await delay(50);
    for(const id of ['rigid-1','microphone-1']) {
      await run(`document.querySelector('.tree-button[data-object-id="${id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))`);await delay(50);
    }
    await key('c');const mixedBefore=await save();await key('v');const mixed=await save();
    assert.equal(mixed.sources.length,mixedBefore.sources.length+1);assert.equal(mixed.rigid_objects.length,2);assert.equal(mixed.microphones.length,2);
    const dx=mixed.sources.at(-1).positionX-mixedBefore.sources[0].positionX;
    assert.ok(Math.abs(mixed.rigid_objects.at(-1).positionX-mixedBefore.rigid_objects[0].positionX-dx)<1e-8);
    assert.ok(Math.abs(mixed.microphones.at(-1).positionX-mixedBefore.microphones[0].positionX-dx)<1e-8);
    await key('z');assert.deepEqual((await save()).sources,mixedBefore.sources);assert.equal(await count('rigid'),1);
    await key('z','shiftKey:true');assert.equal(await count('rigid'),2);
    await key('x');assert.equal(await count('rigid'),1);assert.equal(await count('microphone'),1);
    await key('z');assert.equal(await count('rigid'),2);assert.equal(await count('microphone'),2);
    await run('window.failWrite=true');await key('x');assert.equal(await count('rigid'),2,'Failed clipboard write must not cut');await run('window.failWrite=false');
    // A controlled number-field edit is one history step, and text shortcuts do not reach the scene.
    await click('.tree-button[data-object-id="subwoofer-1"]');
    const beforeProperty=await save();
    await run(`(()=>{const input=document.querySelector('.right-panel input[aria-label="X"]');input.focus();
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      for(const value of [-20,-21,-22]){set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await delay(100);
    const focusedCount=await count('subwoofer');
    await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'x',ctrlKey:true,bubbles:true}))`);
    await delay(50);assert.equal(await count('subwoofer'),focusedCount,'Input cut must not delete objects');
    await run('document.activeElement.blur()');await delay(100);
    assert.equal((await save()).sources[0].positionX,-22);
    await key('z');
    assert.deepEqual((await save()).sources,beforeProperty.sources,'Typing one property is one undo step');
    assert.equal(await run(`document.querySelectorAll('.edit-menu, [aria-label="Edit commands"]').length`),0);
    // Range gestures coalesce all intermediate values, including keyboard focus.
    const beforeSlider=await save();
    await run(`(()=>{const input=document.querySelector('input[aria-label="Object delay"][type=range]');input.focus();
      input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      for(const value of [1,2,3]){set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));}
      input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));})()`);
    await delay(100);assert.equal((await save()).sources[0].delayMs,3);
    await key('z');assert.equal((await save()).sources[0].delayMs,beforeSlider.sources[0].delayMs);
    // Offscreen windows do not emit native focus notifications: dispatch them explicitly.
    // Blurring one property must not prematurely end the next property's transaction.
    const beforeFocus=await save();
    await run(`(()=>{const x=document.querySelector('.right-panel input[aria-label="X"]');x.focus();x.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(x,'-30');x.dispatchEvent(new Event('input',{bubbles:true}));
      x.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
      const depth=document.querySelector('.right-panel input[aria-label="Depth"]');depth.focus();depth.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));})()`);
    for(const value of [10,11]) {
      await delay(80);
      await run(`(()=>{const d=document.activeElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(d,'${value}');d.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    }
    await run(`document.activeElement.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));document.activeElement.blur()`);await delay(50);await key('z');
    const afterFocus=await save();assert.equal(afterFocus.sources[0].positionX,-30);assert.equal(afterFocus.sources[0].positionZ,beforeFocus.sources[0].positionZ);
    await key('z');assert.equal((await save()).sources[0].positionX,beforeFocus.sources[0].positionX);
    // Late backend completions cannot revive results after undo/redo restores an old key.
    await run(`Array.from(document.querySelectorAll('.fidelity-switcher button')).find(b=>b.textContent.includes('Boundary')).click()`);
    await delay(100);await click('button[aria-label="Add microphone"]');
    await run(`Array.from(document.querySelectorAll('.topbar button')).find(b=>b.textContent.includes('Solve field')).click()`);
    await wait('typeof window.finishSolve === "function"');
    const revision=await run(`document.querySelector('.solve-status').dataset.solveRevision`);
    await key('z');await key('y');
    await run(`window.finishSolve({columns:2,rows:2,spl_db:[80,80,80,80],sample_indices:[0,1,2,3],field_pressure:{real:[1,1,1,1],imag:[0,0,0,0]},timings:{}})`);
    await delay(100);
    assert.equal(await run(`document.querySelector('.solve-status').dataset.solveRevision`),revision);
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Calculate BEM Pressure')).click()`);
    await wait('typeof window.finishSweep === "function"');
    await key('z');await key('y');
    await run(`window.finishSweep({completed_count:0,total_count:0,frequencies_hz:[],microphone_ids:[],spl_db:[],transducer_ids:[],speaker_ids:[]})`);
    await delay(100);
    assert.ok(await run('window.cancelledSweeps>0'));
    assert.equal(await run(`document.querySelectorAll('.solve-error').length`),0);
    assert.deepEqual(errors,[]);
    console.log('Editing UI passed: single/mixed copy-paste, cut failure, undo/redo, input focus, grouped typing, removed duplication.');
    app.exit(0);
  }catch(error){console.error(error);console.error(errors);app.exit(1);}
});
