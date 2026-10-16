const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { machoType, inventory, verifyInput } = require("../electron/sign-runtime.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-signing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("recognizes executable, dylib, bundle and fat Mach-O headers without mistaking debug data for code", t => {
  const root = fixture(t);
  const file = path.join(root, "native");
  for (const type of [2, 6, 8, 10]) {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(type, 12);
    fs.writeFileSync(file, header);
    assert.equal(machoType(file), type);
    const fat = Buffer.alloc(64);
    fat.writeUInt32BE(0xcafebabe, 0);
    fat.writeUInt32BE(1, 4);
    fat.writeUInt32BE(32, 16);
    header.copy(fat, 32);
    fs.writeFileSync(file, fat);
    assert.equal(machoType(file), type);
  }
  fs.writeFileSync(file, "not native code");
  assert.equal(machoType(file), null);
});

test("rejects modified and unexpected runtime inputs before signing", t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "runtime"));
  const file = path.join(root, "runtime/python");
  fs.writeFileSync(file, "original runtime");
  const manifest = inventory(root);
  verifyInput(root, manifest);
  fs.writeFileSync(file, "modified runtime");
  assert.throws(() => verifyInput(root, manifest), /hash mismatch/);
  fs.writeFileSync(file, "original runtime");
  fs.writeFileSync(path.join(root, "runtime/extra"), "unrecorded");
  assert.throws(() => verifyInput(root, manifest), /Uninventoried/);
});

test("inventories relative symlinks without following them and rejects escaping links", { skip: process.platform === "win32" }, t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "python3.13"), "interpreter");
  fs.symlinkSync("python3.13", path.join(root, "python3"));
  const manifest = inventory(root);
  assert.equal(manifest.symlinks.python3, "python3.13");
  assert.equal(Object.keys(manifest.files).length, 1);
  verifyInput(root, manifest);
  fs.symlinkSync(os.tmpdir(), path.join(root, "escape"));
  assert.throws(() => inventory(root), /Escaping/);
});
