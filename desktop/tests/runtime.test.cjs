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
    const config = resolveRuntime({ packaged: true, resourcesPath: root, dataPath,
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
    const context = { packager: { projectDir } };
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
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
