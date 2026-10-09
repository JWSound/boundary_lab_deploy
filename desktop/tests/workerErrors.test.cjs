const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function fixture() {
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
  return { children, client: new module.exports.DeployWorkerClient(() => ({ python: 'fixture-python', cwd: '.', env: {} })) };
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
