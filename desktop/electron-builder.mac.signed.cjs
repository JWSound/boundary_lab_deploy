const base = require("./electron-builder.json");
const macBase = require("./electron-builder.mac.json");
const identity = process.env.DEPLOY_MAC_SIGN_IDENTITY;
if (!identity || identity === "-") throw new Error("Set DEPLOY_MAC_SIGN_IDENTITY to a Developer ID Application certificate fingerprint");

module.exports = {
  // Resolve parents here: electron-builder concatenates inherited resource arrays.
  ...base,
  ...macBase,
  extends: null,
  extraResources: [{ from: process.env.DEPLOY_RUNTIME_RESOURCES || "../build/resources", to: ".", filter: ["**/*"] }],
  forceCodeSigning: true,
  afterPack: "./electron/sign-runtime.cjs",
  mac: {
    ...macBase.mac,
    identity,
    type: "distribution",
    hardenedRuntime: true,
    preAutoEntitlements: false,
    entitlements: "../packaging/entitlements-electron.plist",
    entitlementsInherit: "../packaging/entitlements-electron.plist",
    // Runtime code is signed and inventoried by afterPack, before sealing the app.
    signIgnore: ["/Contents/Resources/runtime/"],
    notarize: false, // The release command notarizes the complete, signed DMG.
    artifactName: "Boundary-Lab-Deploy-${version}-mac-${arch}.${ext}",
  },
  dmg: { sign: true },
};
