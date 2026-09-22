const { readFile, writeFile, mkdir, rename, stat } = require("node:fs/promises");
const { dirname, resolve, basename } = require("node:path");

// Keep recency separately from filesystem modification time. Missing files remain
// visible so a disconnected drive does not silently erase a user's project list.
class RecentProjects {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async read() {
    try {
      const entries = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(entries) ? entries.filter(e => e && typeof e.path === "string" && typeof e.name === "string").slice(0, 30) : [];
    } catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return []; throw error; }
  }
  remember(path, name) {
    const update = this.queue.then(async () => {
      const absolute = resolve(path);
      const key = p => process.platform === "win32" ? p.toLowerCase() : p;
      const entries = (await this.read()).filter(e => key(e.path) !== key(absolute));
      entries.unshift({ path: absolute, name: name || basename(absolute), openedAt: new Date().toISOString() });
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file + ".tmp", JSON.stringify(entries.slice(0, 30)), "utf8");
      await rename(this.file + ".tmp", this.file);
    });
    this.queue = update.catch(() => {});
    return update;
  }
  async list() {
    await this.queue;
    return Promise.all((await this.read()).map(async entry => {
      try {
        const info = await stat(entry.path);
        return { ...entry, modifiedAt: info.isFile() ? info.mtime.toISOString() : null, available: info.isFile() };
      } catch { return { ...entry, modifiedAt: null, available: false }; }
    }));
  }
}
module.exports = { RecentProjects };
