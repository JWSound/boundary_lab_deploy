// Hidden Electron test of the actual SVG pointer-capture interaction.
const { app, BrowserWindow } = require("electron");
const { build } = require("esbuild");
const assert = require("node:assert/strict");
const { join } = require("node:path");

app.whenReady().then(async () => {
  setTimeout(() => { console.error("Crosshair test timed out"); app.exit(1); }, 45000).unref();
  const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { backgroundThrottling: false, offscreen: true } });
  try {
    const bundle = await build({
      absWorkingDir: join(__dirname, ".."), bundle: true, write: false, format: "iife", jsx: "automatic",
      stdin: { resolveDir: join(__dirname, ".."), loader: "tsx", contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ElectricalPlot} from './src/components/ElectricalPlot';
        import {DriverExcursionPlot} from './src/components/DriverExcursionPlot';
        import './src/styles.css';
        const root=createRoot(document.getElementById('root'));
        const values=new Float32Array([1,2,3]);
        const data={key:'test',frequenciesHz:new Float64Array([20,100,1000]),traces:new Map([['driver',{
          name:'Driver',excursionMm:values,impedanceMagnitudeOhm:values,impedancePhaseDeg:values,
          rmsCurrentA:values,realPowerW:values,acousticResistance:values,acousticReactance:values,differentialPressurePa:values
        }]])};
        window.frequencyChanges=[];
        window.renderPlot=(view, continuous)=>root.render(React.createElement(view==='excursion'?DriverExcursionPlot:ElectricalPlot,{
          continuous:continuous && {band:[20,320],range:[40,160],
            onRange:value=>window.frequencyChanges.push(value),onPlane:value=>window.frequencyChanges.push(value)},
          data,view,coupledSelected:true,currentFrequencyHz:100,frequencyPosition:1,frequencyCount:3,frequencyValues:[20,100,1000],
          onFrequencyPositionChange:(value)=>window.frequencyChanges.push(value),canCalculate:true,calculating:false,completedCount:3,totalCount:3,onCalculateOrStop:()=>{}
        }));
      ` }, outdir: "unused-test-output",
    });
    const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
    const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
    await win.loadURL("data:text/html," + encodeURIComponent('<div id="root" style="width:900px;height:500px"></div><style>' + css + '.microphone-response{height:480px}</style>'));
    await win.webContents.executeJavaScript(js);
    const frame = () => win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    for (const view of ["excursion", "impedance", "current", "power", "acoustic", "differential"]) {
      await win.webContents.executeJavaScript(`window.renderPlot('${view}')`);
      await frame();
      const sliderLayout=await win.webContents.executeJavaScript(`(()=>{
        const slider=document.querySelector('input[aria-label="Frequency"]'), bar=document.querySelector('.response-toolbar');
        const r=slider.getBoundingClientRect(), b=bar.getBoundingClientRect();
        const title=document.querySelector('.response-title').getBoundingClientRect();
        const button=bar.querySelector('.bem-pressure-button').getBoundingClientRect();
        return {width:r.width,height:r.height,center:r.y+r.height/2,titleCenter:title.y+title.height/2,rightGap:button.left-r.right};
      })()`);
      assert.ok(sliderLayout.width>80,'Slider must expand into available space: '+view);
      assert.ok(Math.abs(sliderLayout.center-sliderLayout.titleCenter)<1,'Slider stays inline with the title');
      assert.ok(sliderLayout.rightGap<=13,'Slider uses space up to the calculate button');
      assert.ok(sliderLayout.height>=22,'Slider must reserve room for the thumb');
      if(view==='excursion') {
        require('node:fs').writeFileSync(join(__dirname,'../node_modules/.tmp/frequency-slider.png'),(await win.webContents.capturePage()).toPNG());
        const change=position=>win.webContents.executeJavaScript(`(()=>{
          const input=document.querySelector('input[aria-label="Frequency"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${position});
          input.dispatchEvent(new Event('input',{bubbles:true}));
          return window.frequencyChanges;
        })()`);
        assert.deepEqual(await change(0),[],'Dragging defers the expensive callback');
        assert.deepEqual(await change(2),[],'Successive changes replace the pending update');
        assert.deepEqual(await win.webContents.executeJavaScript(`({label:document.querySelector('.response-frequency span').textContent,changes:window.frequencyChanges})`),{label:'1000 Hz',changes:[]},'Label updates before scene recalculation');
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('input[aria-label="Frequency"]').value`),'2');
        await new Promise(r=>setTimeout(r,200));
        assert.deepEqual(await win.webContents.executeJavaScript('window.frequencyChanges'),[2],'Only the latest value is committed');
        await change(0);
        assert.deepEqual(await win.webContents.executeJavaScript(`document.querySelector('input[aria-label="Frequency"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));window.frequencyChanges`),[2,0],'Release flushes immediately');
        await change(1);
        await win.webContents.executeJavaScript(`document.querySelector('input[aria-label="Frequency"]').dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',bubbles:true}))`);
        assert.deepEqual(await win.webContents.executeJavaScript('window.frequencyChanges'),[2,0,1],'Keyboard release flushes immediately');
        await change(2);
        await win.webContents.executeJavaScript('window.renderPlot("impedance")');
        await frame();await new Promise(r=>setTimeout(r,200));
        assert.deepEqual(await win.webContents.executeJavaScript('window.frequencyChanges'),[2,0,1],'Unmount cancels stale pending changes');
        await win.webContents.executeJavaScript('window.renderPlot("excursion")');await frame();
      }
      const point = await win.webContents.executeJavaScript(`(()=>{
        const well=document.querySelector('.plot-well'), r=well.getBoundingClientRect();
        if(getComputedStyle(well).fill!=='rgb(255, 255, 255)') throw Error('Not white');
        if(getComputedStyle(document.querySelector('.plot-grid.major')).stroke!=='rgb(128, 128, 128)') throw Error('Grid colour');
        return {x:Math.round(r.x+r.width*.4), y:Math.round(r.y+r.height*.4)};
      })()`);
      win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseMove", x: point.x + 15, y: point.y + 10 });
      win.webContents.sendInputEvent({ type: "mouseUp", x: point.x + 15, y: point.y + 10, button: "left", clickCount: 1 });
      await frame();
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.plot-crosshair').length"), 2, view);
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.crosshair-labels text').length"), view === "impedance" ? 3 : 2, view);
      await win.webContents.executeJavaScript("document.querySelector('svg.response-chart').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
      await frame();
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.plot-crosshair').length"), 0, view);
    }
    await win.webContents.executeJavaScript('window.frequencyChanges=[]; window.renderPlot("excursion",true)');
    await frame();
    const trackBounds = () => win.webContents.executeJavaScript(`(() => {
      const {x,width} = document.querySelector('.frequency-track').getBoundingClientRect(); return [x,width];
    })()`);
    const initialBounds = await trackBounds();
    for (const [label, position, expected] of [
      ["Sweep lower limit", 0, [20,160]], ["Sweep upper limit",10000,[40,320]], ["Observation plane frequency",5050,81]
    ]) {
      const input = `document.querySelector('input[aria-label="${label}"]')`;
      await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(${input},${position});
        ${input}.dispatchEvent(new Event('input',{bubbles:true}));`);
      await frame();
      assert.deepEqual(await trackBounds(), initialBounds, "Track geometry stays fixed during preview");
      await win.webContents.executeJavaScript(`${input}.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);
      assert.deepEqual(await win.webContents.executeJavaScript('window.frequencyChanges.at(-1)'),expected,label);
    }
    const drag = await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('.plane-thumb'), r = input.getBoundingClientRect();
      return { x: Math.round(r.left + 7 + (r.width - 14) * input.value / input.max), y: Math.round(r.top + r.height/2) };
    })()`);
    await win.webContents.executeJavaScript('window.frequencyChanges=[]');
    win.webContents.sendInputEvent({type:"mouseDown", modifiers:["leftButtonDown"], ...drag, button:"left", clickCount:1});
    win.webContents.sendInputEvent({type:"mouseMove", modifiers:["leftButtonDown"], x:drag.x+28, y:drag.y});
    win.webContents.sendInputEvent({type:"mouseUp", x:drag.x+28, y:drag.y, button:"left", clickCount:1});
    await frame();
    assert.ok(await win.webContents.executeJavaScript('window.frequencyChanges.length === 1 && window.frequencyChanges[0] > 100'), "Raised plane thumb accepts a real pointer drag");
    console.log("Frequency layout, debounce, release, keyboard, unmount, and crosshair checks passed for all six speaker views.");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
