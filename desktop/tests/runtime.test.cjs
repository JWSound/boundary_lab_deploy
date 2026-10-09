const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveRuntime } = require("../electron/runtime.cjs");
test("bundled runtime ignores development overrides and separates writable files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-runtime-"));
  try {
    for (const file of ["runtime/python/python.exe", "runtime/julia/bin/julia.exe"]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "");
    }
    fs.writeFileSync(path.join(root, "runtime-manifest.json"), JSON.stringify({ runtime_id: "test" }));
    const dataPath = path.join(root, "User Data");
    const config = resolveRuntime({ packaged: true, resourcesPath: root, dataPath, platform: "win32", arch: "x64",
      env: { PATH: "system", PYTHONPATH: "bad", JULIA_DEPOT_PATH: "bad", JULIA_PROJECT: "bad",
             DEPLOY_PYTHON_EXE: "bad", DEPLOY_JULIA_EXE: "bad", BLAB_JULIA_EXE: "bad" } });
    assert.equal(config.python, path.join(root, "runtime/python/python.exe"));
    assert.equal(config.env.PYTHONPATH, undefined);
    assert.equal(config.env.JULIA_PROJECT, undefined);
    assert.equal(config.env.BLAB_JULIA_EXE, undefined);
    assert.equal(config.env.JULIA_PKG_OFFLINE, "true");
    assert.ok(config.env.JULIA_DEPOT_PATH.startsWith(dataPath));
    assert.ok(config.env.TEMP.startsWith(dataPath));
    assert.equal(config.cwd, dataPath);
    assert.equal(config.initializationCache, path.join(dataPath, "runtime", "test"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("development keeps explicit executable selection", () => {
  const config = resolveRuntime({ packaged: false, repositoryRoot: "repo",
    env: { DEPLOY_PYTHON_EXE: "chosen-python" } });
  assert.equal(config.python, "chosen-python");
  assert.equal(config.cwd, "repo");
});
const packagingCheck = require("../electron/packaging-check.cjs");

test("packaging rejects a stale runtime or mismatched application wheel", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-packaging-"));
  const projectDir = path.join(root, "desktop");
  const resources = path.join(root, "build/resources");
  try {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(resources, { recursive: true });
    fs.mkdirSync(path.join(root, "packaging"));
    const lock = { beat_requirement: "released-engine", python: { version: "3.13" } };
    fs.writeFileSync(path.join(root, "packaging/runtime-lock.json"), JSON.stringify(lock));
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ version: "0.1.0" }));
    fs.writeFileSync(path.join(resources, "payload"), "runtime");
    const manifest = { schema_version: 1, files: { payload: "hash" }, components: lock,
      wheels: { "boundary_lab_deploy-0.1.0-py3-none-any.whl": "hash" } };
    const write = () => fs.writeFileSync(path.join(resources, "runtime-manifest.json"), JSON.stringify(manifest));
    const context = { packager: { projectDir }, electronPlatformName: "win32", arch: 1 };
    write();
    await packagingCheck(context);
    assert.equal(context.packager.createTransformerForExtraFiles(), null);
    manifest.components = { ...lock, beat_requirement: "old-engine" };
    write();
    await assert.rejects(packagingCheck(context), /runtime is stale/);
    manifest.components = lock;
    manifest.wheels = { "boundary_lab_deploy-0.0.1-py3-none-any.whl": "hash" };
    write();
    await assert.rejects(packagingCheck(context), /wheel version differs/);
    manifest.wheels = { "boundary_lab_deploy-0.1.0-py3-none-any.whl": "hash" };
    manifest.platform = "darwin";
    manifest.arch = "arm64";
    write();
    await assert.rejects(packagingCheck(context), /platform differs/);
    context.electronPlatformName = "darwin";
    await assert.rejects(packagingCheck(context), /architecture differs/);
    context.arch = 3;
    await packagingCheck(context);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("macOS runtime uses native paths, isolated overrides and a writable depot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-mac-runtime-"));
  try {
    for (const file of ["runtime/python/bin/python3", "runtime/julia/bin/julia"]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "");
    }
    fs.writeFileSync(path.join(root, "runtime-manifest.json"), JSON.stringify({
      platform: "darwin", arch: "arm64", runtime_id: "mac-test",
    }));
    const options = { packaged: true, resourcesPath: root, dataPath: path.join(root, "User Data"),
      platform: "darwin", arch: "arm64", env: { PYTHONHOME: "bad", DYLD_LIBRARY_PATH: "bad", JULIA_PROJECT: "bad" } };
    const config = resolveRuntime(options);
    assert.equal(config.python, path.join(root, "runtime/python/bin/python3"));
    assert.equal(config.env.DEPLOY_JULIA_EXE, path.join(root, "runtime/julia/bin/julia"));
    assert.equal(config.env.JULIA_LOAD_PATH, "@:@stdlib");
    assert.equal(config.env.JULIA_DEPOT_PATH, [path.join(options.dataPath, "runtime/mac-test/julia-depot"),
      path.join(root, "runtime/julia-depot"), ""].join(":"));
    assert.equal(config.env.PYTHONHOME, undefined);
    assert.equal(config.env.DYLD_LIBRARY_PATH, undefined);
    assert.equal(config.env.JULIA_PROJECT, undefined);
    assert.ok(config.env.TMPDIR.startsWith(options.dataPath));
    assert.throws(() => resolveRuntime({ ...options, arch: "x64" }), /does not match/);
    assert.throws(() => resolveRuntime({ ...options, platform: "win32" }), /does not match/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("development prefers the repository virtual environment on macOS and Windows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-dev-runtime-"));
  try {
    for (const [platform, suffix] of [["darwin", ["bin", "python"]], ["win32", ["Scripts", "python.exe"]]]) {
      const python = path.join(root, ".venv", ...suffix);
      fs.mkdirSync(path.dirname(python), { recursive: true });
      fs.writeFileSync(python, "");
      const options = { packaged: false, repositoryRoot: root, platform, env: {} };
      assert.equal(resolveRuntime(options).python, python);
      assert.equal(resolveRuntime({ ...options, env: { DEPLOY_PYTHON_EXE: "explicit" } }).python, "explicit");
      assert.equal(resolveRuntime({ ...options, env: { BLAB_PYTHON_EXE: "legacy" } }).python, "legacy");
    }
    assert.equal(resolveRuntime({ packaged: false, repositoryRoot: path.join(root, "no-venv"), env: {} }).python, "python");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
