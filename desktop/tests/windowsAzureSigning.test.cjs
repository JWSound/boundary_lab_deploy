const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function signer(run, env = { DEPLOY_SIGNTOOL_EXE: "signtool.exe", DEPLOY_AZURE_DLIB: "client.dll", DEPLOY_AZURE_METADATA: "signing metadata.json" }) {
  const filename = path.resolve(__dirname, "../electron/sign-windows-azure.cjs");
  const context = {
    module: { exports: {} },
    __dirname: path.dirname(filename),
    process: { env },
    require(name) {
      if (name === "node:child_process") return { execFileSync: run };
      if (name === "node:fs") return { existsSync: () => true };
      return require(name);
    },
  };
  vm.runInNewContext(readFileSync(filename, "utf8"), context, { filename });
  return context.module.exports;
}

test("signs with SHA-256 and timestamp, then verifies the same file", async () => {
  const calls = [];
  const file = "C:\\Release With Spaces\\Boundary Lab Deploy.exe";
  await signer((tool, args) => calls.push({ tool, args: Array.from(args) }))({ path: file, hash: "sha256" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool, "signtool.exe");
  assert.deepEqual(calls[0].args.slice(0, 7), ["sign", "/fd", "SHA256", "/tr", "http://timestamp.acs.microsoft.com", "/td", "SHA256"]);
  assert.equal(calls[0].args.at(-1), file);
  assert.equal(calls[0].args[calls[0].args.indexOf("/dmdf") + 1], path.resolve("signing metadata.json"));
  assert.deepEqual(calls[1].args, ["verify", "/pa", "/all", file]);
});

test("fails closed on missing tools, signing failures, and verification failures", async () => {
  await assert.rejects(signer(() => assert.fail("must not execute"), {})({ hash: "sha256" }), /DEPLOY_SIGNTOOL_EXE/);
  await assert.rejects(signer(() => assert.fail("must not execute"))({ hash: "sha1" }), /SHA-256/);
  await assert.rejects(signer(() => assert.fail("must not execute"), {
    DEPLOY_SIGNTOOL_EXE: "signtool.exe", DEPLOY_AZURE_DLIB: "client.dll",
  })({ hash: "sha256" }), /DEPLOY_AZURE_METADATA/);
  await assert.rejects(signer(() => { throw new Error("signing denied"); })({ path: "app.exe", hash: "sha256" }), /signing denied/);
  await assert.rejects(signer((_tool, args) => {
    if (args[0] === "verify") throw new Error("invalid signature");
  })({ path: "app.exe", hash: "sha256" }), /invalid signature/);
});

function azureConfig(env) {
  const filename = path.resolve(__dirname, "../electron-builder.win.azure.cjs");
  const context = {
    module: { exports: {} },
    __dirname: path.dirname(filename),
    process: { env },
    require(name) {
      return name === "./electron-builder.json" ? require("../electron-builder.json") : require(name);
    },
  };
  vm.runInNewContext(readFileSync(filename, "utf8"), context, { filename });
  return context.module.exports;
}

test("requires a configured publisher and keeps unsigned configuration unchanged", () => {
  assert.throws(() => azureConfig({}), /DEPLOY_SIGNING_PUBLISHER/);
  assert.throws(() => azureConfig({ DEPLOY_SIGNING_PUBLISHER: " " }), /DEPLOY_SIGNING_PUBLISHER/);
  const base = require("../electron-builder.json");
  const before = JSON.stringify(base);
  const config = azureConfig({
    DEPLOY_SIGNING_PUBLISHER: "Example Publisher",
    DEPLOY_RUNTIME_RESOURCES: "/custom/runtime",
    DEPLOY_SIGNED_OUTPUT: "/custom/output",
  });
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.win.signtoolOptions.publisherName, "Example Publisher");
  assert.equal(config.extraResources[0].from, "/custom/runtime");
  assert.equal(config.directories.output, "/custom/output");
  assert.equal(JSON.stringify(base), before);
  const defaults = azureConfig({ DEPLOY_SIGNING_PUBLISHER: "Example Publisher" });
  assert.equal(defaults.extraResources[0].from, base.extraResources[0].from);
  assert.equal(defaults.directories.output, "../release/azure-signed");
});
