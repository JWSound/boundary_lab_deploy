const path = require("node:path");
const base = require("./electron-builder.json");
const publisherName = process.env.DEPLOY_SIGNING_PUBLISHER?.trim();
if (!publisherName) throw new Error("Set DEPLOY_SIGNING_PUBLISHER to the exact certificate publisher name.");

module.exports = {
  ...base,
  forceCodeSigning: true,
  directories: {
    ...base.directories,
    output: process.env.DEPLOY_SIGNED_OUTPUT || "../release/azure-signed",
  },
  extraResources: base.extraResources.map(resource => ({
    ...resource,
    from: process.env.DEPLOY_RUNTIME_RESOURCES || resource.from,
  })),
  win: {
    ...base.win,
    signtoolOptions: {
      publisherName,
      signingHashAlgorithms: ["sha256"],
      sign: path.join(__dirname, "electron/sign-windows-azure.cjs"),
    },
  },
};
