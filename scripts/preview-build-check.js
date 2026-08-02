#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const BUILD_CONFIG = require("../buildConfig");
const APP_CONFIG = require("../appConfig");
const pkg = require("../package.json");

const root = path.resolve(__dirname, "..");
const failures = [];
const warnings = [];

function fail(label, detail){ failures.push({label, detail}); }
function warn(label, detail){ warnings.push({label, detail}); }
function readJson(file){
  try{ return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); }
  catch(err){ fail(`Cannot read ${file}`, String(err.message || err)); return null; }
}
function walk(dir, found=[]){
  if(!fs.existsSync(dir)) return found;
  for(const name of fs.readdirSync(dir)){
    if(["node_modules",".git"].includes(name) || /^dist(?:-|$)/.test(name) || /^release(?:-|$)/.test(name)) continue;
    const full=path.join(dir,name);
    const stat=fs.statSync(full);
    if(stat.isDirectory()) walk(full, found);
    else found.push(path.relative(root, full));
  }
  return found;
}

if(!BUILD_CONFIG.IS_PREVIEW_BUILD) fail("Preview Mode active", `BUILD_TYPE is ${BUILD_CONFIG.BUILD_TYPE}`);
if(!BUILD_CONFIG.HIDE_INTERNAL_TOOLS) fail("Internal tools hidden", "HIDE_INTERNAL_TOOLS must be true for Preview builds.");
if(BUILD_CONFIG.SUPPORT_EMAIL !== "electron.platform@gmail.com") fail("Official support email configured", `SUPPORT_EMAIL is ${BUILD_CONFIG.SUPPORT_EMAIL || "empty"}`);
if(!/Electron/i.test(APP_CONFIG.APP_DISPLAY_NAME)) fail("Correct app name", APP_CONFIG.APP_DISPLAY_NAME);
if(APP_CONFIG.APP_FOLDER !== APP_CONFIG.APP_PREVIEW_NAME) fail("Preview storage folder isolated", `APP_FOLDER is ${APP_CONFIG.APP_FOLDER}; expected ${APP_CONFIG.APP_PREVIEW_NAME}.`);
if(pkg.build?.productName !== "Electron Preview") fail("Packaged app name", `package.json build.productName is ${pkg.build?.productName}`);
if(pkg.build?.asar !== true) fail("ASAR packaging enabled", "package.json build.asar must be true.");

const starter=readJson("starter-db.json");
if(starter){
  if(!Array.isArray(starter.assets) || starter.assets.length) fail("No personal starter database", "starter-db.json must contain an empty assets array.");
  if(!Array.isArray(starter.log) || starter.log.length) fail("No starter log history", "starter-db.json must contain an empty log array.");
}

const sourceFiles=walk(root);

