const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {InterfacePreferences,INTERFACE_SCALES}=require('../electron/interfacePreferences.cjs');
test('interface scale persists, validates, and serializes rapid changes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'deploy-appearance-'));
  try {
    const path=join(dir,'preferences.json'),store=new InterfacePreferences(path);
    assert.equal(store.get(),0.9);
    for(const scale of INTERFACE_SCALES){await store.set(scale);assert.equal(new InterfacePreferences(path).get(),scale);}
    for(const invalid of [0,0.75,1.25,1.5,1.75,2,3,NaN,'1.5',null]) await assert.rejects(store.set(invalid));
    assert.equal(store.get(),1.1);
    await Promise.all([store.set(0.9),store.set(0.95),store.set(1.1)]);
    assert.equal(new InterfacePreferences(path).get(),1.1);
    for (const version of [undefined,2]) {
      for (const [oldScale,expected] of [[0.75,0.85],[1,1],[1.25,1.1],[1.5,1.1],[1.75,1.1]]) {
        await writeFile(path,JSON.stringify({version,scale:version===2?oldScale:oldScale+0.25}));
        const migrated=new InterfacePreferences(path);
        assert.equal(migrated.get(),expected);
        await migrated.set(migrated.get());
        assert.equal(new InterfacePreferences(path).get(),expected,'Saved migration does not shift again');
      }
    }
    await writeFile(path,'null');assert.equal(new InterfacePreferences(path).get(),0.9);
    await writeFile(path,'broken');assert.equal(new InterfacePreferences(path).get(),0.9);
    await writeFile(path,JSON.stringify({scale:99}));assert.equal(new InterfacePreferences(path).get(),0.9);
  } finally {await rm(dir,{recursive:true,force:true});}
});
