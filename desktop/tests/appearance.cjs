const {app,BrowserWindow,ipcMain}=require('electron');
const {build}=require('esbuild');
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {InterfacePreferences}=require('../electron/interfacePreferences.cjs');
app.whenReady().then(async()=>{
  setTimeout(()=>{console.error('Appearance test timed out');app.exit(1);},90000).unref();
  const dir=join(__dirname,'../node_modules/.tmp');mkdirSync(dir,{recursive:true});
  const prefsPath=join(app.getPath('temp'),`deploy-appearance-${process.pid}.json`);
  const prefs=new InterfacePreferences(prefsPath);
  ipcMain.handle('deploy:get-interface-scale',()=>prefs.get());
  ipcMain.handle('deploy:set-interface-scale',async(event,scale)=>{const saved=await prefs.set(scale);event.sender.setZoomFactor(saved);return saved;});
  ipcMain.handle('deploy:get-solver-backend',()=> 'cpu');
  ipcMain.handle('deploy:recent-projects',()=>[]);
  ipcMain.handle('deploy:remember-project',()=>{});
  ipcMain.handle('deploy:library-scan',()=>({root:'/fixture',entries:[],errors:[]}));
  ipcMain.handle('deploy:load-bundled-example',()=>{
    const path=join(__dirname,'../library/S218BP_LOD.blabsp'),bytes=readFileSync(path);
    return {name:'S218BP_LOD.blabsp',path,bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  });
  const win=new BrowserWindow({show:false,width:1920,height:1080,webPreferences:{partition:"appearance-tests",offscreen:true,backgroundThrottling:false,preload:join(__dirname,'../electron/preload.cjs')}});
  try {
    const bundle=await build({absWorkingDir:join(__dirname,'..'),bundle:true,write:false,format:'iife',jsx:'automatic',outdir:'unused',define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:join(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {App} from './src/App';import './src/styles.css';createRoot(document.getElementById('root')).render(<App/>);`}});
    writeFileSync(join(dir,'appearance-bundle.js'),bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);
    writeFileSync(join(dir,'deploy-icon.png'),readFileSync(join(__dirname,'../public/deploy-icon.png')));
    const html=join(dir,'appearance.html');writeFileSync(html,'<div id="root"></div><style>'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text+'</style><script src="appearance-bundle.js"></script>');
    await win.loadFile(html);
    const run=code=>win.webContents.executeJavaScript(code).catch(error=>{throw Error(code+'\n'+error);}),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async code=>{for(let i=0;i<120;i++){if(await run(`Boolean(${code})`))return;await delay(50);}throw Error('Waiting for '+code);};
    const click=async selector=>{await run(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(80);};
    await wait('document.querySelector(".projects-screen")');
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Open example')).click()`);
    await wait('document.querySelectorAll(".outliner-row").length>0');
    assert.equal(await run(`document.querySelectorAll('button[aria-label^="Toggle scene"],button[aria-label^="Toggle object"]').length`),0);
    assert.equal(await run(`document.querySelector('.solver-complexity')`),null,'Pattern hides solver readout');
    const selectMode=async mode=>{
      await run(`Array.from(document.querySelectorAll('.fidelity-switcher button')).find(b=>b.textContent.startsWith('${mode}')).click()`);
      await delay(100);
    };
    await selectMode('Boundary');
    assert.ok(await run(`document.querySelector('.solver-complexity').textContent.includes('2,580')`));
    assert.equal(await run(`document.querySelectorAll('.solver-complexity > div').length`),2);
    assert.ok(await run(`document.querySelector('.solver-complexity').textContent.includes('Est. solver memory: RAM ~')`));
    await selectMode('Coupled');
    assert.ok(await run(`document.querySelector('.solver-complexity').textContent.includes('Reduced states: 256')`));
    await click('.asset-row button[aria-label^="Add "]');
    assert.ok(await run(`document.querySelector('.solver-complexity').textContent.includes('3,870')`),'Adding a speaker updates boundary count');
    assert.ok(await run(`document.querySelector('.solver-complexity').textContent.includes('Reduced states: 384')`));
    await run(`document.activeElement.blur();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`);
    await delay(150);
    assert.ok(await run(`document.querySelector('.solver-complexity').textContent.includes('2,580')`),'Removing a speaker updates count');
    await click('.tree-button[data-object-id="subwoofer-1"]');
    await selectMode('Pattern');
    assert.equal(await run(`Boolean(document.querySelector('.solver-complexity'))`),false);
    await selectMode('Coupled');
    // Native drags exercise pointer capture and both border directions.
    for (const [side,delta] of [['left',70],['right',-60]]) {
      const before=await run(`document.querySelector('.${side}-panel').getBoundingClientRect().width`);
      const point=await run(`(()=>{const r=document.querySelector('.${side}-resizer').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+100)};})()`);
      win.webContents.sendInputEvent({type:'mouseMove',...point});await delay(50);
      win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',modifiers:['leftButtonDown'],clickCount:1});await delay(50);
      win.webContents.sendInputEvent({type:'mouseMove',x:point.x+delta,y:point.y,button:'left',modifiers:['leftButtonDown']});await delay(100);
      win.webContents.sendInputEvent({type:'mouseUp',x:point.x+delta,y:point.y,button:'left',clickCount:1});await delay(100);
      const after=await run(`document.querySelector('.${side}-panel').getBoundingClientRect().width`);
      assert.ok(Math.abs(after-before-Math.abs(delta))<=1,side+' border drag resizes panel '+JSON.stringify({before,after,point,zoom:win.webContents.getZoomFactor()}));
      assert.equal(await run(`document.querySelectorAll('.side-panel-resizer.dragging').length`),0,'Release ends resize');
      await run(`document.querySelector('.${side}-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);await delay(60);
      assert.ok(await run(`document.querySelector('.viewport').getBoundingClientRect().width>=300`),'Panel resizing preserves scene space');
      await run(`document.querySelector('.${side}-resizer').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);await delay(60);
      assert.equal(await run(`document.querySelector('.${side}-panel').getBoundingClientRect().width`),side==='left'?280:330);
    }
    await click('button[aria-label="Preferences"]');
    await wait('document.querySelector("#interface-scale")');
    assert.equal(await run(`document.querySelector('dialog').textContent.includes('Scales text and controls')`),false);
    assert.deepEqual(await run(`Array.from(document.querySelector('#interface-scale').options,o=>o.textContent)`),['85%','90% (default)','95%','100%','110%']);
    const setScale=async scale=>{
      await run(`(()=>{const s=document.querySelector('#interface-scale');s.value='${scale}';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait(`!document.querySelector('#interface-scale').disabled && document.querySelector('#interface-scale').value==='${scale}'`);
      assert.ok(Math.abs(win.webContents.getZoomFactor()-scale)<1e-6);
      assert.equal(new InterfacePreferences(prefsPath).get(),scale);
    };
    for(const [w,h,scale] of [[1920,1080,0.85],[1920,1080,0.9],[1920,1080,0.95],[1920,1080,1],[1920,1080,1.1],[2560,1440,0.95],[3840,2160,1.1],[900,650,1.1]]) {
      win.setContentSize(w,h);await setScale(scale);await delay(150);
      assert.ok(await run(`(()=>{const d=document.querySelector('dialog').getBoundingClientRect();return d.left>=0&&d.top>=0&&d.right<=innerWidth+1&&d.bottom<=innerHeight+1;})()`),'Preferences remains on screen');
      await click('dialog .processing-button');
      const layout=await run(`(()=>{const shell=document.querySelector('.app-shell'),top=document.querySelector('.topbar'),view=document.querySelector('.viewport').getBoundingClientRect();
        return {width:innerWidth,overflow:shell.scrollWidth-innerWidth,topOverflow:top.scrollWidth-top.clientWidth,viewportWidth:view.width,viewportHeight:view.height,font:parseFloat(getComputedStyle(document.querySelector('.response-title')).fontSize)};})()`);
      assert.ok(layout.overflow<=Math.max(0,780-layout.width)+2,JSON.stringify({w,h,scale,layout}));
      assert.ok(layout.topOverflow<=2,'Toolbar clips: '+JSON.stringify({w,h,scale,layout}));
      assert.ok(layout.viewportWidth>=250&&layout.viewportHeight>=150,'Scene remains usable: '+JSON.stringify({w,h,scale,layout}));
      assert.ok(layout.font>=12,'Readable default labels');
      assert.ok(await run(`(()=>{const s=document.querySelector('.solver-complexity').getBoundingClientRect(),v=document.querySelector('.viewport').getBoundingClientRect();return s.left>=v.left&&s.right<=v.right&&s.top>=v.top&&s.bottom<=v.bottom;})()`),'Readout stays within viewport');
      if(w===1920&&(scale===0.9||scale===1.1)) writeFileSync(join(dir,`appearance-${Math.round(scale*100)}.png`),(await win.webContents.capturePage()).toPNG());
      if(layout.width<=1000) {
        assert.ok(await run(`(()=>{const p=document.querySelector('.right-panel').getBoundingClientRect();return p.width>0&&p.right<=Math.max(780,innerWidth)+1;})()`));
        await run(`Array.from(document.querySelectorAll('.right-panel button')).find(b=>b.textContent.includes('Open speaker EQ')).click()`);
        await wait('document.querySelector(".filter-bank-editor")');
        assert.ok(await run(`(()=>{const r=document.querySelector('.filter-bank-editor').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})()`),'EQ dialog fits the scaled window');
        await click('.filter-bank-editor footer button');
      }
      await click('button[aria-label="Preferences"]');
    }
    await setScale(0.95);await win.reload();await wait('document.querySelector(".projects-screen")');
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='New').click()`);
    await wait('document.querySelector(".app-shell")');await click('button[aria-label="Preferences"]');
    await wait('document.querySelector("#interface-scale").value === "0.95"');
    console.log('Appearance passed: native zoom, saved preferences, 1080p/1440p/4K layouts, readable labels, dialogs, and draggable panel borders.');
    app.exit(0);
  } catch(error){console.error(error);app.exit(1);}
});
