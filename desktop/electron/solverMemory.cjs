const { totalmem } = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const GiB = 1024 ** 3;

function parseNvidiaMemory(output, visible = process.env.CUDA_VISIBLE_DEVICES) {
  let devices = output.trim().split(/\r?\n/).map(line => {
    const [index, uuid, mib] = line.split(",").map(value => value.trim());
    return { index, uuid, bytes: Number(mib) * 1024 ** 2 };
  }).filter(device => Number.isFinite(device.bytes) && device.bytes > 0);
  if (visible !== undefined) {
    const ids = visible.split(",").map(value => value.trim());
    devices = devices.filter(device => ids.includes(device.index) || ids.some(id => id.startsWith("GPU-") && device.uuid.startsWith(id)));
  }
  // Do not sum VRAM: a solve runs on one GPU. The smallest visible device is conservative.
  return devices.length ? { bytes: Math.min(...devices.map(device => device.bytes)), multiple: devices.length > 1 } : null;
}
async function detectMemory(backend, run = execute) {
  const hardware = { ram: totalmem(), gpu: null };
  if (backend === "cuda") {
    try {
      const { stdout } = await run("nvidia-smi", ["--query-gpu=index,uuid,memory.total", "--format=csv,noheader,nounits"],
        { windowsHide: true, timeout: 4000, maxBuffer: 65536 });
      hardware.gpu = parseNvidiaMemory(stdout);
    } catch { /* Keep RAM checking available when the NVIDIA query is unavailable. */ }
  }
  return hardware;
}
function validateRequest(request) {
  if (!request || !["cpu", "cuda", "metal", "rocm"].includes(request.backend) || !["boundary", "coupled"].includes(request.fidelity) ||
      ![request.systemUpper, request.gpuUpper].every(value => Number.isFinite(value) && value >= 0)) throw Error("Invalid solver memory estimate.");
}
function memoryWarnings(request, hardware) {
  const warnings = [];
  const format = value => `${(value / GiB).toFixed(1)} GiB`;
  if (request.systemUpper > hardware.ram) warnings.push(`${request.backend === "metal" ? "Unified memory" : "RAM"}: estimated up to ${format(request.systemUpper)}; installed ${format(hardware.ram)}.`);
  if (["cuda", "rocm"].includes(request.backend) && hardware.gpu && request.gpuUpper > hardware.gpu.bytes) {
    warnings.push(`GPU memory: estimated up to ${format(request.gpuUpper)}; capacity ${format(hardware.gpu.bytes)}${hardware.gpu.multiple ? " (smallest visible NVIDIA GPU)" : ""}.`);
  }
  return warnings;
}
class SolverMemoryGuard {
  constructor(detect = detectMemory) { this.detect = detect; this.hardware = new Map(); this.approved = new Map(); this.pending = new Map(); }
  forget(owner) {
    for (const key of this.approved.keys()) if (key.startsWith(`${owner}:`)) this.approved.delete(key);
  }
  async check(owner, request, show) {
    validateRequest(request);
    const key = `${owner}:${request.backend}:${request.fidelity}`;
    if (this.pending.has(key)) {
      if (!await this.pending.get(key)) return false;
      return this.check(owner, request, show);
    }
    const task = this.perform(key, request, show);
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }
  async perform(key, request, show) {
    if (!this.hardware.has(request.backend)) this.hardware.set(request.backend, this.detect(request.backend));
    const hardware = await this.hardware.get(request.backend);
    const warnings = memoryWarnings(request, hardware);
    if (!warnings.length) return true;
    const approved = this.approved.get(key);
    if (approved && request.systemUpper <= approved.systemUpper && request.gpuUpper <= approved.gpuUpper) return true;
    const response = await show({ type: "warning", title: "Estimated solver memory exceeds capacity",
      message: "This scene may require more memory than this computer has.",
      detail: warnings.join("\n") + "\n\nThese estimates are approximate and exclude application overhead. Continuing may fail or make the computer unresponsive. Reduce scene complexity or continue anyway."
        + (["cuda", "rocm"].includes(request.backend) && !hardware.gpu ? "\n\nGPU capacity could not be detected; only RAM was checked." : ""),
      buttons: ["Cancel", "Continue anyway"], defaultId: 0, cancelId: 0, noLink: true });
    if (response.response !== 1) return false;
    this.approved.set(key, { systemUpper: request.systemUpper, gpuUpper: request.gpuUpper });
    return true;
  }
}
module.exports = { parseNvidiaMemory, detectMemory, memoryWarnings, SolverMemoryGuard };
