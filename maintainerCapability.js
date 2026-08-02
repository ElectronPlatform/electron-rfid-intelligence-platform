"use strict";

const CAPABILITY_ID="maintainer-authoring";

function createMaintainerCapability({isPackaged=false,argv=[]}={}){
  const packaged=isPackaged === true;
  const developerModeRequested=Array.isArray(argv) && argv.includes("--developer-mode");
  const enabled=!packaged && developerModeRequested;
  return Object.freeze({
    id:CAPABILITY_ID,
    enabled,
    mode:enabled ? "maintainer" : "public-preview",
    localRuntime:!packaged,
    developerModeRequested,
    reason:enabled
      ? "Local unpackaged runtime started with --developer-mode."
      : packaged
        ? "Maintainer authoring is unavailable in packaged builds."
        : "Start the local app with --developer-mode to enable maintainer authoring."
  });
}

module.exports={createMaintainerCapability};
