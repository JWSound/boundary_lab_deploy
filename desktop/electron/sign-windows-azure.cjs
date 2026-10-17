const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

module.exports = async function signWindowsAzure(configuration) {
  const signtool = process.env.DEPLOY_SIGNTOOL_EXE;
  const dlib = process.env.DEPLOY_AZURE_DLIB;
  for (const [name, value] of Object.entries({ DEPLOY_SIGNTOOL_EXE: signtool, DEPLOY_AZURE_DLIB: dlib })) {
    if (!value || !existsSync(value)) throw new Error(`Set ${name} to the installed x64 signing tool path.`);
  }
  if (configuration.hash !== "sha256") throw new Error("Azure signing requires SHA-256.");
  const metadataFile = process.env.DEPLOY_AZURE_METADATA;
  if (!metadataFile || !existsSync(metadataFile)) {
    throw new Error("Set DEPLOY_AZURE_METADATA to your Azure signing metadata JSON file.");
  }
  const metadata = path.resolve(metadataFile);
  execFileSync(signtool, [
    "sign", "/fd", "SHA256", "/tr", "http://timestamp.acs.microsoft.com", "/td", "SHA256",
    "/dlib", dlib, "/dmdf", metadata, configuration.path,
  ], { stdio: "inherit", windowsHide: true });
  execFileSync(signtool, ["verify", "/pa", "/all", configuration.path], {
    stdio: "inherit", windowsHide: true,
  });
};
