const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function fixture(runtime = {}, onFirstInitialization) {
  const children = [];
  const module = { exports: {} };
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
    child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
    child.stdin = { writable: true, write() {} };
    children.push(child);
    return child;
  };
  vm.runInNewContext(readFileSync(join(__dirname, '../electron/workerClient.cjs'), 'utf8'), {
    module, require: name => name === 'node:child_process' ? { spawn } : require(name),
    process, Buffer, console: { error() {} },
  });
  return { children, client: new module.exports.DeployWorkerClient(() => ({ python: 'fixture-python', cwd: '.', env: {}, ...runtime }), onFirstInitialization) };
}
test('worker startup failure retains stderr emitted after exit and allows a clean retry', async () => {
  const { children, client } = fixture();
  const ready = assert.rejects(client.ensureStarted(), /Interpreter: fixture-python\nModuleNotFoundError: No module named 'boundary_deploy'/);
  const child = children[0];
  child.emit('exit', 1);
  child.stderr.emit('data', "ModuleNotFoundError: No module named 'boundary_deploy'\n");
  child.emit('close', 1);
  await ready;
  assert.equal(client.pending.size, 0);
  const retry = client.ensureStarted();
  children[1].stdout.emit('data', '{"type":"ready"}\n');
  await retry;
});
test('running jobs receive bounded crash details and partial stdout is cleared on restart', async () => {
  const { children, client } = fixture();
  const ready = client.ensureStarted();
  children[0].stdout.emit('data', '{"type":"ready"}\n');
  await ready;
  const request = client.solve({}, null);
  const failed = assert.rejects(request, error => error.message.includes('Fatal solver failure') && error.message.length < 8500);
  await Promise.resolve();
  children[0].stdout.emit('data', '{"unfinished":');
  children[0].stderr.emit('data', 'x'.repeat(12000) + '\nFatal solver failure');
  children[0].emit('close', 1);
  await failed;
  const retry = client.ensureStarted();
  children[1].stdout.emit('data', '{"type":"ready"}\n');
  await retry;
});
test('an old process cannot clear a restarted worker after a spawn failure', async () => {
  const { children, client } = fixture();
  const failed = assert.rejects(client.ensureStarted(), /Could not start.*fixture-python.*ENOENT/);
  children[0].emit('error', new Error('ENOENT'));
  await failed;
  const ready = client.ensureStarted();
  children[0].emit('close', -2);
  children[1].stdout.emit('data', '{"type":"ready"}\n');
  await ready;
  assert.equal(client.process, children[1]);
});


const fs = require('node:fs');
const os = require('node:os');
function initializationFixture(t) {
  const cache = fs.mkdtempSync(join(os.tmpdir(), 'deploy-initialization-'));
  t.after(() => fs.rmSync(cache, { recursive: true, force: true }));
  const notices = [];
  const setup = () => fixture({ initializationCache: cache }, backend => {
    notices.push(backend);
    return new Promise(() => {}); // Dismissing the notice must not gate warmup.
  });
  return { cache, notices, setup };
}
async function startWarmup(client, children, backend = 'cuda') {
  const completed = client.warmup(backend);
  children.at(-1).stdout.emit('data', '{"type":"ready"}\n');
  await Promise.resolve();
  return { completed, id: [...client.pending.keys()].at(-1) };
}

test('first-use notice does not block warmup and success is remembered per backend', async t => {
  const { cache, notices, setup } = initializationFixture(t);
  const { client, children } = setup();
  const first = await startWarmup(client, children);
  assert.deepEqual(notices, ['cuda']);
  assert.equal(fs.existsSync(join(cache, 'initialized-cuda.json')), false);
  const statuses = [];
  const solve = client.solve({ backend: 'cuda' }, { isDestroyed: () => false, send: (_channel, value) => statuses.push(value) });
  await Promise.resolve();
  assert.match(statuses.at(-1).message, /first use.*several minutes/);
  assert.deepEqual(notices, ['cuda']);
  client.handleMessage({ type: 'completed', id: first.id });
  await first.completed;
  assert.equal(fs.existsSync(join(cache, 'initialized-cuda.json')), true);
  const solveId = [...client.pending.keys()][0];
  client.handleMessage({ type: 'result', id: solveId, result: {} });
  client.handleMessage({ type: 'completed', id: solveId });
  await solve;
  const restarted = setup();
  const second = await startWarmup(restarted.client, restarted.children);
  assert.deepEqual(notices, ['cuda']);
  restarted.client.handleMessage({ type: 'completed', id: second.id });
  await second.completed;
  const cpu = await startWarmup(restarted.client, restarted.children, 'cpu');
  assert.deepEqual(notices, ['cuda', 'cpu']);
  restarted.client.handleMessage({ type: 'completed', id: cpu.id });
  await cpu.completed;
});

test('failed warmup is not recorded and next launch explains first-time setup again', async t => {
  const { cache, notices, setup } = initializationFixture(t);
  const first = setup();
  const job = await startWarmup(first.client, first.children);
  const rejected = assert.rejects(job.completed, /No CUDA driver/);
  first.client.handleMessage({ type: 'failed', id: job.id, error: 'No CUDA driver' });
  await rejected;
  assert.equal(fs.existsSync(join(cache, 'initialized-cuda.json')), false);
  const next = setup();
  const retry = await startWarmup(next.client, next.children);
  assert.deepEqual(notices, ['cuda', 'cuda']);
  next.client.handleMessage({ type: 'completed', id: retry.id });
  await retry.completed;
});

test('development warmup does not show an installation notice', async () => {
  const { client, children } = fixture({}, () => assert.fail('Unexpected notice'));
  const job = await startWarmup(client, children);
  client.handleMessage({ type: 'completed', id: job.id });
  await job.completed;
});


test('automatic GPU detection explains compilation before warmup and does not certify a failed probe', async t => {
  const { cache, notices, setup } = initializationFixture(t);
  const { client, children } = setup();
  const detected = client.solve({}, null, 'backend', 'detect_backend');
  children[0].stdout.emit('data', '{"type":"ready"}\n');
  await Promise.resolve();
  const gpu = process.platform === 'darwin' ? 'metal' : 'cuda';
  assert.deepEqual(notices, [gpu]);
  const id = [...client.pending.keys()][0];
  client.handleMessage({ type: 'result', id, result: { backend: 'cpu' } });
  client.handleMessage({ type: 'completed', id });
  assert.equal((await detected).backend, 'cpu');
  assert.equal(fs.existsSync(join(cache, `initialized-${gpu}.json`)), false);
});
