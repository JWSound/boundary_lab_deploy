const { readFile, writeFile, mkdir, readdir, stat, copyFile } = require('node:fs/promises');
const { constants } = require('node:fs');
const { join, basename, dirname, extname, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { inflateRawSync } = require('node:zlib');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const kindOf = path => extname(path).toLowerCase() === '.blabsp' ? 'speaker' : extname(path).toLowerCase() === '.msh' ? 'rigid' : null;
// Read only the manifest from the ZIP central directory; never inflate acoustic payloads.
// Keep the desktop main process dependency-free for the packaged application.
function readManifest(bytes) {
  let end = bytes.length - 22;
  const limit = Math.max(0, bytes.length - 65557);
  for (; end >= limit; end--) if (bytes.readUInt32LE(end) === 0x06054b50) break;
  if (end < limit) throw new Error('Invalid speaker package ZIP');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === 'manifest.json') {
      const local = bytes.readUInt32LE(offset + 42);
      if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP entry');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressed > bytes.length || compressed > 2_000_000) throw new Error('Invalid or oversized manifest');
      const payload = bytes.subarray(start, start + compressed);
      if (method !== 0 && method !== 8) throw new Error('Unsupported ZIP compression');
      return JSON.parse((method === 8 ? inflateRawSync(payload, { maxOutputLength: 2_000_000 }) : payload).toString('utf8'));
    }
    offset += 46 + nameLength + extra + comment;
  }
  throw new Error('Missing manifest.json');
}
function metadata(bytes, path) {
  if (kindOf(path) === 'rigid') return { name: basename(path, extname(path)), kind: 'rigid' };
  const m = readManifest(bytes);
  if (m.schema !== 'boundary-lab-speaker-package' || m.schema_version !== 1 || typeof m.name !== 'string') throw new Error('Unsupported speaker package');
  return { name: m.name, kind: 'speaker', level: m.fidelity_level };
}

class AssetLibrary {
  constructor(settingsPath, defaultRoot, builtinRoot, cacheRoot) {
    Object.assign(this, { settingsPath, defaultRoot, builtinRoot, cacheRoot });
    this.cache = new Map();
    this.pending = null;
  }
  async root() {
    if (!this.rootPath) {
      try { this.rootPath = JSON.parse(await readFile(this.settingsPath, 'utf8')).root; } catch {}
      if (typeof this.rootPath !== 'string') this.rootPath = this.defaultRoot;
    }
    return this.rootPath;
  }
  async setRoot(path) {
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error('Choose a folder.');
    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify({ root: resolve(path) }));
    this.rootPath = resolve(path);
    return this.scan();
  }
  async scan() {
    if (this.pending) { await this.pending; return this.scan(); }
    this.pending = this.collect();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async collect() {
    const root = await this.root();
    const entries = [], errors = [], seen = new Set();
    const walk = async (folder, location) => {
      let children;
      try { children = await readdir(folder, { withFileTypes: true }); }
      catch (e) { if (location !== 'builtin' || e.code !== 'ENOENT') errors.push(`${folder}: ${e.message}`); return; }
      for (const child of children) {
        if (child.name.startsWith('.')) continue;
        const path = join(folder, child.name);
        if (child.isDirectory()) { await walk(path, location); continue; }
        if (!child.isFile() || !kindOf(path)) continue;
        seen.add(path);
        try {
          const info = await stat(path);
          const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
          let cached = this.cache.get(path);
          if (!cached || cached.stamp !== stamp) {
            const bytes = await readFile(path);
            const fingerprint = hash(bytes);
            let detail;
            try { detail = metadata(bytes, path); }
            catch (e) { detail = { name: child.name, kind: kindOf(path), error: e.message }; }
            cached = { stamp, entry: { ...detail, key: path, path, fileName: child.name, fingerprint, location } };
            this.cache.set(path, cached);
          }
          entries.push({ ...cached.entry, location });
        } catch (e) { errors.push(`${child.name}: ${e.message}`); }
      }
    };
    // A newly selected folder is never recreated if it later disappears.
    if (root === this.defaultRoot) { try { await mkdir(root, { recursive: true }); } catch (e) { errors.push(`${root}: ${e.message}`); } }
    await walk(root, 'library');
    if (resolve(root) !== resolve(this.builtinRoot)) await walk(this.builtinRoot, 'builtin');
    for (const path of this.cache.keys()) if (!seen.has(path)) this.cache.delete(path);
    return { root, entries: entries.sort((a, b) => a.name.localeCompare(b.name)), errors };
  }
  async read(path, expectedFingerprint) {
    if (typeof path !== 'string' || !kindOf(path)) throw new Error('Choose a .blabsp package or .msh mesh.');
    const bytes = await readFile(path);
    const fingerprint = hash(bytes);
    if (expectedFingerprint && fingerprint !== expectedFingerprint) throw new Error('This file changed. Refresh the library and try again.');
    metadata(bytes, path);
    // Solvers and saved projects use immutable content, even if the watched source is replaced.
    const pinned = join(this.cacheRoot, fingerprint, basename(path));
    await mkdir(dirname(pinned), { recursive: true });
    try { await writeFile(pinned, bytes, { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    return { name: basename(path), path: pinned, originalPath: path, fingerprint,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  }
  async import(paths) {
    const root = await this.root();
    await mkdir(root, { recursive: true });
    const results = [];
    for (const path of paths) {
      try {
        const selected = await this.read(path);
        const extension = extname(path), stem = basename(path, extension);
        let destination;
        for (let n = 0; ; n++) {
          destination = join(root, `${stem}${n ? ` (${n + 1})` : ''}${extension}`);
          try { await copyFile(selected.path, destination, constants.COPYFILE_EXCL); break; }
          catch (e) {
            if (e.code !== 'EEXIST') throw e;
            if (hash(await readFile(destination)) === selected.fingerprint) break;
          }
        }
        results.push({ path, destination });
      } catch (e) { results.push({ path, error: e.message }); }
    }
    return { results, snapshot: await this.scan() };
  }
}
module.exports = { AssetLibrary };