// Help policy: every named, non-standard action in the main app and Settings
// must have a Help Engine topic (or explicitly use its own help key).  This
// keeps future UI additions from silently losing the contextual i icon.
const helpSource=fs.readFileSync(path.join(root, "renderer", "helpEngine.js"), "utf8");
const helpKeys=new Set([...helpSource.matchAll(/^\s*,?([A-Za-z0-9_]+):\s*\{/gm)].map(match=>match[1]));
const helpExemptButtonIds=new Set(["clearSearchBtn", "exitSettingsFullScreenBtn", "closeSettingsBtn"]);
for(const file of ["renderer/index.html", "renderer/settings.html"]){
  const markup=fs.readFileSync(path.join(root, file), "utf8");
  const missing=[];
  for(const match of markup.matchAll(/<button\b[^>]*>/gi)){
    const tag=match[0];
    const id=tag.match(/\bid=["']([^"']+)["']/i)?.[1];
    if(!id || helpKeys.has(id) || /\bdata-help-key=["'][^"']+["']/i.test(tag) || /\bno-auto-help-icon\b/i.test(tag) || helpExemptButtonIds.has(id)) continue;
    missing.push(id);
  }
  if(missing.length) fail(`Help icons cover ${file}`, `Missing Help Engine topics: ${missing.join(", ")}`);
}
function isAllowedPreviewAsset(file){
  return /^assets\/electron-icon\.png$/i.test(file) ||
    /^assets\/electron-icon-runtime\.png$/i.test(file) ||
    /^assets\/icons\/linux\/\d+x\d+\.png$/i.test(file) ||
    /^assets\/devices\/[^/]+\/images\/(?:components|macros|pcb|profile)\/[^/]+\.(?:jpg|jpeg|png)$/i.test(file) ||
    /^portal\/images\/electron-icon\.png$/i.test(file) ||
    /^build\/electron\.iconset\/icon_\d+x\d+(?:@2x)?\.png$/i.test(file) ||
    /^build\/icon\.icns$/i.test(file);
}
function isSourceOnlyAsset(file){
  const excludedDeviceOriginal=/^assets\/devices\/[^/]+\/originals\//i.test(file) &&
    Array.isArray(pkg.build?.files) &&
    pkg.build.files.includes("!assets/devices/**/originals/**");
  const documentationScreenshot=/^docs\/screenshots\/[a-z0-9][a-z0-9-]*\.png$/i.test(file) &&
    Array.isArray(pkg.build?.files) &&
    !pkg.build.files.some(entry=>{
      const pattern=String(entry||"");
      return !pattern.startsWith("!") &&
        (pattern==="*" || pattern==="**/*" || /^docs(?:\/|$)/i.test(pattern));
    });
  return excludedDeviceOriginal || documentationScreenshot;
}
const blockedSource=sourceFiles.filter(file=>
  /\.(bin|dump|keys|log|jpg|jpeg|png|pdf|doc)$/i.test(file) &&
  !file.startsWith("node_modules/") &&
  !file.startsWith(".git/") &&
  !isAllowedPreviewAsset(file) &&
  !isSourceOnlyAsset(file)
);
if(blockedSource.length) fail("No bundled photos/dumps/keys/logs/reports", blockedSource.join(", "));

const packageFiles=JSON.stringify(pkg.build?.files || []);
if(!packageFiles.includes("buildConfig.js")) fail("Build config included", "package.json build.files must include buildConfig.js.");
if(!packageFiles.includes("maintainerCapability.js")) fail("Maintainer capability included", "package.json build.files must include maintainerCapability.js.");
if(!packageFiles.includes("previewLicenseManager.js")) fail("Preview License Manager included", "package.json build.files must include previewLicenseManager.js.");
if(!packageFiles.includes("previewExtensionToken.js")) fail("Signed Preview token verifier included", "package.json build.files must include previewExtensionToken.js.");
if(!packageFiles.includes("previewDeviceFingerprint.js")) fail("Preview device verification included", "package.json build.files must include previewDeviceFingerprint.js.");
if(!packageFiles.includes("deviceStudioStartupPolicy.js")) fail("Device Studio startup policy included", "package.json build.files must include deviceStudioStartupPolicy.js because main.js loads it at startup.");
if(fs.existsSync(path.join(root,"renderer","cardViewerManager copy.js"))) fail("No Card Viewer fallback copy", "Remove renderer/cardViewerManager copy.js before packaging.");
for(const obsoleteRendererFile of [
  "!renderer/knowledge/index.html",
  "!renderer/knowledge/researchManager.js",
  "!renderer/knowledge/style.css",
  "!renderer/knowledge/README.md"
]){
  if(!packageFiles.includes(obsoleteRendererFile)) fail("Obsolete renderer shells excluded", `${obsoleteRendererFile} must not be bundled.`);
}
if(/Archive\.zip|Documents|Card Reports|Backups|Photos|Logs|Reports/i.test(packageFiles)){
  fail("Distribution file list is scoped", "package.json build.files appears to include personal or generated folders.");
}
if(!pkg.scripts?.["preview:check"]) fail("Preview checklist script exists", "package.json scripts.preview:check is missing.");
if(pkg.build?.afterPack !== "scripts/after-pack-local-mac.js" || !fs.existsSync(path.join(root,"scripts","after-pack-local-mac.js"))){
  fail("Local macOS signing hook exists", "Local preview builds must run the guarded ad-hoc signing hook before DMG creation.");
}
for(const scriptName of ["pack:mac","build:mac"]){
  if(!String(pkg.scripts?.[scriptName] || "").includes("ELECTRON_LOCAL_ADHOC_SIGN=1")) fail(`${scriptName} enables local signing`, "Unsigned renamed Electron bundles can retain an invalid or revoked assessment.");
}
if(!fs.readFileSync(path.join(root, "renderer", "renderer.js"), "utf8").includes("electron.preview.")) fail("Preview custom command storage isolated", "Custom command buttons must use a preview-specific storage key.");
if(!fs.existsSync(path.join(root, "previewLicenseManager.js"))) fail("Preview License Manager exists", "previewLicenseManager.js is missing.");
if(!fs.existsSync(path.join(root, "previewExtensionToken.js"))) fail("Signed Preview token verifier exists", "previewExtensionToken.js is missing.");
if(!fs.existsSync(path.join(root, "previewDeviceFingerprint.js"))) fail("Preview device verification exists", "previewDeviceFingerprint.js is missing.");
const mainSource=fs.readFileSync(path.join(root, "main.js"), "utf8");
const previewLicenseSource=fs.readFileSync(path.join(root, "previewLicenseManager.js"), "utf8");
const previewTokenSource=fs.readFileSync(path.join(root, "previewExtensionToken.js"), "utf8");
const previewFingerprintSource=fs.readFileSync(path.join(root, "previewDeviceFingerprint.js"), "utf8");
const preloadSource=fs.readFileSync(path.join(root, "preload.js"), "utf8");
const settingsSource=fs.readFileSync(path.join(root, "renderer", "settings.html"), "utf8");
const engineeringModeSource=fs.readFileSync(path.join(root, "renderer", "engineeringMode.js"), "utf8");
const maintainerCapabilitySource=fs.readFileSync(path.join(root, "maintainerCapability.js"), "utf8");
if(!mainSource.includes("devTools:DEVELOPER_MODE")) fail("Public DevTools disabled", "BrowserWindow DevTools must require internal mode or the local unpackaged --developer-mode flag.");
if(!mainSource.includes("DEVELOPER_MODE ? [{role:'toggleDevTools'}")) fail("DevTools menu gated", "toggleDevTools must be gated behind DEVELOPER_MODE.");
if(!maintainerCapabilitySource.includes("const enabled=!packaged && developerModeRequested")) fail("Maintainer runtime is local-only", "Maintainer authoring must require both an unpackaged runtime and --developer-mode.");
if(!mainSource.includes("if(MAINTAINER_CAPABILITY.enabled){\n  ipcMain.handle('device-studio:save-hotspots',saveDeviceStudioHotspots);\n  ipcMain.handle('device-studio:add-component',addDeviceStudioComponent);")) fail("Maintainer mutation IPC gated", "Hotspot and component mutation handlers must only be registered in Maintainer Mode.");
if(!mainSource.includes("if(MAINTAINER_CAPABILITY.enabled){\n  ipcMain.handle('preview:run-checklist'")) fail("Preview checklist IPC gated", "The in-app Preview Build Checklist must only be registered in Maintainer Mode.");
if(!preloadSource.includes("const MAINTAINER_PRELOAD_API=MAINTAINER_CAPABILITY.enabled ? Object.freeze({")) fail("Maintainer preload API gated", "Maintainer mutation methods must not be exposed by the Public Preview preload.");
if(!settingsSource.includes('id="settingsEngineeringMode" data-maintainer-only="true" hidden')) fail("Engineering Mode hidden", "Engineering Mode must be hidden by default and enabled only by the runtime Maintainer capability.");
if(!settingsSource.includes('id="runPreviewChecklistBtn" data-maintainer-only="true" hidden')) fail("Preview checklist UI hidden", "The in-app Preview Build Checklist must be hidden in Public Preview.");
if(!engineeringModeSource.includes("const maintainerEnabled=root?.pm3api?.maintainerCapability?.enabled === true")) fail("Engineering Mode runtime gated", "Engineering Mode must not initialise outside Maintainer Mode.");
if(/EP-EXT-|keyChecksum|externalPreviewKeys/.test(`${previewLicenseSource}\n${mainSource}`)) fail("Legacy Preview keys disabled", "Legacy checksum or plaintext Preview keys must not remain reachable.");
if(!previewLicenseSource.includes("if(v==='unlimited') return TRIAL_TYPES.UNLIMITED;") || !previewLicenseSource.includes("return TRIAL_TYPES.DAYS;")){
  fail("Unknown trial settings fail closed", "Unknown local trial values must default to the time-limited Preview, not unlimited access.");
}
if(!previewTokenSource.includes("crypto.verify(") || !previewTokenSource.includes("ed25519") && !previewTokenSource.includes("PUBLIC KEY")) fail("Signed Preview tokens verified", "Preview Extension Tokens must be verified with the bundled public key.");
if(/BEGIN PRIVATE KEY/.test(previewTokenSource)) fail("Preview signing key excluded", "A private signing key must never be bundled with Electron.");
if(!previewFingerprintSource.includes("createHmac(") || !previewFingerprintSource.includes("mismatchCount")) fail("Device verification is privacy-preserving and tolerant", "Device signals must be hashed and evaluated through the tolerant mismatch policy.");
if(!fs.existsSync(path.join(root, "renderer", "portalManager.js"))) fail("Portal skeleton exists", "renderer/portalManager.js is missing.");
if(!fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8").includes("data-tab=\"portal\"")) fail("Portal navigation exists", "Electron Portal tab is missing.");
const extraResources=JSON.stringify(pkg.build?.extraResources || []);
for(const requiredLegalSource of [
  "third_party/electron/LICENSE",
  "third_party/electron/LICENSES.chromium.html"
]){
  if(!fs.existsSync(path.join(root, requiredLegalSource))){
    fail("Release notice source exists", `${requiredLegalSource} is missing from the clean source repository.`);
  }
}
for(const requiredReleaseResource of [
  "legal/THIRD_PARTY_NOTICES.md",
  "legal/ELECTRON_PUBLIC_PREVIEW_LICENSE_v1.0.md",
  "legal/PUBLIC_PREVIEW_NOTICE.md",
  "legal/KNOWN_LIMITATIONS.md",
  "legal/QUICK_START.md",
  "legal/RELEASE_NOTES_PUBLIC_PREVIEW_1.md",
  "legal/ELECTRON_LICENSE.txt",
  "legal/CHROMIUM_THIRD_PARTY_LICENSES.html",
  "legal/PROXMARK3_GPL_LICENSE.txt"
]){
  if(!extraResources.includes(requiredReleaseResource)){
    fail("Release notices packaged", `${requiredReleaseResource} is missing from build.extraResources.`);
  }
}
if(!String(pkg.version || "").startsWith("0.8.")) warn("Preview version", `package.json version is ${pkg.version}; expected 0.8.x for this preview sprint.`);

console.log("Electron Preview Build Checklist");
console.log("--------------------------------");
if(warnings.length){
  console.log("\nWarnings:");
  warnings.forEach(item=>console.log(`- ${item.label}: ${item.detail}`));
}
if(failures.length){
  console.log("\nFailed checks:");
  failures.forEach(item=>console.log(`- ${item.label}: ${item.detail}`));
  process.exit(1);
}
console.log("All preview build checks passed.");
