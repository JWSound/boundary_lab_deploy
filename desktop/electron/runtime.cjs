const { existsSync, mkdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

function resolveRuntime({ packaged, resourcesPath, dataPath, repositoryRoot, env = process.env,
                          platform = process.platform, arch = process.arch }) {
  if (!packaged) {
    return {
      python: env.DEPLOY_PYTHON_EXE || env.BLAB_PYTHON_EXE || "python",
      cwd: repositoryRoot,
      env: { ...env },
    };
  }
  const runtime = join(resourcesPath, "runtime");
  const manifest = JSON.parse(readFileSync(join(resourcesPath, "runtime-manifest.json"), "utf8"));
  const target = manifest.platform || "win32";
  if (target !== platform || (manifest.arch && manifest.arch !== arch)) {
    throw new Error(`Installed solver runtime does not match ${platform}/${arch}`);
  }
  if (!["win32", "darwin"].includes(target)) throw new Error(`Unsupported runtime platform: ${target}`);
  const windows = target === "win32";
  const separator = windows ? ";" : ":";
  const python = windows ? join(runtime, "python", "python.exe") : join(runtime, "python", "bin", "python3");
  const julia = join(runtime, "julia", "bin", windows ? "julia.exe" : "julia");
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
    if (/^(PYTHON|JULIA|DEPLOY_|BLAB_|CUDA_PATH|CUDA_HOME|DYLD_|LD_LIBRARY_PATH)/i.test(key)) delete clean[key];
  }
  return {
    python,
    logFile: join(logs, "solver.log"),
    cwd: dataPath,
    env: {
      ...clean,
      DEPLOY_JULIA_EXE: julia,
      DEPLOY_JULIA_THREADS: "auto",
      JULIA_DEPOT_PATH: [join(cache, "julia-depot"), join(runtime, "julia-depot"), ""].join(separator),
      JULIA_LOAD_PATH: ["@", "@stdlib"].join(separator),
      JULIA_PKG_OFFLINE: "true",
      JULIA_PKG_PRECOMPILE_AUTO: "0",
      JULIA_NUM_PRECOMPILE_TASKS: "2",
      JULIA_CPU_TARGET: "generic",
      TEMP: temporary,
      TMP: temporary,
      TMPDIR: temporary,
    },
  };
}

module.exports = { resolveRuntime };
