const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// Inspect Mach-O headers, not extensions: Julia package images and Python
// extensions are native code too. Exclude relocatable objects and debug symbols.
function machoType(file) {
  const fd = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(32);
    if (fs.readSync(fd, header, 0, 32, 0) < 16) return null;
    let magic = header.readUInt32BE(0);
    if (magic === 0xcafebabe || magic === 0xcafebabf) {
      const offset = magic === 0xcafebabe ? header.readUInt32BE(16) : Number(header.readBigUInt64BE(16));
      if (fs.readSync(fd, header, 0, 32, offset) < 16) return null;
      magic = header.readUInt32BE(0);
    }
    if ([0xfeedface, 0xfeedfacf].includes(magic)) return header.readUInt32BE(12);
    if ([0xcefaedfe, 0xcffaedfe].includes(magic)) return header.readUInt32LE(12);
    return null;
  } finally { fs.closeSync(fd); }
}

function inventory(root) {
  root = fs.realpathSync(root);
  const files = {}, symlinks = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      const name = path.relative(root, file).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        const resolved = fs.realpathSync(file);
        if (!resolved.startsWith(root + path.sep)) throw new Error(`Escaping runtime symlink: ${name}`);
        symlinks[name] = fs.readlinkSync(file);
      } else if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && name !== "runtime-manifest.json") files[name] = digest(file);
    }
  }
  walk(root);
  return { files, symlinks };
}

function verifyInput(resources, manifest) {
  for (const [name, hash] of Object.entries(manifest.files)) {
    const file = path.resolve(resources, name);
    if (!file.startsWith(resources + path.sep) || fs.lstatSync(file).isSymbolicLink() || digest(file) !== hash) {
      throw new Error(`Staged runtime hash mismatch: ${name}`);
    }
  }
  const actual = inventory(resources);
  for (const [name, target] of Object.entries(manifest.symlinks || {})) {
    if (actual.symlinks[name] !== target) throw new Error(`Staged runtime symlink mismatch: ${name}`);
  }
  // Electron resources are outside runtime/. Fail closed if native runtime
  // staging contains anything not accounted for by the upstream inventory.
  for (const name of [...Object.keys(actual.files), ...Object.keys(actual.symlinks)]) {
    if (name.startsWith("runtime/") && !(name in manifest.files) && !(name in (manifest.symlinks || {}))) {
      throw new Error(`Uninventoried runtime file: ${name}`);
    }
  }
}

async function signRuntime(context) {
  if (context.electronPlatformName !== "darwin") throw new Error("macOS signing hook used on another platform");
  const identity = process.env.DEPLOY_MAC_SIGN_IDENTITY;
  if (!identity || identity === "-") throw new Error("Developer ID identity required");
  const resources = path.resolve(context.appOutDir, `${context.packager.appInfo.productFilename}.app/Contents/Resources`);
  const manifestPath = path.join(resources, "runtime-manifest.json");
  const original = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(original);
  if (manifest.signing) throw new Error("Expected an unsigned staging manifest");
  verifyInput(resources, manifest);
  const native = Object.keys(manifest.files).filter(name => name.startsWith("runtime/") &&
    [2, 6, 8].includes(machoType(path.join(resources, name)))).sort();
  if (!native.length) throw new Error("No native runtime code found");
  for (const [index, name] of native.entries()) {
    const args = ["--force", "--timestamp", "--options", "runtime", "--sign", identity];
    if (name === "runtime/julia/bin/julia") {
      args.push("--entitlements", path.resolve(context.packager.projectDir, "../packaging/entitlements-julia.plist"));
    }
    console.log(`Signing runtime ${index + 1}/${native.length}: ${name}`);
    execFileSync("/usr/bin/codesign", [...args, path.join(resources, name)], { stdio: "pipe" });
    execFileSync("/usr/bin/codesign", ["--verify", "--strict", path.join(resources, name)], { stdio: "pipe" });
  }
  // Preserve exact upstream provenance, then record signed bytes before the
  // enclosing application is sealed. Never modify this inventory after signing.
  fs.writeFileSync(path.join(resources, "runtime-manifest-unsigned.json"), original);
  const final = inventory(resources);
  manifest.signing = { identity, native_files: native, source_runtime_id: manifest.runtime_id,
    source_manifest_sha256: crypto.createHash("sha256").update(original).digest("hex") };
  Object.assign(manifest, final);
  manifest.runtime_id = "mac-arm64-signed-" + crypto.createHash("sha256")
    .update(JSON.stringify(final)).digest("hex").slice(0, 16);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

module.exports = signRuntime;
module.exports.machoType = machoType;
module.exports.inventory = inventory;
module.exports.verifyInput = verifyInput;
