const { readFileSync } = require("node:fs");
const { mkdir, writeFile, rename } = require("node:fs/promises");
const { dirname } = require("node:path");
const INTERFACE_SCALES = [0.85, 0.9, 0.95, 1, 1.1];
class InterfacePreferences {
  constructor(path) {
    this.path = path;
    this.scale = 0.9;
    this.writing = Promise.resolve();
    try {
      const saved = JSON.parse(readFileSync(path, "utf8"));
      if (saved?.version === 3) {
        if (INTERFACE_SCALES.includes(saved.scale)) this.scale = saved.scale;
      } else {
        // First apply the earlier range shift, then choose the nearest new option.
        const oldScale = saved?.version === 2 && [0.75, 1, 1.25, 1.5, 1.75].includes(saved.scale)
          ? saved.scale : saved?.version === undefined && [1, 1.25, 1.5, 1.75, 2].includes(saved?.scale)
            ? saved.scale - 0.25 : undefined;
        if (oldScale !== undefined) this.scale = INTERFACE_SCALES.reduce((nearest, scale) =>
          Math.abs(scale - oldScale) < Math.abs(nearest - oldScale) ? scale : nearest);
      }
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
  get() { return this.scale; }
  set(scale) {
    if (!INTERFACE_SCALES.includes(scale)) return Promise.reject(new Error("Invalid interface scale."));
    const write = async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path + ".tmp", JSON.stringify({ version: 3, scale }) + "\n", "utf8");
      await rename(this.path + ".tmp", this.path);
      this.scale = scale;
      return scale;
    };
    const result = this.writing.then(write);
    this.writing = result.catch(() => {});
    return result;
  }
}
module.exports = { InterfacePreferences, INTERFACE_SCALES };
