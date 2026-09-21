const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
module.exports = async (context) => {
  // electron-builder 26 signs EXEs in extraResources by default. Preserve vendor
  // signatures and Julia content-addressed artifact trees; sign only the application.
  context.packager.createTransformerForExtraFiles = () => null;
  const resources = join(context.packager.projectDir, "../build/resources");
  const manifest = JSON.parse(readFileSync(join(resources, "runtime-manifest.json"), "utf8"));
  if (manifest.schema_version !== 1 || !Object.keys(manifest.files).length) throw new Error("Invalid runtime manifest");
  for (const name of Object.keys(manifest.files)) {
    if (!existsSync(join(resources, name))) throw new Error(`Missing runtime resource: ${name}`);
  }
};
