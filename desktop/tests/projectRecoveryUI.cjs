const { app, BrowserWindow } = require("electron");
const { build } = require("esbuild");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
app.whenReady().then(async () => {
  setTimeout(() => app.exit(1), 60000).unref();
  const win = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { offscreen: true, backgroundThrottling: false } });
  try {
    const bundle = await build({ absWorkingDir: join(__dirname, ".."), bundle: true, write: false, format: "iife", jsx: "automatic", outdir: "unused", define: { "process.env.NODE_ENV": '"production"' }, stdin: { resolveDir: join(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {App} from './src/App';
      import {initialScene} from './src/model/sceneEditor';
      import {createDeployProject, serializeDeployProject} from './src/io/deployProject';
      import './src/styles.css';
      const scene = initialScene();
      const capture = {id:'capture',name:'Saved comparison',createdAt:new Date().toISOString(),project:'{}',pattern:{frequenciesHz:new Float64Array([80]),traces:[{microphoneId:'mic',microphoneName:'Front',splDb:new Float32Array([90]),clippedNearFieldSamples:0}]},boundary:null,coupled:null,excursion:null,electrical:null,raw:{}};
      const project = createDeployProject('Recovered study',[],[],scene.channels,[],[],[],[],80,'pattern');
      project.analysis_captures=[capture];project.visible_capture_ids=[];
      window.recoveryText=serializeDeployProject(project);window.writes=[];window.removes=[];
      window.boundaryLabDesktop={recentProjects:async()=>[],getSolverBackend:async()=> 'cpu',onSolveStatus:()=>()=>{},onMicrophoneSweepProgress:()=>()=>{},cancelMicrophoneSweep:async()=>true,scanLibrary:async()=>({root:'',entries:[],errors:[]}),
        recoveryList:async()=>[{id:'recovered',name:'Recovered study',updatedAt:new Date().toISOString()}],
        recoveryOpen:async()=>({recoveryId:'recovered',name:'recovered.blabdeploy.json',path:'recovery',contents:window.recoveryText,packages:[],rigidMeshes:[]}),
        recoveryWrite:async(id,contents)=>{window.writes.push({id,contents});},recoveryRemove:async id=>{window.removes.push(id);},
        saveProject:async contents=>{window.saved=JSON.parse(contents);return 'study.blabdeploy.json';}};
      window.confirm=()=>true;createRoot(document.getElementById('root')).render(<App/>);
    ` } });
    const dir = join(__dirname, '../node_modules/.tmp'); mkdirSync(dir, {recursive:true});
    const html = join(dir,'recovery-ui.html');
    writeFileSync(html,'<div id="root"></div><style>'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text+'</style>');
    await win.loadFile(html); await win.webContents.executeJavaScript(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text+';void 0;');
    const run = code => win.webContents.executeJavaScript(code).catch(error => { throw Error(code + "\n" + error); });
    const wait = async code => { for(let i=0;i<150;i++){if(await run(`Boolean(${code})`))return;await new Promise(r=>setTimeout(r,50));}throw Error('Waiting for '+code); };
    await wait(`document.querySelector('[aria-label="Recover unsaved projects"]')`);
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Restore').click()`);
    await wait('document.querySelector(".app-shell")');
    await wait('window.writes.length > 0');
    assert.equal(await run('window.writes.at(-1).id'), 'recovered');
    assert.equal(await run('JSON.parse(window.writes.at(-1).contents).analysis_captures[0].name'), 'Saved comparison');
    assert.equal(await run('document.querySelector(".analysis-captures input").checked'), false);
    await run(`document.querySelector('.analysis-captures input').click()`);
    await run(`document.querySelector('button[title="Save project"]').click()`);
    await wait('window.removes.includes("recovered")');
    assert.deepEqual(await run('window.saved.visible_capture_ids'), ['capture']);
    assert.equal(await run('window.saved.analysis_captures[0].pattern.traces[0].splDb[0]'),90);
    await run(`document.querySelector('button[aria-label="Remove Saved comparison"]').click()`);
    await wait('JSON.parse(window.writes.at(-1).contents).analysis_captures.length === 0');
    console.log('Recovery restore, capture visibility, manual save cleanup and subsequent autosave passed.');
    win.destroy();app.exit(0);
  } catch(error){console.error(error);win.destroy();app.exit(1);}
});
