const { appendFileSync, existsSync, statSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { join } = require("node:path");
const { performance } = require("node:perf_hooks");

class DeployWorkerClient {
  constructor(runtimeOptions, onFirstInitialization = () => {}) {
    this.runtimeOptions = runtimeOptions;
    this.onFirstInitialization = onFirstInitialization;
    this.initializationNotices = new Set();
    this.initializationCache = null;
    this.process = null;
    this.stdoutBuffer = "";
    this.pending = new Map();
    this.nextId = 1;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.warming = false;
  }

  initializationMarker(backend) {
    return this.initializationCache && ["cpu", "cuda", "metal"].includes(backend)
      ? join(this.initializationCache, `initialized-${backend}.json`) : null;
  }

  beginInitialization(backend, sender) {
    const marker = this.initializationMarker(backend);
    if (!marker || existsSync(marker)) return;
    if (sender && !sender.isDestroyed()) {
      sender.send("deploy:solve-status", {
        type: "status", message: `Preparing the ${backend.toUpperCase()} solver for first use. This may take several minutes.`,
      });
    }
    if (this.initializationNotices.has(marker)) return;
    this.initializationNotices.add(marker);
    // The dialog is informational; neither dismissal nor display failure blocks setup.
    try {
      Promise.resolve(this.onFirstInitialization(backend)).catch(error => console.error("Solver initialization notice failed", error));
    } catch (error) { console.error("Solver initialization notice failed", error); }
  }

  completeInitialization(backend) {
    const marker = this.initializationMarker(backend);
    if (!marker || existsSync(marker)) return;
    try { writeFileSync(marker, JSON.stringify({ completedAt: new Date().toISOString() }) + "\n"); }
    catch (error) { console.error("Could not remember solver initialization", error); }
  }

  ensureStarted() {
    if (this.process && this.readyPromise) return this.readyPromise;
    const runtime = this.runtimeOptions();
    this.initializationCache = runtime.initializationCache;
    if (runtime.logFile && existsSync(runtime.logFile) && statSync(runtime.logFile).size > 5 * 1024 * 1024) {
      const previous = runtime.logFile + ".previous";
      rmSync(previous, { force: true });
      renameSync(runtime.logFile, previous);
    }
    this.stdoutBuffer = "";
    let stderrTail = "";
    const child = spawn(runtime.python, ["-I", "-B", "-X", "utf8", "-m", "boundary_deploy.worker"], {
      cwd: runtime.cwd,
      env: runtime.env,
      windowsHide: true,
      // Give the Unix worker and Julia descendants their own process group so
      // closing the application cannot leave a solver running in the background.
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { if (this.process === child) this.consumeStdout(chunk); });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-8192);
      const message = chunk.trim();
      if (message) {
        console.error(`Deploy solve worker: ${message}`);
        if (runtime.logFile) appendFileSync(runtime.logFile, `${new Date().toISOString()} ${message}\n`);
      }
    });
    child.once("error", (error) => {
      if (this.process === child) this.handleExit(new Error(`Could not start Deploy solve worker with ${runtime.python}: ${error.message}`));
    });
    // close follows stderr drainage; exit can arrive before the final traceback.
    child.once("close", (code, signal) => {
      if (this.process !== child) return;
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      const detail = stderrTail.trim();
      this.handleExit(new Error(`Deploy solve worker exited with ${reason}. Interpreter: ${runtime.python}${detail ? `\n${detail}` : ""}`));
    });
    return this.readyPromise;
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        const parseStarted = performance.now();
        try {
          const message = JSON.parse(line);
          this.handleMessage(message, {
            jsonParseMs: performance.now() - parseStarted,
            stdoutBytes: Buffer.byteLength(line, "utf8"),
          });
        } catch (error) {
          console.error("Invalid Deploy solve worker response", error, line);
        }
      }
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  handleMessage(message, transport = {}) {
    if (message.type === "ready") {
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    const job = this.pending.get(message.id);
    if (!job) return;
    if (message.type === "status" || message.type === "initialized") {
      if (job.sender && !job.sender.isDestroyed()) job.sender.send("deploy:solve-status", message);
    } else if (message.type === "microphone-progress") {
      if (job.sender && !job.sender.isDestroyed()) job.sender.send("deploy:microphone-sweep-progress", message);
    } else if (message.type === "result") {
      job.result = message.result;
      job.resultTransport = transport;
    } else if (message.type === "profile") {
      job.workerProfile = message.metrics;
    } else if (message.type === "completed") {
      this.pending.delete(message.id);
      if (job.kind === "warmup" || (job.result && (job.kind !== "backend" || job.result.backend === job.backend))) {
        this.completeInitialization(job.backend);
      }
      if (job.kind === "warmup" || job.kind === "cancel") {
        job.resolve(job.kind === "cancel" ? Boolean(message.cancelled) : undefined);
        return;
      }
      if (job.kind === "backend") { job.resolve(job.result); return; }
      if (job.result) {
        job.result.pipeline = {
          ...(job.result.pipeline || {}),
          ...(job.workerProfile || {}),
          electron_worker_ready_wait_s: job.workerReadyWaitMs / 1000,
          electron_request_json_encode_s: job.requestJsonEncodeMs / 1000,
          electron_python_stdin_bytes: job.requestBytes,
          electron_worker_result_json_parse_s: (job.resultTransport?.jsonParseMs || 0) / 1000,
          python_electron_stdout_bytes: job.resultTransport?.stdoutBytes || 0,
          electron_worker_roundtrip_s: (performance.now() - job.startedAt) / 1000,
        };
        job.resolve(job.result);
      }
      else job.reject(new Error(`${job.kind === "microphone-sweep" ? "Microphone sweep" : "Level 2 solve"} completed without returning a field.`));
    } else if (message.type === "cancelled") {
      this.pending.delete(message.id);
      if (job.kind === "microphone-sweep") {
        job.resolve({
          cancelled: true,
          frequencies_hz: [],
          microphone_ids: [],
          spl_db: [],
          pressure: { real: [], imag: [] },
          completed_count: Number(message.completed_count || 0),
          total_count: 0,
        });
      } else {
        job.reject(new Error("Level 2 solve was cancelled."));
      }
    } else if (message.type === "failed") {
      this.pending.delete(message.id);
      job.reject(new Error(message.error || "Level 2 solve failed."));
    }
  }

  handleExit(error) {
    this.rejectReady?.(error);
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
    this.process = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
  }

  async solve(payload, sender, kind = "solve", operation = "solve") {
    const invokedAt = performance.now();
    if (this.warming && sender && !sender.isDestroyed()) {
      sender.send("deploy:solve-status", { type: "status", message: "Waiting for BEAT solver warmup" });
    }
    await this.ensureStarted();
    // Backend detection starts Julia too, before the explicit background warmup.
    const backend = kind === "backend" ? (process.platform === "darwin" ? "metal" : "cuda") : payload.backend;
    this.beginInitialization(backend, sender);
    const workerReadyWaitMs = performance.now() - invokedAt;
    if (!this.process?.stdin.writable) throw new Error("Deploy solve worker is unavailable.");
    const id = this.nextId++;
    const encodeStarted = performance.now();
    const request = `${JSON.stringify({ id, operation, payload })}\n`;
    const requestJsonEncodeMs = performance.now() - encodeStarted;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        kind,
        backend,
        resolve,
        reject,
        sender,
        result: null,
        workerProfile: null,
        resultTransport: null,
        startedAt: invokedAt,
        workerReadyWaitMs,
        requestJsonEncodeMs,
        requestBytes: Buffer.byteLength(request, "utf8"),
      });
      this.process.stdin.write(request);
    });
  }

  async microphoneSweep(payload, sender) {
    return this.solve(payload, sender, "microphone-sweep", "microphone_sweep");
  }

  async cancelMicrophoneSweep() {
    await this.ensureStarted();
    if (!this.process?.stdin.writable) throw new Error("Deploy solve worker is unavailable.");
    const active = [...this.pending.entries()].find(([, job]) => job.kind === "microphone-sweep");
    if (!active) return false;
    const [targetId] = active;
    const id = this.nextId++;
    const request = `${JSON.stringify({ id, operation: "cancel", target_id: targetId })}\n`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { kind: "cancel", resolve, reject, sender: null, result: null });
      this.process.stdin.write(request);
    });
  }

  async warmup(backend = "cuda") {
    this.warming = true;
    try {
      await this.ensureStarted();
      this.beginInitialization(backend);
      if (!this.process?.stdin.writable) throw new Error("Deploy solve worker is unavailable.");
      const id = this.nextId++;
      const request = `${JSON.stringify({ id, operation: "warmup", backend })}\n`;
      return await new Promise((resolve, reject) => {
        this.pending.set(id, {
          kind: "warmup",
          backend,
          resolve,
          reject,
          sender: null,
          result: null,
        });
        this.process.stdin.write(request);
      });
    } finally {
      this.warming = false;
    }
  }

  close() {
    if (this.process && !this.process.killed) {
      // Windows SIGTERM kills Python without running its Julia cleanup. Kill the
      // tree while its parent is still alive, including an in-flight CUDA probe.
      if (process.platform === "win32") {
        const result = spawnSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
          ["/PID", String(this.process.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 });
        if (result.error) console.error("Deploy worker tree cleanup failed", result.error);
      } else {
        try { process.kill(-this.process.pid, "SIGTERM"); }
        catch (error) { if (error.code !== "ESRCH") console.error("Deploy worker tree cleanup failed", error); }
      }
      this.process.kill();
    }
    this.handleExit(new Error("Deploy solve worker closed."));
  }
}

module.exports = { DeployWorkerClient };
