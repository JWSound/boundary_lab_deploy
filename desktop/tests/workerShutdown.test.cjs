const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { DeployWorkerClient } = require("../electron/workerClient.cjs");

test("Unix shutdown terminates the worker process group", { skip: process.platform === "win32", timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ["-e", `
    const { spawn } = require('node:child_process');
    const solver = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    solver.on('exit', () => process.exit(0));
    process.on('SIGTERM', () => {});
    console.log(solver.pid);
    setInterval(() => {}, 1000);
  `], { detached: true });
  let solverPid;
  try {
    const [data] = await once(child.stdout, "data");
    solverPid = Number(data.toString().trim());
    assert.ok(solverPid > 0);
    const exited = once(child, "exit");
    const client = new DeployWorkerClient(() => ({}));
    client.process = child;
    client.close();
    await exited;
    assert.throws(() => process.kill(solverPid, 0), { code: "ESRCH" });
    assert.equal(client.process, null);
    client.close();
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
});

test("Windows shutdown terminates the worker and its solver descendant", { skip: process.platform !== "win32", timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ["-e", `
    const { spawn } = require('node:child_process');
    const solver = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true });
    console.log(solver.pid);
    setInterval(() => {}, 1000);
  `], { windowsHide: true });
  let solverPid;
  try {
    const [data] = await once(child.stdout, "data");
    solverPid = Number(data.toString().trim());
    assert.ok(solverPid > 0);
    process.kill(solverPid, 0);
    const exited = once(child, "exit");
    const client = new DeployWorkerClient(() => ({}));
    client.process = child;
    client.close();
    await exited;
    assert.throws(() => process.kill(solverPid, 0), { code: "ESRCH" });
    assert.equal(client.process, null);
    client.close();
  } finally {
    for (const pid of [child.pid, solverPid].filter(Boolean)) {
      try { process.kill(pid, 0); spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }); } catch {}
    }
  }
});
