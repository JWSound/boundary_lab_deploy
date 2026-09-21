const { existsSync, mkdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

function resolveRuntime({ packaged, resourcesPath, dataPath, repositoryRoot, env = process.env }) {
  if (!packaged) {
    return {
      python: env.DEPLOY_PYTHON_EXE || env.BLAB_PYTHON_EXE || "python",
      cwd: repositoryRoot,
      env: { ...env },
    };
  }
  const runtime = join(resourcesPath, "runtime");
  const manifest = JSON.parse(readFileSync(join(resourcesPath, "runtime-manifest.json"), "utf8"));
  const python = join(runtime, "python", "python.exe");
  const julia = join(runtime, "julia", "bin", "julia.exe");
  for (const path of [python, julia]) {
    if (!existsSync(path)) throw new Error(`Installed solver runtime is incomplete: ${path}`);
  }
  const cache = join(dataPath, "runtime", manifest.runtime_id);
  const temporary = join(dataPath, "tmp");
  const logs = join(dataPath, "logs");
  for (const path of [cache, temporary, logs]) mkdirSync(path, { recursive: true });
  const clean = { ...env };
  // Installed releases never inherit a developer's interpreter, depot or engine overrides.
  for (const key of Object.keys(clean)) {
    if (/^(PYTHON|JULIA|DEPLOY_|BLAB_|CUDA_PATH|CUDA_HOME)/i.test(key)) delete clean[key];
  }
  return {
    python,
    logFile: join(logs, "solver.log"),
    cwd: dataPath,
    env: {
      ...clean,
      DEPLOY_JULIA_EXE: julia,
      DEPLOY_JULIA_THREADS: "auto",
      JULIA_DEPOT_PATH: `${join(cache, "julia-depot")};${join(runtime, "julia-depot")};`,
      JULIA_LOAD_PATH: "@;@stdlib",
      JULIA_PKG_OFFLINE: "true",
      JULIA_PKG_PRECOMPILE_AUTO: "0",
      JULIA_NUM_PRECOMPILE_TASKS: "2",
      JULIA_CPU_TARGET: "generic",
      TEMP: temporary,
      TMP: temporary,
    },
  };
}

module.exports = { resolveRuntime };
