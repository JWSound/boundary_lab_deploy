const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, writeFile, rm, readdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { projectRecovery, atomicWrite } = require("../electron/projectRecovery.cjs");
test("recovery survives restart, orders writes/deletes, and preserves valid copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "deploy-recovery-"));
  try {
    const store = projectRecovery(root);
    const contents = JSON.stringify({ schema: "boundary-lab-deploy-project", name: "Study", analysis_captures: [{ id: "capture" }] });
    await store.write("session-1", contents);
    const restored = projectRecovery(root);
    assert.equal((await restored.list())[0].id, "session-1");
    assert.equal(await readFile(restored.pathFor("session-1"), "utf8"), contents);
    await assert.rejects(store.write("session-1", "bad json"));
    assert.equal(await readFile(store.pathFor("session-1"), "utf8"), contents);
    await assert.rejects(store.write("../escape", contents));
    await writeFile(join(root, "broken.blabdeploy.json"), "broken");
    assert.equal((await store.list()).length, 1);
    await Promise.all([store.write("session-1", contents), store.remove("session-1")]);
    assert.deepEqual(await store.list(), []);
    await store.remove("session-1");
    await atomicWrite(join(root, "manual.json"), contents);
    await atomicWrite(join(root, "manual.json"), "replacement");
    assert.equal(await readFile(join(root, "manual.json"), "utf8"), "replacement");
    assert.ok(!(await readdir(root)).some(file => file.endsWith(".tmp")));
    await store.flush();
  } finally { await rm(root, { recursive: true, force: true }); }
});
