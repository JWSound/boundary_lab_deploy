const { app, BrowserWindow } = require('electron');
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
app.whenReady().then(async () => {
  setTimeout(() => app.exit(2), 90000).unref();
  const win = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { backgroundThrottling: false, offscreen: true } });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  try {
    const bundle = await build({ absWorkingDir: join(__dirname, '..'), bundle: true, write: false, format: 'iife', jsx: 'automatic', outdir: 'unused',
      plugins: [{ name: 'observe-viewport-contract', setup(b) { b.onLoad({ filter: /SceneView\.tsx$/ }, args => ({ contents: readFileSync(args.path, 'utf8').replace('export function SceneView(props: SceneViewProps) {', 'export function SceneView(props: SceneViewProps) { (window as any).viewState = { sourceCount: props.sources.length, selected: props.selectedInstances };'), loader: 'tsx' })); } }],
      define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: join(__dirname, '..'), loader: 'tsx', contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {App} from './src/App'; import './src/styles.css';
        window.version='a'.repeat(64);
        window.entries=[{key:'/library/SAWMOD_Lite.blabsp',path:'/library/SAWMOD_Lite.blabsp',fileName:'SAWMOD_Lite.blabsp',name:'SAWMOD Lite',kind:'speaker',location:'library',fingerprint:window.version,level:2},
          {key:'/library/invalid.blabsp',path:'/library/invalid.blabsp',fileName:'invalid.blabsp',name:'invalid.blabsp',kind:'speaker',location:'library',fingerprint:'bad',error:'Missing manifest.json'}];
        window.boundaryLabDesktop={
          getSolverBackend:async()=>'cpu', recentProjects:async()=>[], rememberProject:async()=>{},
          onSolveStatus:()=>()=>{}, onMicrophoneSweepProgress:()=>()=>{}, cancelMicrophoneSweep:async()=>true,
          scanLibrary:async()=>({root:'/library',entries:window.entries,errors:[]}),
          getDroppedFilePath:file=>'/external/'+file.name,
          importLibraryAssets:async paths=>{window.importedPaths=paths;return {snapshot:{root:'/library',entries:window.entries,errors:[]},results:paths.map(path=>({path,destination:'/library/'+path.split('/').pop()}))};},
          readLibraryAsset:async(path)=>({name:'SAWMOD_Lite.blabsp',path:'/cache/'+window.version+'/SAWMOD_Lite.blabsp',originalPath:path,fingerprint:window.version,bytes:Uint8Array.from(atob(window.packageBase64),c=>c.charCodeAt(0)).buffer}),
          saveProject:async text=>{window.saved=JSON.parse(text);return '/project/test.blabdeploy.json';},
          readSceneClipboard:async()=>window.clipText, writeSceneClipboard:async text=>{window.clipText=text;}
        };
        window.confirm=()=>true;
        createRoot(document.getElementById('root')).render(<App/>);
      ` } });
    const dir = join(__dirname, '../node_modules/.tmp'); mkdirSync(dir, { recursive: true });
    const html = join(dir, 'navigation.html');
    writeFileSync(html, '<div id="root"></div><style>' + bundle.outputFiles.find(f => f.path.endsWith('.css')).text + '</style>');
    await win.loadFile(html);
    await win.webContents.executeJavaScript(`window.packageBase64=${JSON.stringify(readFileSync(join(__dirname, '../library/SAWMOD_Lite.blabsp')).toString('base64'))};void 0;`);
    await win.webContents.executeJavaScript(bundle.outputFiles.find(f => f.path.endsWith('.js')).text + ';void 0;');
    const run = code => win.webContents.executeJavaScript(code).catch(error => { throw Error(code + "\n" + error); });
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const wait = async code => { for (let i = 0; i < 150; i++) { if (await run(`Boolean(${code})`)) return; await delay(50); } throw Error('Waiting for ' + code); };
    const click = async selector => { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(90); };
    const textButton = async text => { await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`); await delay(90); };
    const save = async () => { await click('button[title="Save project"]'); return run('window.saved'); };
    const input = async (label, value) => { await run(`(()=>{const i=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await delay(90); };
    await wait('document.querySelector(".projects-screen")'); await textButton('New');
    await wait('document.querySelectorAll(".asset-row").length===2');
    assert.equal((await save()).packages.length, 0, 'Catalog scanning does not import project assets');
    await click('.asset-select');
    assert.equal((await save()).packages.length, 0, 'Browsing does not import assets');
    assert.ok(await run(`document.querySelector('[aria-label="Add invalid.blabsp to scene"]').disabled`));
    await click('button[aria-label="Add SAWMOD Lite to scene"]');
    await wait('document.querySelectorAll(".outliner-row").length===1');
    await click('.asset-row button[aria-label^="Add "]:not(:disabled)');
    await wait('document.querySelectorAll(".outliner-row").length===2');
    let project = await save();
    assert.equal(project.packages.length, 1); assert.equal(project.sources.length, 2);
    assert.equal(project.packages[0].fingerprint, 'a'.repeat(64));
    assert.ok(project.packages[0].source_file.startsWith('/cache/'));
    const frequency = project.selected_frequency_hz;
    await click('.asset-select'); assert.equal((await save()).selected_frequency_hz, frequency);
    await click('.outliner-row .tree-label');
    await run(`document.querySelectorAll('.outliner-row .tree-label')[1].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`); await delay(90);
    assert.equal(await run('window.viewState.selected.length'), 2);
    await click('button[aria-label="Create scene group"]');
    await input('Object name', 'Main array');
    await run(`document.querySelector('input[aria-label="Object name"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`); await delay(100);
    project = await save(); assert.equal(project.scene_organization.groups[0].name, 'Main array'); assert.equal(project.scene_organization.groups[0].members.length, 2);
    assert.equal(await run(`document.querySelectorAll('.outliner-row button[aria-label^="Hide "], .outliner-row button[aria-label^="Lock "]').length`), 0);
    assert.equal(await run(`document.querySelectorAll('select[aria-label="Add scene object"]').length`), 0);
    assert.equal(await run(`document.querySelectorAll('button[aria-label="Add microphone"], button[aria-label="Add audience plane"]').length`), 2);
    await input('Search scene', 'does-not-exist'); assert.equal(await run('document.querySelectorAll(".outliner-row").length'), 0);
    await input('Search scene', ''); assert.equal(await run('document.querySelectorAll(".outliner-row").length'), 2);
    // Watcher updates catalog only; project data changes only after explicit apply.
    await run(`window.version='b'.repeat(64);window.entries[0]={...window.entries[0],fingerprint:window.version};void 0;`);
    await click('button[aria-label="Refresh library"]');
    assert.equal((await save()).packages[0].fingerprint, 'a'.repeat(64));
    await click('.asset-row[data-package-id^="package-"] .asset-select'); await wait('document.querySelector(".asset-details").textContent.includes("Update available")');
    await textButton('Apply to project'); await delay(500);
    assert.equal((await save()).packages[0].fingerprint, 'b'.repeat(64));
    // Internal drag is an add operation, never a change to library selection.
    await run(`(()=>{const dt=new DataTransfer();dt.setData('application/x-deploy-asset',JSON.stringify({projectId:window.saved.packages[0].id,kind:'speaker'}));document.querySelector('.viewport').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));})()`);
    await wait('document.querySelectorAll(".outliner-row").length===3');
    await run(`(()=>{const dt=new DataTransfer();dt.items.add(new File(['fixture'],'direct.blabsp'));document.querySelector('.viewport').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));})()`);
    await wait('document.querySelector(".asset-drop-notice")');
    assert.equal((await save()).sources.length, 3, 'Raw viewport drops cannot bypass Assets');
    await click('button[aria-label="Dismiss import results"]');
    // External library drops copy files and leave scene object count alone.
    await run(`(()=>{const dt=new DataTransfer();dt.items.add(new File(['fixture'],'new.blabsp'));document.querySelector('.asset-browser').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));})()`);
    await wait('window.importedPaths?.length===1');
    assert.deepEqual(await run('window.importedPaths'), ['/external/new.blabsp']);
    assert.equal((await save()).sources.length, 3);
    await textButton('Channels'); assert.ok(await run('Boolean(document.querySelector(".asset-browser"))'));
    await textButton('Scene');
    await textButton('Actions ▾'); await textButton('Frame selection'); await delay(500);
    await win.webContents.capturePage().then(image => writeFileSync(join(dir, 'navigation.png'), image.toPNG()));
    assert.deepEqual(errors, []);
    console.log('Navigation UI passed: lazy catalog, add/dedup, range selection, saved groups, simplified controls, explicit updates, and asset-only imports.');
    app.exit(0);
  } catch (error) { console.error(error); console.error(errors); app.exit(1); }
});
