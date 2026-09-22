const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, utimes, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { RecentProjects } = require("../electron/recentProjects.cjs");

test("Recent projects persist, deduplicate, serialize writes and read actual modification dates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "deploy-recents-"));
  try {
    const file = join(dir, "prefs", "recent.json");
    const projects = new RecentProjects(file);
    assert.deepEqual(await projects.list(), []);
    const first = join(dir, "first.blabdeploy.json"), second = join(dir, "second.blabdeploy.json");
    await writeFile(first, "{}"); await writeFile(second, "{}");
    const modified = new Date("2024-01-02T03:04:05.000Z"); await utimes(first, modified, modified);
    await Promise.all([projects.remember(first, "First"), projects.remember(second, "Second"), projects.remember(first, "Renamed")]);
    const restored = new RecentProjects(file);
    const entries = await restored.list();
    assert.equal(entries.length, 2); assert.equal(entries[0].path, first); assert.equal(entries[0].name, "Renamed");
    assert.equal(entries[0].modifiedAt, modified.toISOString()); assert.equal(entries[0].available, true);
    await rm(first);
    const missing = (await restored.list())[0]; assert.equal(missing.available, false); assert.equal(missing.modifiedAt, null);
    await writeFile(file, "corrupted"); assert.deepEqual(await restored.list(), []);
    await writeFile(file, '[null,42,{}]'); assert.deepEqual(await restored.list(), []);
    for (let n = 0; n < 35; n++) await restored.remember(join(dir, `${n}.json`), `${n}`);
    assert.equal((await restored.list()).length, 30);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
