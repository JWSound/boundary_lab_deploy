const { mkdir, readFile, writeFile, rename, unlink, readdir, stat } = require("node:fs/promises");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
async function atomicWrite(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, contents, "utf8"); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}
function projectRecovery(root) {
  let pending = Promise.resolve();
  const pathFor = id => {
    if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error("Invalid recovery ID.");
    return join(root, `${id}.blabdeploy.json`);
  };
  const enqueue = operation => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  return {
    flush: () => pending,
    pathFor,
    write: (id, contents) => enqueue(async () => {
      const path = pathFor(id);
      const project = JSON.parse(contents);
      if (project.schema !== "boundary-lab-deploy-project" || typeof project.name !== "string") throw new Error("Invalid recovery project.");
      await mkdir(root, { recursive: true });
      await atomicWrite(path, contents);
    }),
    remove: id => enqueue(async () => { await unlink(pathFor(id)).catch(error => { if (error.code !== "ENOENT") throw error; }); }),
    list: () => enqueue(async () => {
      const files = await readdir(root).catch(error => { if (error.code === "ENOENT") return []; throw error; });
      const entries = [];
      for (const file of files.filter(file => file.endsWith(".blabdeploy.json"))) {
        try {
          const path = join(root, file);
          const project = JSON.parse(await readFile(path, "utf8"));
          if (project.schema !== "boundary-lab-deploy-project") continue;
          entries.push({ id: file.slice(0, -16), name: project.name, updatedAt: (await stat(path)).mtime.toISOString() });
        } catch { /* Keep unreadable snapshots on disk for manual recovery. */ }
      }
      return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }),
  };
}
module.exports = { projectRecovery, atomicWrite };
