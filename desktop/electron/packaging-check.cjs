const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { isDeepStrictEqual } = require("node:util");
module.exports = async (context) => {
  // electron-builder 26 signs EXEs in extraResources by default. Preserve vendor
  // signatures and Julia content-addressed artifact trees; sign only the application.
  context.packager.createTransformerForExtraFiles = () => null;
  const resources = join(context.packager.projectDir, "../build/resources");
  const manifest = JSON.parse(readFileSync(join(resources, "runtime-manifest.json"), "utf8"));
  if (manifest.schema_version !== 1 || !Object.keys(manifest.files).length) throw new Error("Invalid runtime manifest");
  const lock = JSON.parse(readFileSync(join(context.packager.projectDir, "../packaging/runtime-lock.json"), "utf8"));
  if (!isDeepStrictEqual(manifest.components, lock)) {
    throw new Error("Bundled runtime is stale: rebuild it using the current runtime-lock.json");
  }
  const version = JSON.parse(readFileSync(join(context.packager.projectDir, "package.json"), "utf8")).version;
  const pythonVersion = version.replace(/-rc\.(\d+)$/, "rc$1");
  if (!Object.hasOwn(manifest.wheels || {}, `boundary_lab_deploy-${pythonVersion}-py3-none-any.whl`)) {
    throw new Error("Bundled application wheel version differs from the desktop version");
  }
  for (const name of Object.keys(manifest.files)) {
    if (!existsSync(join(resources, name))) throw new Error(`Missing runtime resource: ${name}`);
  }
};
