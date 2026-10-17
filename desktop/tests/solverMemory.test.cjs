const {test}=require("node:test");
const assert=require("node:assert/strict");
const {parseNvidiaMemory,detectMemory,memoryWarnings,SolverMemoryGuard}=require("../electron/solverMemory.cjs");
const GiB=1024**3;
const request={backend:"cuda",fidelity:"boundary",systemUpper:8*GiB,gpuUpper:6*GiB};
const hardware={ram:16*GiB,gpu:{bytes:4*GiB,multiple:false}};
test("detect GPU capacity without pooling devices, honor visibility, handle query failure",async()=>{
  const output="0, GPU-aaa, 8192\n1, GPU-bbb, 4096\n";
  assert.deepEqual(parseNvidiaMemory(output,"0,1"),{bytes:4*GiB,multiple:true});
  assert.deepEqual(parseNvidiaMemory(output,"GPU-aaa"),{bytes:8*GiB,multiple:false});
  assert.equal(parseNvidiaMemory(output,"-1"),null);
  assert.equal(parseNvidiaMemory("0, GPU-aaa, N/A","0"),null);
  assert.equal((await detectMemory("cuda",async()=>{throw Error("unavailable");})).gpu,null);
  assert.ok((await detectMemory("cpu",async()=>{throw Error("must not query GPU");})).ram>0);
});
test("compare upper bounds against installed capacity for CPU, CUDA and unified memory",()=>{
  assert.equal(memoryWarnings(request,hardware).length,1);
  assert.match(memoryWarnings(request,hardware)[0],/GPU memory/);
  assert.equal(memoryWarnings({...request,systemUpper:16*GiB,gpuUpper:4*GiB},hardware).length,0);
  assert.equal(memoryWarnings({...request,systemUpper:20*GiB},hardware).length,2);
  assert.match(memoryWarnings({...request,backend:"metal",systemUpper:20*GiB},hardware)[0],/Unified memory/);
  assert.equal(memoryWarnings(request,{ram:16*GiB,gpu:null}).length,0);
});
test("cancel blocks; continue allows only approved sizes/backend/mode/window",async()=>{
  const guard=new SolverMemoryGuard(async()=>hardware);let prompts=0;
  const cancel=async options=>{prompts++;assert.equal(options.defaultId,0);assert.deepEqual(options.buttons,["Cancel","Continue anyway"]);return {response:0};};
  const accept=async()=>{prompts++;return {response:1};};
  assert.equal(await guard.check(1,request,cancel),false);
  assert.equal(await guard.check(1,request,accept),true);
  assert.equal(await guard.check(1,request,cancel),true);
  assert.equal(prompts,2);
  assert.equal(await guard.check(1,{...request,gpuUpper:7*GiB},cancel),false);
  assert.equal(await guard.check(1,{...request,fidelity:"coupled"},cancel),false);
  assert.equal(await guard.check(2,request,cancel),false);
  assert.equal(await guard.check(1,{...request,backend:"cpu",systemUpper:20*GiB},cancel),false);
  guard.forget(1);assert.equal(await guard.check(1,request,cancel),false);
  await assert.rejects(guard.check(1,{...request,systemUpper:NaN},accept));
});
test("pending identical requests share one warning and cancellation",async()=>{
  const guard=new SolverMemoryGuard(async()=>hardware);let resolve,prompts=0;
  const show=()=>{prompts++;return new Promise(r=>{resolve=r;});};
  const a=guard.check(1,request,show),b=guard.check(1,request,show);
  await new Promise(r=>setImmediate(r));resolve({response:0});
  assert.deepEqual(await Promise.all([a,b]),[false,false]);assert.equal(prompts,1);
});
