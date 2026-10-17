const {app,BrowserWindow}=require('electron');
const {build}=require('esbuild');
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {writeFileSync,mkdirSync}=require('node:fs');
app.whenReady().then(async()=>{
  setTimeout(()=>{console.error('Placement controls timed out');app.exit(1);},30000).unref();
  const win=new BrowserWindow({show:false,width:340,height:360,webPreferences:{offscreen:true,backgroundThrottling:false}});
  try {
    const bundle=await build({absWorkingDir:join(__dirname,'..'),bundle:true,write:false,format:'iife',jsx:'automatic',outdir:'unused',
      define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:join(__dirname,'..'),loader:'tsx',contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {RigidMeshInspector} from './src/components/Controls';import './src/styles.css';
      const root=createRoot(document.getElementById('root'));
      window.config={positionX:.9624546624,positionHeightM:.390361,positionZ:6.450241,pitchDeg:12.4,yawDeg:-.0000009,rollDeg:90.1};
      window.changes=0;
      window.render=()=>root.render(<RigidMeshInspector config={window.config} onChange={next=>{window.config=next;window.changes++;window.render();}}/>);
      window.render();`}});
    await win.loadURL('data:text/html,'+encodeURIComponent('<style>'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text+'</style><div id="root" style="width:312px"></div>'));
    const run=code=>win.webContents.executeJavaScript(code);
    await run(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);
    const frame=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await frame();
    const values=()=>run('Array.from(document.querySelectorAll(".placement-row input")).map(e=>[e.getAttribute("aria-label"),e.value])');
    assert.deepEqual(await values(),[['X','0.96'],['Y','0.39'],['Z','6.45'],['Pitch','12'],['Yaw','0'],['Roll','90']]);
    assert.equal(await run('window.changes'),0,'Formatting must not modify existing poses');
    assert.equal(await run('window.config.positionX'),.9624546624);
    assert.ok(await run('Array.from(document.querySelectorAll(".placement-input button")).every(b=>{const r=b.getBoundingClientRect();return r.width>=30 && r.height>=30;})'),'All step buttons have large hit targets');
    mkdirSync(join(__dirname,'../node_modules/.tmp'),{recursive:true});
    writeFileSync(join(__dirname,'../node_modules/.tmp/placement-controls.png'),(await win.webContents.capturePage()).toPNG());
    const click=async label=>{await run(`document.querySelector('button[aria-label="${label}"]').click()`);await frame();};
    await click('Increase X');assert.equal(await run('window.config.positionX'),1.06);
    await click('Decrease X');assert.equal(await run('window.config.positionX'),.96);
    await click('Increase Pitch');assert.equal(await run('window.config.pitchDeg'),13);
    for(let i=0;i<5;i++)await click('Decrease Y');
    assert.equal(await run('window.config.positionHeightM'),0);
    assert.equal(await run('document.querySelector(\'button[aria-label="Decrease Y"]\').disabled'),true);
    await run(`(()=>{const i=document.querySelector('input[aria-label="X"]');i.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);await frame();
    assert.equal(await run('window.config.positionX'),.96,'Clearing while typing must not move the object to zero');
    await run(`(()=>{const i=document.querySelector('input[aria-label="X"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'-1.237');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);await frame();
    await run(`document.querySelector('input[aria-label="X"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);await frame();
    assert.equal((await values())[0][1],'-1.24');assert.equal(await run('window.config.positionX'),-1.237,'Display precision preserves entered precision');
    await run(`document.querySelector('input[aria-label="Yaw"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);await frame();
    assert.equal(await run('window.config.yawDeg'),-1);
    console.log('Placement formatting, unchanged poses, button targets, bounds, text entry, and keyboard steps passed.');app.exit(0);
  } catch(error){console.error(error);app.exit(1);}
});
