
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { spawn, execFile, execFileSync } = require('child_process');
const APP_CONFIG = require('./appConfig');
const BUILD_CONFIG = require('./buildConfig');
const { createMaintainerCapability } = require('./maintainerCapability');
const { createManager: createPreviewLicenseManager } = require('./previewLicenseManager');
const { buildSnapshot: buildDeviceStudioSnapshot, parseStructuredJsonOutput, parseTuneOutput, parseVersionOutput } = require('./deviceStudioService');
const { createPM3CommunicationLayer, resolvePM3Executable } = require('./pm3CommunicationLayer');
const { createStartupPresencePreflight } = require('./deviceStudioStartupPolicy');
const { childExited, normaliseOneShotRequest, terminateProcessTree } = require('./pm3ProcessLifecycle');
const { validateCollectionDatabase } = require('./collectionValidation');
const { createCollectionService } = require('./collectionService');
const { createCollectionMigrationService } = require('./collectionMigrationService');
const { jsonBytes, atomicWriteBytes } = require('./collectionMigrationArtifacts');
const { createConnectionCompatibilityEngine } = require('./connectionCompatibilityEngine');
const { createConnectionCompatibilityService } = require('./connectionCompatibilityService');
const { registerConnectionCompatibilityIpc } = require('./connectionCompatibilityIpc');
// Maintainer authoring is intentionally available only in an unpackaged local
// runtime started with --developer-mode. Packaged Preview builds never inherit
// authoring capabilities from their static build configuration.
const MAINTAINER_CAPABILITY=createMaintainerCapability({
  isPackaged:app.isPackaged,
  argv:process.argv
});
const DEVELOPER_MODE=BUILD_CONFIG.IS_INTERNAL_BUILD || MAINTAINER_CAPABILITY.enabled;
const DEVICE_HOTSPOTS_PATH=path.join(__dirname,'assets','devices','proxmark3-easy','hotspots.json');
const DEVICE_COMPONENTS_PATH=path.join(__dirname,'assets','devices','proxmark3-easy','components.json');
// Keep the information-dense Studio and navigation comfortable on ordinary
// laptop displays without requiring every launch to start with Cmd/Ctrl-minus.
const DEFAULT_UI_ZOOM=0.9;

let win, splashWin=null, settingsWin=null, expiredWin=null, pm3Proc=null, pm3ProcBuffer="", pm3BinaryResolutionCache=null, pm3OneShotProc=null, pm3OneShotCommand="", previewLicense=null, deviceStudioLedCapability=null, deviceStudioProc=null, deviceStudioPlotProc=null, deviceStudioPlotPid=null, deviceStudioTuneProc=null, deviceStudioProcPort="", deviceStudioProcBuffer="", deviceStudioWarmPresenceSnapshot=null, deviceStudioWarmPromise=null, deviceStudioSnapshotContext=null;
let pm3QuietOutputDepth=0;
let appQuitCleanupStarted=false;
let splashProgress={percent:4,label:'Starting Electron...',ready:false};
let lastCollectionSchemaInspection=null;
let collectionServiceInstance=null;
let collectionMigrationServiceInstance=null;
let connectionCompatibilityServiceInstance=null;
const deviceStudioTransport=createPM3CommunicationLayer({
  rootDir:__dirname,
  resolveExecutable:()=>pm3BinaryResolution()
});

function maintainerCapabilityStatus(){
  return {
    id:MAINTAINER_CAPABILITY.id,
    enabled:MAINTAINER_CAPABILITY.enabled,
    mode:MAINTAINER_CAPABILITY.mode,
    localRuntime:MAINTAINER_CAPABILITY.localRuntime,
    developerModeRequested:MAINTAINER_CAPABILITY.developerModeRequested,
    reason:MAINTAINER_CAPABILITY.reason
  };
}

ipcMain.on('maintainer:get-capability-sync',event=>{
  event.returnValue=maintainerCapabilityStatus();
});
ipcMain.handle('maintainer:get-capability',async()=>maintainerCapabilityStatus());

function windowWebPreferences(extra={}){
  return {
    preload:path.join(__dirname,'preload.js'),
    contextIsolation:true,
    nodeIntegration:false,
    devTools:DEVELOPER_MODE,
    ...extra
  };
}

function hardenPublicWindow(targetWin){
  if(DEVELOPER_MODE || !targetWin) return;
  targetWin.webContents.on('devtools-opened',()=>targetWin.webContents.closeDevTools());
  targetWin.webContents.on('before-input-event',(event,input)=>{
    const key=String(input.key || "").toLowerCase();
    const opensDevTools=
      key==="f12" ||
      ((input.control || input.meta) && input.shift && key==="i") ||
      ((input.control || input.meta) && input.alt && key==="i") ||
      ((input.control || input.meta) && input.shift && key==="j");
    if(opensDevTools) event.preventDefault();
  });
}

function installContextMenu(targetWin){
  if(!targetWin) return;
  targetWin.webContents.on('context-menu',(event,params)=>{
    const template=[];
    if(params.isEditable){
      template.push(
        {role:'cut', enabled:params.editFlags?.canCut !== false},
        {role:'copy', enabled:params.editFlags?.canCopy !== false},
        {role:'paste', enabled:params.editFlags?.canPaste !== false},
        {type:'separator'},
        {role:'selectAll'}
      );
    }else{
      template.push(
        {role:'copy', enabled:!!params.selectionText},
        {type:'separator'},
        {role:'selectAll'}
      );
    }
    Menu.buildFromTemplate(template).popup({window:targetWin});
  });
}

function closeSplash(){
  if(splashWin && !splashWin.isDestroyed()){
    splashWin.close();
  }
  splashWin=null;
}

function sendSplashProgress(percent,label,{ready=false}={}){
  splashProgress={
    percent:Math.max(0,Math.min(100,Number(percent)||0)),
    label:String(label||'Starting Electron...'),
    ready:ready===true
  };
  if(splashWin && !splashWin.isDestroyed()) splashWin.webContents.send('splash:progress',splashProgress);
}

function openSplashWindow(){
  if(!BUILD_CONFIG.SPLASH_SCREEN?.enabled) return null;
  splashWin=new BrowserWindow({
    width:980,
    height:700,
    frame:false,
    resizable:false,
    show:true,
    backgroundColor:'#020617',
    title:`${APP_CONFIG.APP_NAME} Splash`,
    webPreferences:windowWebPreferences()
  });
  hardenPublicWindow(splashWin);
  splashWin.loadFile(path.join(__dirname,'renderer','splash.html'));
  splashWin.webContents.once('did-finish-load',()=>{
    if(splashWin && !splashWin.isDestroyed()) splashWin.webContents.send('splash:progress',splashProgress);
  });
  splashWin.on('closed',()=>{splashWin=null;});
  return splashWin;
}

function appRootFolder(){ return path.join(app.getPath('documents'), APP_CONFIG.APP_FOLDER); }
function appFolder(key){
  const folder=path.join(appRootFolder(), APP_CONFIG.storageFolder(key));
  fs.mkdirSync(folder, {recursive:true});
  return folder;
}
function ensureAppFolders(){
  Object.keys(APP_CONFIG.STORAGE_FOLDERS || {}).forEach(key=>appFolder(key));
}
function migrateFile(oldPath, newPath){
  try{
    if(fs.existsSync(newPath) || !fs.existsSync(oldPath)) return;
    fs.mkdirSync(path.dirname(newPath), {recursive:true});
    fs.copyFileSync(oldPath, newPath);
  }catch{}
}
function settingsPath(){
  const next=path.join(appFolder('settings'), 'settings.json');
  migrateFile(path.join(app.getPath('userData'), 'settings.json'), next);
  return next;
}
function defaultBackupFolder(){
  return appFolder('backups');
}
function displayPath(filePath){
  const value=String(filePath || "");
  const home=os.homedir();
  if(home && value.startsWith(home)) return value.replace(home, "~");
  return value;
}
function sanitizeSupportData(value){
  if(typeof value==='string') return displayPath(value);
  if(Array.isArray(value)) return value.map(sanitizeSupportData);
  if(value && typeof value==='object'){
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitizeSupportData(item)]));
  }
  return value;
}
function previewFolderLabel(key){
  return `<Documents>/${APP_CONFIG.APP_FOLDER}/${APP_CONFIG.storageFolder(key)}`;
}
function normaliseLegacySettings(settings){
  const s=settings || {};
  const legacyRoots=(APP_CONFIG.LEGACY_APP_FOLDERS || []).map(folder=>path.join(app.getPath('documents'), folder));
  if(legacyRoots.some(root=>String(s.lastExportFolder || '').startsWith(root))) s.lastExportFolder=defaultBackupFolder();
  if(legacyRoots.some(root=>String(s.lastReportFolder || '').startsWith(root))) s.lastReportFolder=defaultReportFolder();
  return s;
}
function loadSettings(){
  try{ return normaliseLegacySettings(JSON.parse(fs.readFileSync(settingsPath(),'utf8'))); }
  catch{ return {}; }
}
function saveSettings(settings){
  fs.writeFileSync(settingsPath(), JSON.stringify(settings,null,2), 'utf8');
}
function createInstallationId(){
  return `EP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}
function createSupportId(date=new Date()){
  const pad=n=>String(n).padStart(2,'0');
  const stamp=`${String(date.getFullYear()).slice(-2)}${pad(date.getMonth()+1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `EP-${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}
function previewLicenseManager(){
  if(!previewLicense){
    previewLicense=createPreviewLicenseManager({
      buildConfig:BUILD_CONFIG,
      loadSettings,
      saveSettings
    });
  }
  return previewLicense;
}
function ensurePlatformIdentity(){
  previewLicenseManager().ensureState();
  return loadSettings();
}
function previewState(settings=ensurePlatformIdentity()){
  const trial=previewLicenseManager().getStatus();
  return {
    state:trial.state,
    model:"30-day Full Preview -> Expiry screen -> Signed Preview Extension Key",
    startedAt:trial.firstStartedAt,
    fullDays:trial.daysTotal,
    elapsedDays:trial.daysElapsed,
    daysRemaining:trial.daysRemaining,
    isExpired:trial.expired,
    lockout:trial.lockout,
    freeModePlaceholder:false,
    trial
  };
}
function platformState(){
  const settings=ensurePlatformIdentity();
  const trial=previewLicenseManager().getStatus();
  return {
    installationId:settings.platform.installationId,
    installationCreatedAt:settings.platform.installationCreatedAt,
    supportEmail:BUILD_CONFIG.SUPPORT_EMAIL || "electron.platform@gmail.com",
    preview:previewState(settings),
    trial,
    build:buildInfo()
  };
}
function ensureBackupFolder(folder){
  fs.mkdirSync(folder, { recursive:true });
  return folder;
}
function getExportFolder(){
  const settings=loadSettings();
  return ensureBackupFolder(settings.lastExportFolder || defaultBackupFolder());
}
function setExportFolder(filePath){
  const settings=loadSettings();
  settings.lastExportFolder = path.dirname(filePath);
  settings.lastExportFile = filePath;
  saveSettings(settings);
}
function setLastExportFile(filePath){
  const settings=loadSettings();
  settings.lastExportFolder = path.dirname(filePath);
  settings.lastExportFile = filePath;
  saveSettings(settings);
}
function setLastReportFile(filePath){
  const settings=loadSettings();
  settings.lastReportFolder = cleanReportFolderPath(path.dirname(filePath));
  settings.lastReportFile = filePath;
  saveSettings(settings);
}
function getLastExportFile(){
  const settings=loadSettings();
  return settings.lastExportFile || "";
}
function setExportFolderDirect(folderPath){
  const settings=loadSettings();
  settings.lastExportFolder = ensureBackupFolder(folderPath);
  saveSettings(settings);
  return settings.lastExportFolder;
}
function resetExportFolder(){
  const folder=defaultBackupFolder();
  const settings=loadSettings();
  settings.lastExportFolder = ensureBackupFolder(folder);
  saveSettings(settings);
  return settings.lastExportFolder;
}
function cleanReportFolderPath(folderPath){
  let folder=path.normalize(String(folderPath || defaultReportFolder()));
  let hadReportFolder=false;
  while(path.basename(folder).toLowerCase() === 'card reports'){
    hadReportFolder=true;
    folder=path.dirname(folder);
  }
  return hadReportFolder ? path.join(folder, 'Card Reports') : folder;
}
function defaultReportFolder(){
  return appFolder('reports');
}

function exportTimestamp(){
  const d=new Date();
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
async function confirmExport(kind, folder){
  const r=await dialog.showMessageBox(win,{
    type:'question',
    buttons:['Cancel','Export'],
    defaultId:1,
    cancelId:0,
    title:`Export ${kind}`,
    message:`Export ${kind}?`,
    detail:`This file will be saved to:\n\n${folder}\n\nTo change the backup location:\n\nElectron → Settings...`
  });
  return r.response===1;
}


function dbPath(){
  const next=path.join(appFolder('database'), 'pm3-assets.json');
  migrateFile(path.join(app.getPath('userData'), 'pm3-assets.json'), next);
  return next;
}
function dbCachePath(){
  return path.join(app.getPath('userData'), 'pm3-assets-cache.json');
}
function ensureDb(){
  const p=dbPath();
  if(!fs.existsSync(p)) fs.copyFileSync(path.join(__dirname,'starter-db.json'), p);
  return p;
}
function requestCloudFileDownload(filePath,error){
  if(process.platform!=='darwin' || error?.code!=='ECANCELED') return;
  try{
    execFileSync('/usr/bin/brctl',['download',filePath],{stdio:'ignore',timeout:5000});
  }catch(downloadError){
    console.warn('[Database] macOS could not immediately download the Documents database:',downloadError?.message || downloadError);
  }
}
function readDatabaseCandidate(filePath,{cloudBacked=false}={}){
  if(!filePath || !fs.existsSync(filePath)) return null;
  const {readJsonFileSyncWithRetry}=require('./fileReadRetry');
  let hydrationRequested=false;
  const data=readJsonFileSyncWithRetry(filePath,{
    maxAttempts:cloudBacked ? 12 : 3,
    retryDelayMs:cloudBacked ? 250 : 40,
    onRetry:({error})=>{
      if(cloudBacked && !hydrationRequested && error?.code==='ECANCELED'){
        hydrationRequested=true;
        requestCloudFileDownload(filePath,error);
      }
    }
  });
  return {data,mtimeMs:fs.statSync(filePath).mtimeMs,filePath};
}
function writeDatabaseFile(filePath,database){
  return atomicWriteBytes(filePath,jsonBytes(database));
}
function inspectLoadedCollectionDatabase(database,filePath){
  const inspection=validateCollectionDatabase(database);
  lastCollectionSchemaInspection={
    filePath,
    inspectedAt:new Date().toISOString(),
    version:inspection.version,
    kind:inspection.kind,
    valid:inspection.valid,
    migrationReadiness:inspection.migrationReadiness,
    diagnostics:inspection.diagnostics
  };
  if(inspection.valid){
    console.info(`[Database] Collection schema v${inspection.version} detected (${inspection.kind}); no migration was performed.`);
  }else{
    console.warn('[Database] Collection schema diagnostics:',JSON.stringify(lastCollectionSchemaInspection));
  }
  return inspection;
}
function loadDatabase(){
  const primaryPath=ensureDb();
  const cachePath=dbCachePath();
  let primary=null,cache=null,primaryError=null,cacheError=null;
  try{ primary=readDatabaseCandidate(primaryPath,{cloudBacked:true}); }
  catch(error){ primaryError=error; console.warn('[Database] Documents copy unavailable:',error?.message || error); }
  try{ cache=readDatabaseCandidate(cachePath); }
  catch(error){ cacheError=error; console.warn('[Database] Local cache unavailable:',error?.message || error); }

  if(!primary && !cache) throw primaryError || cacheError || new Error('No database copy is available.');
  const primaryInspection=primary ? validateCollectionDatabase(primary.data) : null;
  const cacheInspection=cache ? validateCollectionDatabase(cache.data) : null;
  const mixedVersions=
    primaryInspection?.valid &&
    cacheInspection?.valid &&
    primaryInspection.version!==cacheInspection.version;
  const selected=mixedVersions
    ? (primaryInspection.version===6 ? primary : cache)
    : (cache && (!primary || cache.mtimeMs>primary.mtimeMs+1000) ? cache : primary);
  inspectLoadedCollectionDatabase(selected.data,selected.filePath);

  if(mixedVersions){
    console.warn('[Database] Mixed v5/v6 database copies detected. Version 6 remains authoritative; normal load will not complete or roll back the migration transaction.');
  }else if(selected===primary){
    try{ writeDatabaseFile(cachePath,selected.data); }
    catch(error){ console.warn('[Database] Local cache could not be refreshed:',error?.message || error); }
  }else{
    console.warn('[Database] Using the newer local cache while the Documents copy is unavailable or older.');
    try{ writeDatabaseFile(primaryPath,selected.data); }
    catch(error){ console.warn('[Database] Documents copy could not be refreshed:',error?.message || error); }
  }
  return selected.data;
}
function saveDatabase(database){
  const bytes=jsonBytes(database);
  const errors=[];
  const copies=[];
  try{ copies.push({role:'cache',...atomicWriteBytes(dbCachePath(),bytes),ok:true}); }
  catch(error){ errors.push(error); console.warn('[Database] Local cache save failed:',error?.message || error); }
  try{ copies.push({role:'documents',...atomicWriteBytes(dbPath(),bytes),ok:true}); }
  catch(error){ errors.push(error); console.warn('[Database] Documents save failed:',error?.message || error); }
  if(errors.length===2) throw errors[0];
  return {
    ok:errors.length===0,
    partial:errors.length===1,
    checksum:copies[0]?.sha256 || '',
    copies,
    errors:errors.map(error=>error.message)
  };
}
function collectionMigrationService(){
  if(!collectionMigrationServiceInstance){
    collectionMigrationServiceInstance=createCollectionMigrationService({
      getLocations:()=>({
        documentsPath:ensureDb(),
        cachePath:dbCachePath()
      }),
      recoveryRoot:appFolder('backups'),
      applicationVersion:APP_CONFIG.APP_VERSION,
      buildVersion:BUILD_CONFIG.PREVIEW_BUILD_VERSION || APP_CONFIG.APP_VERSION
    });
  }
  return collectionMigrationServiceInstance;
}
function collectionService(){
  if(!collectionServiceInstance){
    collectionServiceInstance=createCollectionService({
      load:loadDatabase,
      persist:saveDatabase,
      migration:collectionMigrationService()
    });
  }
  return collectionServiceInstance;
}
function send(ch,payload){ if(win && !win.isDestroyed()) win.webContents.send(ch,payload); }
function deviceStudioCommandActivity(command=''){
  const cmd=String(command).trim().toLowerCase();
  if(/^hw\s+(version|status|info|capabilities)/.test(cmd)) return {phase:'hardware-query',componentId:'led-b',label:'Reading hardware, firmware or capabilities'};
  if(/^hw\s+tune/.test(cmd) || /^(hf|lf)\b/.test(cmd)) return {phase:'rf-active',componentId:'led-c',label:'RF subsystem active'};
  return {phase:'communication',componentId:'led-a',label:'Communicating with the Proxmark3'};
}
function sendDeviceStudioActivity(activity){
  send('device-studio:progress',{...activity,timestamp:new Date().toISOString(),source:activity.source||'electron-observed'});
}
function run(cmd,args=[],timeoutMs=8000,options={}){
  return new Promise(resolve=>{
    execFile(cmd,args,{timeout:timeoutMs,env:options.env||process.env},(error,stdout,stderr)=>resolve({error:error?String(error):"",stdout:stdout||"",stderr:stderr||""}));
  });
}
function pm3BinaryCandidates(){
  const home=os.homedir();
  if(app.isPackaged){
    return [path.join(process.resourcesPath,'pm3','pm3-electron-public-preview-1')];
  }
  return [
    path.join(home,'Downloads','RFID','proxmark3-iceman-device-studio','pm3'),
    path.join(__dirname,'..','proxmark3-iceman-device-studio','pm3'),
    '/opt/homebrew/bin/pm3',
    '/usr/local/bin/pm3',
    '/opt/local/bin/pm3',
    path.join(home,'.local','bin','pm3'),
    path.join(home,'bin','pm3')
  ].filter(Boolean);
}
function pm3BinaryResolution(){
  if(pm3BinaryResolutionCache) return pm3BinaryResolutionCache;
  pm3BinaryResolutionCache=resolvePM3Executable({
    override:process.env.PM3_PATH,
    candidates:pm3BinaryCandidates(),
    allowPathFallback:!app.isPackaged
  });
  return pm3BinaryResolutionCache;
}
function pm3Binary(){
  return pm3BinaryResolution().path;
}
function runPm3(args=[]){
  const resolution=pm3BinaryResolution();
  if(!resolution.ok) return Promise.resolve({error:resolution.message,stdout:'',stderr:''});
  return run(resolution.path, args);
}
async function runDeviceStudioStatus(port){
  return deviceStudioTransport.status(port);
}
async function runDeviceStudioFullRfCommands(port){
  // The PM3 client's hw tune command creates Qt Plot/Slider windows by
  // default. Full RF Check is an explicit user action, so keep its diagnostic
  // client off-screen while preserving the textual measurements.
  return deviceStudioTransport.fullRfSnapshotCommands(port);
}
async function ensureDeviceStudioProcess(port){
  return deviceStudioTransport.openPersistent(port);
}
function stopDeviceStudioProcess(){
  deviceStudioTransport.stopPersistent();
  if(deviceStudioProc){ try{deviceStudioProc.stdin?.write('quit\r\n');}catch{} try{deviceStudioProc.kill();}catch{} }
  deviceStudioProc=null;
  deviceStudioProcPort="";
  deviceStudioProcBuffer="";
}
function stopDeviceStudioTuneProcess(){
  const delegated=deviceStudioTransport.stopTune();
  const proc=deviceStudioTuneProc;
  deviceStudioTuneProc=null;
  if(!proc) return delegated;
  try{ proc.kill('SIGTERM'); }catch{}
  setTimeout(()=>{ try{ if(!proc.killed) proc.kill('SIGKILL'); }catch{} },500);
  return true;
}
function stopDeviceStudioPlotProcess(){
  if(deviceStudioPlotProc){
    try{ deviceStudioPlotProc.stdin?.write('quit\r\n'); }catch{}
    try{ deviceStudioPlotProc.kill('SIGINT'); }catch{}
    const proc=deviceStudioPlotProc;
    setTimeout(()=>{ try{ if(!proc.killed) proc.kill('SIGTERM'); }catch{} },700);
    deviceStudioPlotProc=null;
  }
  if(Number.isInteger(deviceStudioPlotPid) && deviceStudioPlotPid>0){
    const pid=deviceStudioPlotPid;
    try{ process.kill(pid,'SIGINT'); }catch{}
    try{ process.kill(-pid,'SIGINT'); }catch{}
    setTimeout(()=>{ try{ process.kill(pid,'SIGTERM'); }catch{} },700);
    setTimeout(()=>{ try{ process.kill(-pid,'SIGTERM'); }catch{} },700);
    deviceStudioPlotPid=null;
  }
}
async function waitForPm3PortRelease(port,timeoutMs=5000){
  return deviceStudioTransport.waitForPortRelease(port,timeoutMs);
}
async function runDeviceStudioPersistent(command,timeoutMs=5000){
  return deviceStudioTransport.persistentCommand(command,timeoutMs);
}
async function runPm3SharedStructuredCommand(command,timeoutMs=5000,{quiet=false}={}){
  if(!pm3Proc || pm3Proc.killed || !pm3Proc.stdin || pm3Proc.stdin.destroyed) return null;
  const marker=pm3ProcBuffer.length;
  if(quiet) pm3QuietOutputDepth++;
  const finish=result=>{
    if(quiet) pm3QuietOutputDepth=Math.max(0,pm3QuietOutputDepth-1);
    return result;
  };
  try{ pm3Proc.stdin.write(`${command}\r\n`,'utf8'); }
  catch(error){ return finish({ok:false,status:'write-failed',message:String(error?.message||error),raw:'',data:null}); }
  const started=Date.now();
  return new Promise(resolve=>{
    const poll=setInterval(()=>{
      const raw=pm3ProcBuffer.slice(marker);
      const data=parseStructuredJsonOutput(raw);
      if(data){
        clearInterval(poll);
        resolve(finish({ok:true,status:'complete',data,raw,port:null,binary:pm3Binary()}));
      }else if(Date.now()-started>timeoutMs){
        clearInterval(poll);
        resolve(finish({ok:false,status:'timeout',message:'The active PM3 session did not return a structured response in time.',raw,data:null}));
      }
    },40);
  });
}
async function runDeviceStudioLedStructuredCommand(command,timeoutMs=5000){
  // Device Console and Device Studio share one physical USB serial port.
  // Reuse Console's active PM3 client when present rather than opening a
  // second client that can never reach the device.
  if(pm3Proc) return runPm3SharedStructuredCommand(command,timeoutMs);
  const persistent=await runDeviceStudioPersistent(command,timeoutMs);
  if(persistent?.ok) return persistent;
  return runDeviceStudioLedCommand(command);
}
function rememberDeviceStudioSnapshotContext({preflight,sourceIdentity,usbDescriptor,versionResult,tuneResult,statusContract}){
  deviceStudioSnapshotContext={preflight,sourceIdentity,usbDescriptor,versionResult,tuneResult,statusContract};
}
function snapshotFromPersistentDeviceStudioStatus(result){
  if(!result?.ok || !['device-studio-snapshot','device-studio-status'].includes(result?.data?.contract) || !deviceStudioSnapshotContext?.preflight?.ok) return null;
  const context=deviceStudioSnapshotContext;
  const preflight={...context.preflight,ok:true,status:'ready',port:result.port||context.preflight.port};
  return buildDeviceStudioSnapshot({
    ...context,
    preflight,
    statusResult:{ok:true,stdout:JSON.stringify(result.data),stderr:'',error:''}
  });
}
async function refreshDeviceStudioSnapshotFromPersistentSession(){
  const preferredCommand=deviceStudioSnapshotContext?.statusContract==='device-studio-status' ? 'hw ds-status --json' : 'hw ds-snapshot --json';
  let result=await runDeviceStudioPersistent(preferredCommand,1500);
  let snapshot=snapshotFromPersistentDeviceStudioStatus(result);
  if(snapshot) return snapshot;
  const fallbackCommand=preferredCommand==='hw ds-status --json' ? 'hw ds-snapshot --json' : 'hw ds-status --json';
  result=await runDeviceStudioPersistent(fallbackCommand,1500);
  return snapshotFromPersistentDeviceStudioStatus(result);
}
function parsePm3List(text){
  const ports=[]; const re=/^\s*\d+:\s+(.+)\s*$/gm; let m;
  while((m=re.exec(text))!==null) ports.push(m[1].trim());
  return ports;
}
function imageMimeFromPath(filePath){
  const ext=path.extname(filePath || '').toLowerCase();
  if(ext==='.png') return 'image/png';
  if(ext==='.webp') return 'image/webp';
  if(ext==='.jpg' || ext==='.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}
async function lsofPort(port){
  const ports=[port, port.replace('/dev/tty.','/dev/cu.')];
  let users=[];
  for(const p of ports){
    const r=await run('lsof',[p]);
    if(r.stdout.trim()){
      users=users.concat(r.stdout.trim().split(/\r?\n/).slice(1).map(line=>{
        const parts=line.trim().split(/\s+/);
        return {command:parts[0]||"",pid:parts[1]||"",port:p,raw:line};
      }));
    }
  }
  return users;
}
async function pm3DevicePreflight(){
  return deviceStudioTransport.preflight({ownedPid:pm3Proc?.pid||null});
}
async function pm3DevicePreflightAfterRelease(timeoutMs=3000){
  const deadline=Date.now()+timeoutMs;
  let result;
  do{
    result=await pm3DevicePreflight();
    if(result.ok || result.status!=="busy" || Date.now()>=deadline) return result;
    await new Promise(resolve=>setTimeout(resolve,150));
  }while(Date.now()<deadline);
  return result;
}
function findUsbDevice(value){
  if(Array.isArray(value)){
    for(const item of value){ const found=findUsbDevice(item); if(found) return found; }
    return null;
  }
  if(!value || typeof value!=='object') return null;
  const label=String(value._name||value.product_name||value.product||'');
  const vendor=String(value.vendor_id||value.vendor||'');
  if(/proxmark|iceman|usbmodem/i.test(`${label} ${vendor}`)) return value;
  for(const item of Object.values(value)){ const found=findUsbDevice(item); if(found) return found; }
  return null;
}
async function readDeviceStudioUsbDescriptor(timeoutMs=12000){
  if(process.platform!=='darwin') return {};
  const result=await run('/usr/sbin/system_profiler',['SPUSBDataType','-json'],timeoutMs);
  try{
    const item=findUsbDevice(JSON.parse(result.stdout||'{}'));
    if(!item) return {};
    return {product:item._name||item.product_name||null,vendorId:item.vendor_id||null,productId:item.product_id||null,serialNumber:item.serial_num||item.serial_number||null,manufacturer:item.manufacturer||null,speed:item.speed||null,source:'macos-usb-descriptor'};
  }catch{return {};}
}
function connectionVersionEvidence(value,source='firmware-reported'){
  const reported=String(value||'').trim();
  return {
    value:reported||null,
    source:reported?source:'unknown'
  };
}
function connectionVersionsFromText(parsed={}){
  return {
    client:connectionVersionEvidence(parsed.client,'direct-probe'),
    firmware:connectionVersionEvidence(parsed.firmware),
    bootrom:connectionVersionEvidence(parsed.bootrom),
    fpga:connectionVersionEvidence(parsed.fpga)
  };
}
function connectionVersionsFromStructured(data={}){
  const firmware=data.firmware&&typeof data.firmware==='object' ? data.firmware : {};
  const client=data.client&&typeof data.client==='object' ? data.client : {};
  const device=data.device&&typeof data.device==='object' ? data.device : {};
  return {
    client:connectionVersionEvidence(client.version||data.clientVersion,'direct-probe'),
    firmware:connectionVersionEvidence(firmware.version||firmware.build||data.firmwareVersion),
    bootrom:connectionVersionEvidence(firmware.bootrom||device.bootrom),
    fpga:connectionVersionEvidence(firmware.fpga||device.fpga)
  };
}
function connectionHandshakeFailureStatus(error=''){
  const message=String(error||'');
  if(/timed?\s*out|timeout|ETIMEDOUT/i.test(message)) return 'timeout';
  if(/disconnected|no such device|device.*gone|not available/i.test(message)) return 'disconnected';
  return 'no-response';
}
async function runConnectionHandshake({port,owner,reuseExistingSession=false}={}){
  const selectedPort=String(port||'');
  if(!selectedPort) return {ok:false,status:'disconnected'};
  if(reuseExistingSession){
    if(!/device-studio/i.test(String(owner||''))) return {ok:false,status:'blocked'};
    const command=deviceStudioSnapshotContext?.statusContract==='device-studio-snapshot'
      ? 'hw ds-snapshot --json'
      : 'hw ds-status --json';
    const result=await runDeviceStudioPersistent(command,2000);
    const contract=String(result?.data?.contract||'');
    if(result?.ok&&['device-studio-status','device-studio-snapshot'].includes(contract)){
      return {
        ok:true,
        status:'complete',
        protocol:'structured-json',
        contract,
        reusedExistingSession:true,
        versions:connectionVersionsFromStructured(result.data)
      };
    }
    return {ok:false,status:result?.status==='timeout'?'timeout':'no-response'};
  }
  const resolution=pm3BinaryResolution();
  if(!resolution.ok) return {ok:false,status:'no-response'};
  const response=await run(resolution.path,['-p',selectedPort,'-c','hw version'],4500);
  if(response.error) return {ok:false,status:connectionHandshakeFailureStatus(response.error)};
  const parsed=parseVersionOutput(`${response.stdout||''}\n${response.stderr||''}`);
  const hasVersionEvidence=Boolean(parsed.model||parsed.firmware||parsed.client||parsed.bootrom||parsed.fpga||parsed.mcu);
  if(!hasVersionEvidence) return {ok:false,status:'protocol-mismatch'};
  return {
    ok:true,
    status:'complete',
    protocol:'pm3-client',
    contract:'hw-version-text',
    reusedExistingSession:false,
    versions:connectionVersionsFromText(parsed)
  };
}
function inspectConnectionSessionState({owner}={}){
  const ownerName=String(owner||'');
  if(/device-studio/i.test(ownerName)){
    return {
      owned:true,
      active:Boolean(deviceStudioTuneProc||deviceStudioPlotProc||pm3OneShotProc)
    };
  }
  if(/electron|device-console|pm3-session/i.test(ownerName)){
    return {owned:true,active:true};
  }
  return {owned:false,active:false};
}
function connectionCompatibilityService(){
  if(!connectionCompatibilityServiceInstance){
    const engine=createConnectionCompatibilityEngine({
      resolveExecutable:async()=>pm3BinaryResolution(),
      readUsbDescriptors:async()=>{
        const descriptor=await readDeviceStudioUsbDescriptor(2200);
        return descriptor&&Object.keys(descriptor).length?[descriptor]:[];
      },
      listDevices:async({resolution}={})=>{
        const executable=String(resolution?.path||pm3Binary());
        const response=await run(executable,['--list'],3500);
        const output=`${response.stdout||''}\n${response.stderr||''}`;
        return {
          ports:parsePm3List(output),
          error:response.error,
          binary:executable
        };
      },
      preflight:async({selectedPort,resolution}={})=>deviceStudioTransport.preflight({
        ownedPid:pm3Proc?.pid||null,
        selectedPort,
        timeoutMs:2500,
        executableResolution:resolution
      }),
      inspectSessionState:async details=>inspectConnectionSessionState(details),
      handshake:async details=>runConnectionHandshake(details)
    });
    connectionCompatibilityServiceInstance=createConnectionCompatibilityService({
      engine
    });
  }
  return connectionCompatibilityServiceInstance;
}
// The packaged preview intentionally ships the PM3 client, not a writable
// firmware source checkout. Source Explorer should therefore resolve the
// developer's matching local checkout before considering the app bundle.
function deviceStudioSourceRoot(){
  const candidates=[
    process.env.PM3_SOURCE_ROOT,
    path.join(os.homedir(),'Downloads','RFID','proxmark3-iceman-device-studio'),
    path.resolve(__dirname,'..','proxmark3-iceman-device-studio')
  ].filter(Boolean);
  return candidates.find(candidate=>{
    try{return fs.existsSync(path.join(candidate,'armsrc','appmain.c'));}catch{return false;}
  }) || null;
}
async function readDeviceStudioSourceIdentity(){
  const root=deviceStudioSourceRoot();
  if(!root) return {version:null,sourceRoot:null,source:'unavailable'};
  const result=await run('/usr/bin/git',['-C',root,'describe','--always','--dirty','--tags'],3000);
  return {version:String(result.stdout||'').trim()||null,sourceRoot:root,source:'local-git'};
}
function stopPm3(){
  if(pm3Proc){
    try{pm3Proc.stdin.write('quit\n');}catch{}
    try{pm3Proc.kill();}catch{}
    pm3Proc=null;
  }
}
async function stopPm3OneShot(options={}){
  const proc=pm3OneShotProc;
  if(options.cancelled===true && proc) proc.__pm3Cancelled=true;
  if(!proc || childExited(proc)) return {terminated:true,signal:null};
  const result=await terminateProcessTree(proc,{graceMs:250,forceWaitMs:750});
  if(pm3OneShotProc===proc){
    pm3OneShotProc=null;
    pm3OneShotCommand='';
  }
  return result;
}
async function warmDeviceStudioPresence(){
  if(deviceStudioWarmPromise) return deviceStudioWarmPromise;
  deviceStudioWarmPromise=(async()=>{
    try{
      sendSplashProgress(16,'Checking for a Proxmark3 USB device...');
      const preflight=createStartupPresencePreflight(await pm3DevicePreflight());
      deviceStudioWarmPresenceSnapshot=buildDeviceStudioSnapshot({preflight});
      if(!preflight.ok){
        const message=preflight.status==='multiple-devices'
          ? 'Multiple PM3 devices found — choose one after Electron opens.'
          : 'No PM3 detected — Electron is ready.';
        sendSplashProgress(100,message,{ready:true});
        return deviceStudioWarmPresenceSnapshot;
      }
      sendSplashProgress(100,'PM3 detected — Electron is ready.',{ready:true});
      return deviceStudioWarmPresenceSnapshot;
    }catch(error){
      deviceStudioWarmPresenceSnapshot=buildDeviceStudioSnapshot({
        preflight:{
          ok:false,
          status:'warmup-failed',
          message:'The passive startup device check did not complete.',
          startupDepth:'presence'
        }
      });
      sendSplashProgress(100,'PM3 check unavailable — opening Electron.',{ready:true});
      return deviceStudioWarmPresenceSnapshot;
    }finally{ deviceStudioWarmPromise=null; }
  })();
  return deviceStudioWarmPromise;
}
function createWindow(){
  ensureAppFolders();
  ensureDb();
  const trial=previewLicenseManager().recordLaunchAndGetStatus();
  if(trial.lockout){
    openPreviewExpiredWindow(trial);
    return;
  }
  const splash=openSplashWindow();
  // Startup is presence-only. RF diagnostics require the explicit Full RF
  // Check action after Electron opens.
  sendSplashProgress(8,'Checking for a connected Proxmark3...');
  warmDeviceStudioPresence().catch(()=>{});
  const splashStarted=Date.now();
  let mainShown=false;
  win=new BrowserWindow({
    width:1600,height:940,minWidth:1180,minHeight:740,title:APP_CONFIG.APP_DISPLAY_NAME,
    show:false,
    icon:path.join(__dirname,'assets',process.platform==='darwin'?'electron-icon-runtime.png':'electron-icon.png'),
    webPreferences:windowWebPreferences()
  });
  hardenPublicWindow(win);
  installContextMenu(win);
  win.loadFile(path.join(__dirname,'renderer','index.html'));
  // Navigation restores Electron's page zoom, so apply the compact default
  // only after the initial document has finished loading.
  win.webContents.once('did-finish-load',()=>win?.webContents.setZoomFactor(DEFAULT_UI_ZOOM));
  win.once('ready-to-show',async()=>{
    const cfg=BUILD_CONFIG.SPLASH_SCREEN || {};
    const minMs=Number(cfg.minDurationMs || 0);
    const maxMs=Math.max(Number(cfg.maxDurationMs || 12000),12000);
    let timedOut=false;
    if(deviceStudioWarmPromise){
      await Promise.race([
        deviceStudioWarmPromise,
        new Promise(resolve=>setTimeout(()=>{timedOut=true;resolve();},maxMs))
      ]);
    }
    if(timedOut && !splashProgress.ready) sendSplashProgress(94,'PM3 is still starting — opening Electron now.');
    const elapsed=Date.now()-splashStarted;
    const delay=splash ? Math.max(0, Math.min(maxMs, minMs-elapsed)) : 0;
    setTimeout(()=>{
      closeSplash();
      if(win && !win.isDestroyed()){ win.show(); mainShown=true; }
    }, delay);
  });
  setTimeout(()=>{
    if(win && !win.isDestroyed() && !win.isVisible() && !mainShown){
      if(!splashProgress.ready) sendSplashProgress(94,'PM3 is still starting — opening Electron now.');
      setTimeout(()=>{
        if(win && !win.isDestroyed() && !win.isVisible() && !mainShown){ win.show(); mainShown=true; }
        if(mainShown) closeSplash();
      },220);
      return;
    }
    if(mainShown) closeSplash();
  }, Math.max(Number(BUILD_CONFIG.SPLASH_SCREEN?.maxDurationMs || 12000),12000)+350);
  win.on('close',()=>{
    closeSplash();
    stopPm3();
    if(process.platform==='darwin') setTimeout(()=>app.quit(), 0);
  });
}
function openPreviewExpiredWindow(trialStatus=null){
  const status=trialStatus || previewLicenseManager().getStatus();
  if(expiredWin && !expiredWin.isDestroyed()){
    expiredWin.focus();
    expiredWin.webContents.send('preview-license:status', status);
    return;
  }
  expiredWin=new BrowserWindow({
    width:760,
    height:560,
    minWidth:640,
    minHeight:500,
    title:`${APP_CONFIG.APP_NAME} Preview Expired`,
    webPreferences:windowWebPreferences()
  });
  hardenPublicWindow(expiredWin);
  installContextMenu(expiredWin);
  expiredWin.loadFile(path.join(__dirname,'renderer','previewExpired.html'));
  expiredWin.webContents.once('did-finish-load',()=>expiredWin.webContents.send('preview-license:status', status));
  expiredWin.on('closed',()=>{expiredWin=null;});
}
function openSettings(target=""){
  if(settingsWin && !settingsWin.isDestroyed()){
    settingsWin.focus();
    if(target) settingsWin.webContents.send('settings:focus-section', target);
    return;
  }
  settingsWin=new BrowserWindow({
    width:980,
    height:760,
    minWidth:760,
    minHeight:620,
    title:`${APP_CONFIG.APP_NAME} Settings`,
    // Do not make Settings a native child of the main window. On macOS a
    // child window that enters fullscreen can move its parent between Spaces
    // when it closes, leaving the menu bar over the app or a black window.
    // Settings is intentionally an independent utility window instead.
    webPreferences:windowWebPreferences()
  });
  hardenPublicWindow(settingsWin);
  installContextMenu(settingsWin);
  settingsWin.loadFile(path.join(__dirname,'renderer','settings.html'), target ? {hash:target} : undefined);
  const sendSettingsFullscreenState=()=>{
    if(settingsWin && !settingsWin.isDestroyed()){
      settingsWin.webContents.send('app:full-screen-state', {isFullScreen:settingsWin.isFullScreen()});
    }
  };
  settingsWin.on('enter-full-screen',sendSettingsFullscreenState);
  settingsWin.on('leave-full-screen',sendSettingsFullscreenState);
  settingsWin.on('closed',()=>{settingsWin=null;});
}
function createApplicationMenu(){
  const sendToMainWindow=(channel,payload={})=>{
    if(win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const template=[
    {
      label:APP_CONFIG.APP_NAME,
      submenu:[
        {role:'about'},
        {type:'separator'},
        {label:'Settings...', accelerator:'CmdOrCtrl+,', click:()=>openSettings()},
        {type:'separator'},
        {role:'hide'},
        {role:'hideOthers'},
        {role:'unhide'},
        {type:'separator'},
        {role:'quit'}
      ]
    },
    {
      label:'File',
      submenu:[
        {label:'Settings...', click:()=>openSettings()},
        {type:'separator'},
        {role:'close'}
      ]
    },
    {label:'Edit', submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View', submenu:[
      {label:'Reload app', accelerator:'CmdOrCtrl+R', click:()=>{
        if(win && !win.isDestroyed()) win.webContents.reload();
      }},
      ...(DEVELOPER_MODE ? [{role:'toggleDevTools'},{type:'separator'}] : []),
      {role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}
    ]},
    {label:'Window', submenu:[{role:'minimize'},{role:'zoom'}]},
    {label:'Help', submenu:[
      {label:'About Electron Preview', click:()=>sendToMainWindow('preview:show-welcome')},
      {label:'Visit Electron Portal', click:()=>openElectronPortalWebsite()},
      {label:'Portal Documentation', click:()=>openElectronPortalDocumentation()},
      {label:'Contact / Feedback', click:()=>openElectronPortalContact()},
      {label:'Preview Testing Instructions', click:()=>sendToMainWindow('preview:show-testing-instructions')},
      {label:'Create Feedback Package', click:()=>sendToMainWindow('preview:open-feedback')},
      {label:'Open Feedback Packages Folder', click:()=>shell.openPath(previewFeedbackFolder())}
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
app.whenReady().then(()=>{
  if(process.platform==='darwin' && app.dock) app.dock.setIcon(path.join(__dirname,'assets','electron-icon-runtime.png'));
  createApplicationMenu();createWindow();
});
app.on('before-quit',event=>{
  if(pm3OneShotProc && !childExited(pm3OneShotProc) && !appQuitCleanupStarted){
    event.preventDefault();
    appQuitCleanupStarted=true;
    stopPm3();
    stopDeviceStudioPlotProcess();
    stopDeviceStudioTuneProcess();
    stopDeviceStudioProcess();
    void stopPm3OneShot().finally(()=>app.quit());
    return;
  }
  stopPm3();
  stopDeviceStudioPlotProcess();
  stopDeviceStudioTuneProcess();
  stopDeviceStudioProcess();
});
app.on('window-all-closed',()=>{stopPm3(); void stopPm3OneShot({cancelled:true}); stopDeviceStudioPlotProcess(); stopDeviceStudioTuneProcess(); stopDeviceStudioProcess(); if(process.platform!=='darwin') app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0) createWindow();});
ipcMain.handle('app:open-settings-window',async(_e,target)=>{openSettings(String(target || "")); return true;});
ipcMain.handle('app:close-current-window',async(e)=>{
  const senderWin=BrowserWindow.fromWebContents(e.sender);
  if(!senderWin || senderWin.isDestroyed()) return true;
  // Settings is independent of the main window, so macOS can close its own
  // fullscreen Space without changing the main app's fullscreen state.
  senderWin.once('closed',()=>{
    if(win && !win.isDestroyed()){
      if(win.isMinimized()) win.restore();
      win.focus();
    }
  });
  senderWin.close();
  return true;
});
ipcMain.handle('app:get-current-window-state',async(e)=>{
  const senderWin=BrowserWindow.fromWebContents(e.sender);
  return {isFullScreen:!!(senderWin && !senderWin.isDestroyed() && senderWin.isFullScreen())};
});
ipcMain.handle('app:exit-full-screen',async(e)=>{
  const senderWin=BrowserWindow.fromWebContents(e.sender);
  if(senderWin && !senderWin.isDestroyed()){
    if(senderWin.isFullScreen()) senderWin.setFullScreen(false);
    if(senderWin.isMaximized()) senderWin.unmaximize();
  }
  return true;
});
ipcMain.on('app:settings-updated',(_e,payload)=>{
  if(win && !win.isDestroyed()) win.webContents.send('app:settings-updated', payload || {});
  if(settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('app:settings-updated', payload || {});
});

registerConnectionCompatibilityIpc({
  ipcMain,
  getService:connectionCompatibilityService
});

ipcMain.handle('db:load',async()=>collectionService().snapshot());
ipcMain.handle('collection:lookup',async(_e,reference)=>collectionService().lookup(reference || {}));
ipcMain.handle('collection:mutate',async(_e,request)=>collectionService().mutate(request || {}));
ipcMain.handle('settings:get-backup-folder',async()=>{
  return {
    current:getExportFolder(),
    default:defaultBackupFolder()
  };
});
ipcMain.handle('settings:choose-backup-folder',async(e)=>{
  // The chooser must belong to the window that requested it.  Using the main
  // application window here made a folder choice steal focus from Settings on
  // macOS, which could look as though the independent Settings window closed.
  const owner=BrowserWindow.fromWebContents(e.sender);
  const r=await dialog.showOpenDialog(owner && !owner.isDestroyed() ? owner : win,{
    defaultPath:getExportFolder(),
    properties:['openDirectory','createDirectory']
  });
  if(r.canceled||!r.filePaths[0]) return {
    current:getExportFolder(),
    default:defaultBackupFolder(),
    changed:false
  };
  return {
    current:setExportFolderDirect(r.filePaths[0]),
    default:defaultBackupFolder(),
    changed:true
  };
});
ipcMain.handle('settings:reset-backup-folder',async()=>{
  return {
    current:resetExportFolder(),
    default:defaultBackupFolder(),
    changed:true
  };
});
ipcMain.handle('device:import-command-library',async()=>{
  const r=await dialog.showOpenDialog(win,{
    defaultPath:appFolder('settings'),
    filters:[{name:'Device command library',extensions:['json']}],
    properties:['openFile']
  });
  if(r.canceled||!r.filePaths[0]) return null;
  const filePath=r.filePaths[0];
  try{
    const data=JSON.parse(fs.readFileSync(filePath,'utf8'));
    return {ok:true,filePath,filename:path.basename(filePath),data};
  }catch(err){
    return {ok:false,filePath,filename:path.basename(filePath),message:String(err?.message || err)};
  }
});
ipcMain.handle('device:export-command-library',async(_e,payload={})=>{
  const deviceId=String(payload.deviceId || 'device');
  const defaultPath=path.join(appFolder('settings'), `${deviceId}-commands.json`);
  const r=await dialog.showSaveDialog(win,{
    defaultPath,
    filters:[{name:'JSON',extensions:['json']}]
  });
  if(r.canceled||!r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(payload.library || payload, null, 2), 'utf8');
  return {ok:true,filePath:r.filePath,filename:path.basename(r.filePath)};
});
ipcMain.handle('db:export-json',async(_e,db)=>{
  const exportFolder=getExportFolder();
  const filePath=path.join(
    exportFolder,
    `pm3-rfid-collection-backup-${exportTimestamp()}.json`
  );

  fs.writeFileSync(filePath,JSON.stringify(db,null,2),'utf8');
  setLastExportFile(filePath);

  await dialog.showMessageBox(win,{
    type:'info',
    buttons:['OK'],
    title:'Export complete',
    message:'JSON backup exported.',
    detail:`Saved to:\n\n${exportFolder.replace(/^.*?Documents\//,"Documents/")}\n\nAs:\n${path.basename(filePath)}`
  });

  return {ok:true,filePath,folder:exportFolder,filename:path.basename(filePath)};
});
ipcMain.handle('db:restore-database',async()=>{
  const r=await dialog.showOpenDialog(win,{defaultPath:getExportFolder(),filters:[{name:'JSON',extensions:['json']}],properties:['openFile']});
  if(r.canceled||!r.filePaths[0]) return null;
  setExportFolder(r.filePaths[0]);
  const db=JSON.parse(fs.readFileSync(r.filePaths[0],'utf8'));
  return collectionService().mutate({
    operation:'replaceDatabase',
    payload:{database:db}
  });
});
ipcMain.handle('db:clear',async()=>{
  const current=collectionService().snapshot();
  const backupFolder=getExportFolder();
  const backupPath=path.join(
    backupFolder,
    `electron-database-before-clear-${exportTimestamp()}.json`
  );
  fs.writeFileSync(backupPath, JSON.stringify(current,null,2), 'utf8');
  const cleared=collectionService().mutate({operation:'clear',payload:{}});
  if(!cleared.ok) return cleared;
  setLastExportFile(backupPath);
  return {
    ...cleared,
    db:cleared.database,
    backupPath,
    backupName:path.basename(backupPath),
    folder:backupFolder
  };
});

ipcMain.handle('db:import-tags',async()=>{
  const r=await dialog.showOpenDialog(win,{defaultPath:getExportFolder(),filters:[{name:'JSON',extensions:['json']}],properties:['openFile']});
  if(r.canceled||!r.filePaths[0]) return null;
  setExportFolder(r.filePaths[0]);

  const db=JSON.parse(fs.readFileSync(r.filePaths[0],'utf8'));
  db.__fileName=path.basename(r.filePaths[0]);

  return db;
});

ipcMain.handle('db:choose-export-file-for-update',async()=>{
  const r=await dialog.showOpenDialog(win,{defaultPath:getExportFolder(),filters:[{name:'JSON',extensions:['json']}],properties:['openFile']});
  if(r.canceled||!r.filePaths[0]) return null;
  setExportFolder(r.filePaths[0]);

  const filePath=r.filePaths[0];
  const db=JSON.parse(fs.readFileSync(filePath,'utf8'));
  db.__fileName=path.basename(filePath);
  db.__filePath=filePath;

  return db;
});

ipcMain.handle('db:get-last-export-file-for-update',async()=>{
  const filePath=getLastExportFile();
  if(!filePath || !fs.existsSync(filePath)){
    return {ok:false,message:'No last export file found. Use Export JSON or Update Existing Export first.'};
  }

  const db=JSON.parse(fs.readFileSync(filePath,'utf8'));
  db.__fileName=path.basename(filePath);
  db.__filePath=filePath;
  db.__isLastExport=true;

  return {ok:true,db};
});

ipcMain.handle('db:update-existing-export-file',async(_e,args)=>{
  const filePath=args?.filePath;
  const updatedDb=args?.db;

  if(!filePath || !updatedDb) return {ok:false,message:'Missing file path or database data.'};
  if(!fs.existsSync(filePath)) return {ok:false,message:'Export file does not exist.'};

  const backupPath=filePath + '.bak';
  fs.copyFileSync(filePath, backupPath);
  fs.writeFileSync(filePath, JSON.stringify(updatedDb,null,2),'utf8');
  setLastExportFile(filePath);

  return {ok:true,filePath,backupPath,fileName:path.basename(filePath),backupName:path.basename(backupPath)};
});
ipcMain.handle('db:export-csv',async(_e,csv)=>{
  const exportFolder=getExportFolder();
  const filePath=path.join(
    exportFolder,
    `pm3-rfid-collection-${exportTimestamp()}.csv`
  );

  fs.writeFileSync(filePath,csv,'utf8');

  await dialog.showMessageBox(win,{
    type:'info',
    buttons:['OK'],
    title:'Export complete',
    message:'CSV export exported.',
    detail:`Saved to:\n\n${exportFolder.replace(/^.*?Documents\//,"Documents/")}\n\nAs:\n${path.basename(filePath)}`
  });

  return {ok:true,filePath,folder:exportFolder,filename:path.basename(filePath)};
});
ipcMain.handle('photo:select',async()=>{
  const r=await dialog.showOpenDialog(win,{filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}],properties:['openFile']});
  if(r.canceled||!r.filePaths[0]) return null;
  const filePath=r.filePaths[0];
  const data=fs.readFileSync(filePath);
  return {
    name:path.basename(filePath),
    mime:imageMimeFromPath(filePath),
    size:data.length,
    dataB64:data.toString('base64')
  };
});
function backupReferenceFilters(type){
  if(type==='json') return [{name:'JSON backup metadata',extensions:['json']}];
  if(type==='key') return [{name:'Key files',extensions:['bin','dic','keys','txt']}];
  return [{name:'Backup files',extensions:['bin','json','eml','dic','keys','txt']}];
}
function backupReferenceCandidates(filePath){
  const result={dump:'',json:'',key:''};
  if(!filePath) return result;
  const dir=path.dirname(filePath);
  const selectedBase=path.basename(filePath);
  const selectedStem=path.basename(filePath,path.extname(filePath)).toLowerCase()
    .replace(/[-_.]?(dump|keys?|key|mf|mfc|backup|autopwn)$/i,'');
  let files=[];
  try{ files=fs.readdirSync(dir); }catch{ files=[]; }
  const scored=files.map(name=>{
    const stem=path.basename(name,path.extname(name)).toLowerCase();
    let score=0;
    if(name===selectedBase) score+=10;
    if(stem===selectedStem) score+=8;
    if(stem.includes(selectedStem) || selectedStem.includes(stem)) score+=5;
    if(/dump|backup|autopwn/i.test(name)) score+=2;
    return {name,filePath:path.join(dir,name),score};
  }).filter(item=>item.score>0);
  const pick=pattern=>scored
    .filter(item=>pattern.test(item.name))
    .sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name))[0]?.filePath || '';
  result.dump=pick(/\.(bin|eml|txt)$/i);
  result.json=pick(/\.json$/i);
  result.key=pick(/(key|keys).*\.(bin|dic|keys|txt)$/i) || pick(/\.(dic|keys)$/i);
  if(/\.json$/i.test(selectedBase)) result.json=filePath;
  else if(/(key|keys).*\.(bin|dic|keys|txt)$/i.test(selectedBase) || /\.(dic|keys)$/i.test(selectedBase)) result.key=filePath;
  else result.dump=filePath;
  return result;
}
ipcMain.handle('backup:choose-reference-file',async(_e,args={})=>{
  const current=String(args.currentPath || '');
  const defaultPath=current && fs.existsSync(current) ? current : getExportFolder();
  const r=await dialog.showOpenDialog(win,{defaultPath,filters:backupReferenceFilters(args.type),properties:['openFile']});
  if(r.canceled||!r.filePaths[0]) return null;
  const filePath=r.filePaths[0];
  return {filePath,candidates:backupReferenceCandidates(filePath)};
});
ipcMain.handle('pm3:list',async()=>{
  const r=await runPm3(['--list']);
  const raw=r.stdout+r.stderr; const ports=parsePm3List(raw);
  return {ok:ports.length>0,ports,raw,error:r.error,binary:pm3Binary()};
});
function hotspotNumber(value, minimum=0, maximum=100){
  const number=Number(value);
  return Number.isFinite(number) && number>=minimum && number<=maximum ? number : null;
}
function hotspotColor(value){
  const color=String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}
function safeHotspotEditorEntry(entry, componentIds, imageIds){
  if(!entry || typeof entry!=="object") return null;
  const componentId=String(entry.componentId || "");
  const imageId=String(entry.imageId || "");
  const shape=String(entry.shape || "");
  if(!componentIds.has(componentId) || !imageIds.has(imageId) || !["point","rect","circle","ellipse"].includes(shape)) return null;
  const output={componentId,imageId,shape};
  if(entry.display!==undefined) output.display=String(entry.display);
  if(entry.showCallout!==undefined) output.showCallout=entry.showCallout===true;
  if(entry.side!==undefined) output.side=String(entry.side);
  if(entry.labelPosition!==undefined) output.labelPosition=String(entry.labelPosition);
  if(entry.order!==undefined){ const order=hotspotNumber(entry.order,0,99); if(order===null) return null; output.order=order; }
  if(entry.labelOffset!==undefined){
    const x=hotspotNumber(entry.labelOffset?.x,-400,400);
    const y=hotspotNumber(entry.labelOffset?.y,-400,400);
    if(x===null || y===null) return null;
    output.labelOffset={x,y};
  }
  if(entry.labelX!==undefined || entry.labelY!==undefined){
    const labelX=hotspotNumber(entry.labelX,-100,200);
    const labelY=hotspotNumber(entry.labelY,-100,200);
    if(labelX===null || labelY===null) return null;
    output.labelX=labelX;
    output.labelY=labelY;
  }
  if(entry.calloutAnchorX!==undefined || entry.calloutAnchorY!==undefined){
    const calloutAnchorX=hotspotNumber(entry.calloutAnchorX,0,100);
    const calloutAnchorY=hotspotNumber(entry.calloutAnchorY,0,100);
    if(calloutAnchorX===null || calloutAnchorY===null) return null;
    output.calloutAnchorX=calloutAnchorX;
    output.calloutAnchorY=calloutAnchorY;
  }
  if(entry.markerShape!==undefined){
    const markerShape=String(entry.markerShape);
    if(!["dot","rect"].includes(markerShape)) return null;
    output.markerShape=markerShape;
  }
  if(entry.markerSize!==undefined){
    const markerSize=hotspotNumber(entry.markerSize,.25,20);
    if(markerSize===null) return null;
    output.markerSize=markerSize;
  }
  if(entry.markerWidth!==undefined || entry.markerHeight!==undefined){
    const markerWidth=hotspotNumber(entry.markerWidth,.5,20);
    const markerHeight=hotspotNumber(entry.markerHeight,.5,20);
    if(markerWidth===null || markerHeight===null) return null;
    output.markerWidth=markerWidth;
    output.markerHeight=markerHeight;
  }
  if(entry.markerColor!==undefined){
    const markerColor=hotspotColor(entry.markerColor);
    if(!markerColor) return null;
    output.markerColor=markerColor;
  }
  if(entry.color!==undefined){
    const color=hotspotColor(entry.color);
    if(!color) return null;
    output.color=color;
  }
  if(entry.lineColor!==undefined){
    const lineColor=hotspotColor(entry.lineColor);
    if(!lineColor) return null;
    output.lineColor=lineColor;
  }
  if(entry.strokeWidth!==undefined){
    const strokeWidth=hotspotNumber(entry.strokeWidth,.5,12);
    if(strokeWidth===null) return null;
    output.strokeWidth=strokeWidth;
  }
  if(shape==="point"){
    const markerX=hotspotNumber(entry.markerX ?? entry.x);
    const markerY=hotspotNumber(entry.markerY ?? entry.y);
    if(markerX===null || markerY===null) return null;
    output.markerX=markerX;
    output.markerY=markerY;
    return output;
  }
  const x=hotspotNumber(entry.x);
  const y=hotspotNumber(entry.y);
  if(x===null || y===null) return null;
  output.x=x;
  output.y=y;
  if(shape==="rect"){
    const w=hotspotNumber(entry.w,0.25,100);
    const h=hotspotNumber(entry.h,0.25,100);
    if(w===null || h===null || x+w>100 || y+h>100) return null;
    output.w=w;
    output.h=h;
    return output;
  }
  if(shape==="ellipse"){
    const rx=hotspotNumber(entry.rx,0.25,50);
    const ry=hotspotNumber(entry.ry,0.25,50);
    if(rx===null || ry===null || x-rx<0 || y-ry<0 || x+rx>100 || y+ry>100) return null;
    output.rx=rx;
    output.ry=ry;
    return output;
  }
  const r=hotspotNumber(entry.r,0.25,50);
  const aspect=entry.aspect===undefined ? 1 : hotspotNumber(entry.aspect,.1,10);
  if(r===null || aspect===null || x-r<0 || y-(r*aspect)<0 || x+r>100 || y+(r*aspect)>100) return null;
  output.r=r;
  if(entry.aspect!==undefined) output.aspect=aspect;
  return output;
}
ipcMain.handle('device-studio:hotspot-editor-status',async()=>maintainerCapabilityStatus());
async function saveDeviceStudioHotspots(_event,payload={}){
  try{
    const manifest=JSON.parse(fs.readFileSync(DEVICE_HOTSPOTS_PATH,'utf8'));
    const components=JSON.parse(fs.readFileSync(DEVICE_COMPONENTS_PATH,'utf8'));
    const componentIds=new Set((components.components || []).map(item=>item.id));
    const imageIds=new Set((manifest.images || []).map(item=>item.id));
    const submitted=Array.isArray(payload.hotspots) ? payload.hotspots : null;
    if(!submitted || submitted.length>250) return {ok:false,message:'Invalid hotspot editor payload.'};
    const hotspots=submitted.map(item=>safeHotspotEditorEntry(item,componentIds,imageIds));
    if(hotspots.some(item=>!item)) return {ok:false,message:'One or more hotspot values are outside the image bounds.'};
    manifest.hotspots=hotspots;
    const temporary=`${DEVICE_HOTSPOTS_PATH}.tmp`;
    fs.writeFileSync(temporary,`${JSON.stringify(manifest,null,2)}\n`,'utf8');
    fs.renameSync(temporary,DEVICE_HOTSPOTS_PATH);
    return {ok:true,message:'Hotspot layout saved to the local developer asset file.',hotspots};
  }catch(error){
    return {ok:false,message:String(error?.message || error)};
  }
}
function safeCustomDeviceStudioComponent(entry, existingComponents){
  const displayName=String(entry?.displayName || '').trim().replace(/\s+/g,' ');
  const category=String(entry?.category || 'Custom components').trim().replace(/\s+/g,' ') || 'Custom components';
  if(!displayName || displayName.length>96 || category.length>48) return null;
  const existing=existingComponents.find(item=>String(item.displayName || '').toLocaleLowerCase()===displayName.toLocaleLowerCase());
  if(existing) return {existing};
  const slug=displayName.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,52) || 'component';
  const id=`custom-${slug}-${crypto.createHash('sha1').update(`${displayName}|${category}`).digest('hex').slice(0,8)}`;
  return {component:{
    id,
    displayName,
    category,
    identificationConfidence:'user-defined',
    plainExplanation:'User-defined component. Confirm its physical role before treating it as verified.',
    technicalExplanation:'This catalogue entry was created locally in Developer Calibration and has no assumed firmware mapping.',
    pm3Use:'No firmware behaviour is assumed for this component.',
    safeNow:'Use this entry to annotate the photo and record observations.',
    futureControlNotes:'Add a verified capability or firmware contract only after hardware validation.',
    safetyNotes:'Informational local component; no hardware action is attached.'
  }};
}
async function addDeviceStudioComponent(_event,payload={}){
  try{
    const catalog=JSON.parse(fs.readFileSync(DEVICE_COMPONENTS_PATH,'utf8'));
    const components=Array.isArray(catalog.components) ? catalog.components : [];
    const candidate=safeCustomDeviceStudioComponent(payload,components);
    if(!candidate) return {ok:false,message:'Use a component name up to 96 characters and a category up to 48 characters.'};
    if(candidate.existing) return {ok:true,component:candidate.existing,message:'That component already exists in the local catalogue.'};
    catalog.components=[...components,candidate.component];
    const temporary=`${DEVICE_COMPONENTS_PATH}.tmp`;
    fs.writeFileSync(temporary,`${JSON.stringify(catalog,null,2)}\n`,'utf8');
    fs.renameSync(temporary,DEVICE_COMPONENTS_PATH);
    return {ok:true,component:candidate.component,message:'Component added to the local Device Studio catalogue.'};
  }catch(error){ return {ok:false,message:String(error?.message || error)}; }
}
if(MAINTAINER_CAPABILITY.enabled){
  ipcMain.handle('device-studio:save-hotspots',saveDeviceStudioHotspots);
  ipcMain.handle('device-studio:add-component',addDeviceStudioComponent);
}
ipcMain.handle('device:preflight',async()=>{
  return await pm3DevicePreflight();
});
// Quick Refresh deliberately uses only the already-open PM3 session and the
// versioned Device Studio status contract.  It never starts an RF tune.
ipcMain.handle('device-studio:quick-refresh',async()=>{
  const snapshot=await refreshDeviceStudioSnapshotFromPersistentSession();
  if(snapshot) return {ok:true,status:'complete',snapshot};
  return {
    ok:false,
    status:'full-check-required',
    message:'Quick Refresh needs an established Device Studio session. Run Full RF Check once after connecting the device.'
  };
});

// A full check is intentionally separate from startup presence and Quick
// Refresh. It runs the read-only version and HF/LF tune sequence only after the
// explicit Full RF Check action.
async function runFullDeviceStudioCheck(){
  if(deviceStudioWarmPromise) await deviceStudioWarmPromise;
  deviceStudioWarmPresenceSnapshot=null;
  const initialPreflight=await pm3DevicePreflight();
  if(!initialPreflight.ok){
    send('device-studio:progress',{phase:'error',componentId:'led-d',label:'No device detected',timestamp:new Date().toISOString()});
    return buildDeviceStudioSnapshot({preflight:initialPreflight});
  }
  if((initialPreflight.ports||[]).length>1){
    const selectionRequired=createStartupPresencePreflight(initialPreflight);
    send('device-studio:progress',{phase:'error',componentId:'led-d',label:'Choose a device before Full RF Check',timestamp:new Date().toISOString()});
    return buildDeviceStudioSnapshot({preflight:selectionRequired});
  }
  if(pm3Proc){
    send('device-studio:progress',{phase:'error',componentId:'led-d',label:'Interactive PM3 client is busy',timestamp:new Date().toISOString()});
    return buildDeviceStudioSnapshot({
      preflight:initialPreflight,
      versionResult:{ok:false,stderr:'Skipped while the interactive PM3 client is active.'},
      tuneResult:{ok:false,stderr:'Skipped while the interactive PM3 client is active.'}
    });
  }
  // A refresh must own the port exclusively so firmware telemetry is read from
  // the current firmware instead of failing behind the persistent client.
  stopDeviceStudioProcess();
  // Wait for macOS to actually release the USB-CDC handle.
  await waitForPm3PortRelease(initialPreflight.port,3000);
  send('device-studio:progress',{phase:'detecting',componentId:'led-a',label:'Detecting device',timestamp:new Date().toISOString()});
  const preflight=await pm3DevicePreflight();
  if(!preflight.ok){
    send('device-studio:progress',{phase:'error',componentId:'led-d',label:'No device detected',timestamp:new Date().toISOString()});
    return buildDeviceStudioSnapshot({preflight});
  }
  if((preflight.ports||[]).length>1) return buildDeviceStudioSnapshot({preflight:createStartupPresencePreflight(preflight)});
  send('device-studio:progress',{phase:'version',componentId:'led-b',label:'Reading firmware and hardware version',timestamp:new Date().toISOString()});
  const [batchRun,sourceIdentity,usbDescriptor]=await Promise.all([runDeviceStudioFullRfCommands(preflight.port),readDeviceStudioSourceIdentity(),readDeviceStudioUsbDescriptor()]);
  // Keep the serial transport exclusive: the status command follows the
  // version/tune batch rather than opening a second client concurrently.
  const statusRun=await runDeviceStudioStatus(preflight.port);
  const versionRun=batchRun;
  send('device-studio:progress',{phase:'tuning',componentId:'led-c',label:'Measuring HF and LF antenna tuning',timestamp:new Date().toISOString()});
  const tuneRun=batchRun;
  const versionResult={...versionRun,ok:!versionRun.error};
  const tuneResult={...tuneRun,ok:!tuneRun.error};
  const statusResult={...statusRun,ok:!statusRun.error};
  const success=versionResult.ok||tuneResult.ok;
  send('device-studio:progress',{phase:success?'complete':'error',componentId:'led-d',label:success?'Diagnostics complete':'Device communication failed',timestamp:new Date().toISOString()});
  const snapshot=buildDeviceStudioSnapshot({preflight,sourceIdentity,usbDescriptor,versionResult,tuneResult,statusResult});
  if(snapshot.connection.connected) rememberDeviceStudioSnapshotContext({preflight,sourceIdentity,usbDescriptor,versionResult,tuneResult,statusContract:parseStructuredJsonOutput(`${statusRun.stdout||''}\n${statusRun.stderr||''}`)?.contract||null});
  await ensureDeviceStudioProcess(preflight.port);
  return snapshot;
}
ipcMain.handle('device-studio:snapshot',runFullDeviceStudioCheck);
ipcMain.handle('device-studio:full-check',runFullDeviceStudioCheck);
ipcMain.handle('device-studio:source-file',async(_event,relativePath)=>{
  const root=deviceStudioSourceRoot();
  const allowed=new Set(['armsrc/appmain.c','client/src/cmdhw.c','client/src/comms.c','include/pm3_cmd.h','common_arm/usb_cdc.c','armsrc/iso14443a.c','armsrc/iso14443b.c','armsrc/iso15693.c','armsrc/lfops.c','armsrc/lfsampling.c','armsrc/fpgaloader.c','armsrc/util.c','armsrc/util.h','armsrc/spiffs.c','client/src/cmdflashmem.c','armsrc/Standalone/readme.md','armsrc/Standalone/lf_samyrun.c']);
  const file=String(relativePath||'').replace(/\\/g,'/');
  if(!allowed.has(file)) return {ok:false,message:'This source file is not in the Device Studio allowlist.'};
  if(!root) return {ok:false,path:file,message:'Local Iceman source checkout unavailable. Set PM3_SOURCE_ROOT or keep the checkout in ~/Downloads/RFID/proxmark3-iceman-device-studio.'};
  const absolute=path.resolve(root,file);
  if(!absolute.startsWith(`${root}${path.sep}`)) return {ok:false,message:'Source path rejected.'};
  try{
    const content=fs.readFileSync(absolute,'utf8');
    return {ok:true,path:file,content:content.length>50000?`${content.slice(0,50000)}\n\n[Source truncated for safe in-app viewing.]`:content};
  }catch(error){ return {ok:false,path:file,message:`Source file unavailable: ${error.message}`}; }
});
ipcMain.handle('device-studio:open-antenna-plot',async()=>{
  if(deviceStudioPlotProc && !deviceStudioPlotProc.killed) return {ok:false,message:'Antenna plot is already open.'};
  sendDeviceStudioActivity({phase:'plot-opening',componentId:'led-c',label:'Opening antenna plot',source:'electron-observed'});
  const previousPlotPort=deviceStudioProcPort || '/dev/tty.usbmodemiceman1';
  stopDeviceStudioProcess();
  await waitForPm3PortRelease(previousPlotPort,2500);
  const ready=await pm3DevicePreflightAfterRelease();
  if(!ready.ok){ sendDeviceStudioActivity({phase:'error',componentId:'led-d',label:'Antenna plot could not start',source:'electron-observed'}); return {ok:false,message:ready.message||'Proxmark3 not available.'}; }
  const clientBinary=path.join(path.dirname(pm3Binary()),'client','proxmark3');
  const plotBinary=fs.existsSync(clientBinary)?clientBinary:pm3Binary();
  const plotArgs=plotBinary===pm3Binary()?['-p',ready.port]:[ready.port];
  deviceStudioPlotProc=spawn(plotBinary,plotArgs,{shell:false,detached:true,env:process.env});
  deviceStudioPlotPid=deviceStudioPlotProc.pid || null;
  deviceStudioPlotProc.on('spawn',()=>{ try{ deviceStudioPlotProc.stdin.write('hw tune\r\n'); }catch{} });
  deviceStudioPlotProc.on('exit',()=>{deviceStudioPlotProc=null; deviceStudioPlotPid=null; sendDeviceStudioActivity({phase:'idle',componentId:null,label:'Antenna plot closed',source:'electron-observed'});});
  sendDeviceStudioActivity({phase:'plot-active',componentId:'led-c',label:'Antenna plot active',source:'electron-observed'});
  return {ok:true,message:'Antenna plot opened.'};
});
ipcMain.handle('device-studio:stop-antenna-plot',async()=>{
  stopDeviceStudioPlotProcess();
  stopDeviceStudioProcess();
  const port=(await pm3DevicePreflight()).port || '/dev/tty.usbmodemiceman1';
  const owners=await run('lsof',['-t',port]);
  for(const value of String(owners.stdout||'').split(/\s+/).filter(Boolean)){
    const pid=Number(value);
    if(Number.isInteger(pid) && pid>0 && pid!==process.pid){ try{ process.kill(pid,'SIGTERM'); }catch{} }
  }
  await new Promise(resolve=>setTimeout(resolve,800));
  await waitForPm3PortRelease(port,2500);
  sendDeviceStudioActivity({phase:'idle',componentId:null,label:'Antenna plot stopped',source:'electron-observed'});
  return {ok:true,message:'Antenna plot stopped and USB port released.'};
});
async function runDeviceStudioLedCommand(command){
  const ready=await pm3DevicePreflightAfterRelease();
  if(!ready.ok) return ready;
  return deviceStudioTransport.structuredCommand({port:ready.port,command});
}
ipcMain.handle('device-studio:led-status',async()=>{
  const result=await runDeviceStudioLedStructuredCommand('hw leds --json');
  deviceStudioLedCapability=result.ok;
  return result;
});
ipcMain.handle('pm3:header-led-status',async()=>{
  // The header must never open a second serial client.  It can, however, read
  // status from either of Electron's existing owners of the port: Device
  // Console or Device Studio's persistent diagnostic session.
  if(pm3Proc) return runPm3SharedStructuredCommand('hw leds --json',1600,{quiet:true});
  // Device Studio's persistent client is owned by deviceStudioTransport, not
  // by the legacy deviceStudioProc variable.  Ask that owner directly; it
  // returns null when no Studio session exists.
  const studioResult=await runDeviceStudioPersistent('hw leds --json',1600);
  if(studioResult) return studioResult;
  return {ok:false,status:'inactive',message:'No active PM3 session.'};
});
ipcMain.handle('device-studio:set-safe-mode',async(_event,args={})=>{
  const enabled=args?.enabled===true;
  stopDeviceStudioProcess();
  const preflight=await pm3DevicePreflightAfterRelease();
  if(!preflight.ok) return {ok:false,message:preflight.message||'Proxmark3 is not available.'};
  const result=await deviceStudioTransport.structuredCommand({port:preflight.port,command:`hw ds-mode --${enabled?'enable':'disable'} --json`});
  if(result.ok) await ensureDeviceStudioProcess(preflight.port);
  return result;
});
ipcMain.handle('device-studio:scope-snapshot',async(_event,args={})=>{
  const band=String(args.band||'hf').toLowerCase()==='lf'?'lf':'hf';
  const samples=Math.max(64,Math.min(1024,Number(args.samples)||256));
  stopDeviceStudioPlotProcess();
  stopDeviceStudioProcess();
  if(pm3Proc){ try{ pm3Proc.stdin.write('quit\n'); }catch{} try{ pm3Proc.kill(); }catch{} pm3Proc=null; }
  await waitForPm3PortRelease('/dev/tty.usbmodemiceman1',2500);
  const ready=await pm3DevicePreflight();
  if(!ready.ok) return {ok:false,message:ready.message||'Proxmark3 not available.'};
  const result=await runPm3(['-p',ready.port,'-c',`hw scope --band ${band} --samples ${samples}`],10000);
  const data=parseStructuredJsonOutput(`${result.stdout||''}\n${result.stderr||''}`);
  return {ok:!result.error&&!!data,status:data?'snapshot':'failed',data,raw:`${result.stdout||''}\n${result.stderr||''}`,message:result.error||(!data?'Scope snapshot unavailable.':'Scope snapshot received.')};
});

ipcMain.handle('device-studio:tune-snapshot',async()=>{
  stopDeviceStudioTuneProcess();
  stopDeviceStudioProcess();
  const ready=await pm3DevicePreflight();
  if(!ready?.port) return {ok:false,message:'No Proxmark3 port available.'};
  return deviceStudioTransport.tuneSnapshot(ready.port);
});
ipcMain.handle('device-studio:stop-tune',async()=>{
  const stopped=stopDeviceStudioTuneProcess();
  const released=await waitForPm3PortRelease('/dev/tty.usbmodemiceman1',2500);
  return {ok:true,stopped,released,message:released?'Antenna measurement stopped; USB port released.':'Antenna measurement stop requested; USB port may still be releasing.'};
});
ipcMain.handle('device-studio:led-test',async(_e,args={})=>{
  const led=String(args.led||'').toLowerCase();
  const displayLed=String(args.displayLed||led).toLowerCase();
  const durationMs=Math.max(50,Math.min(1390,Number(args.durationMs)||1000));
  if(!/^[a-d]$/.test(led) || !/^[a-d]$/.test(displayLed)) return {ok:false,status:'invalid-led',message:'LED must be A, B, C or D.'};
  if(deviceStudioLedCapability!==true){
    const status=await runDeviceStudioLedStructuredCommand('hw leds --json');
    deviceStudioLedCapability=status.ok;
    if(!status.ok) return {ok:false,status:'unsupported',message:'The connected firmware does not support LED status yet. No software LED was shown.',raw:status.raw||''};
  }
  // `led` is the hardware command. On PM3 Easy, B and D are intentionally
  // compensated in the app, so progress must use the logical UI LED instead.
  sendDeviceStudioActivity({phase:'led-test',componentId:`led-${displayLed}`,label:`Firmware LED ${displayLed.toUpperCase()} test`,source:'firmware-commanded-test'});
  const result=await runDeviceStudioLedStructuredCommand(`hw leds --test ${led} --ms ${durationMs} --json`,durationMs+3000);
  sendDeviceStudioActivity({phase:'idle',componentId:null,label:'Firmware LED test finished',source:'firmware-commanded-test'});
  return result;
});
ipcMain.handle('pm3:start',async()=>{
  if(pm3Proc) return {ok:true,status:'started',message:'pm3 already running'};
  const resolution=pm3BinaryResolution();
  if(!resolution.ok) return {ok:false,status:'invalid-client',message:resolution.message};
  stopDeviceStudioPlotProcess();
  stopDeviceStudioProcess();
  const ready=await pm3DevicePreflightAfterRelease();
  const offlineDevelopmentSession=
    DEVELOPER_MODE &&
    resolution.source==='PM3_PATH' &&
    ready.status==='no-device';
  if(!ready.ok && !offlineDevelopmentSession) return ready;
  try{
    pm3Proc=spawn(
      resolution.path,
      offlineDevelopmentSession
        ? ['--incognito','--flush']
        : (ready.port ? ['-p',ready.port] : []),
      {shell:false}
    );
    pm3ProcBuffer='';
    pm3Proc.stdout.on('data',d=>{ const text=d.toString(); pm3ProcBuffer+=text; if(!pm3QuietOutputDepth) send('pm3:output',text); });
    pm3Proc.stderr.on('data',d=>{ const text=d.toString(); pm3ProcBuffer+=text; if(!pm3QuietOutputDepth) send('pm3:output',text); });
    pm3Proc.on('close',code=>{
      send('pm3:output',`\n[pm3 exited with code ${code}]\n`);
      pm3Proc=null; pm3ProcBuffer=''; send('pm3:status','stopped');
    });
    return {
      ok:true,
      status:'started',
      port:ready.port||null,
      offline:offlineDevelopmentSession,
      message:offlineDevelopmentSession
        ? 'Preview PM3 client started in an isolated offline developer session.'
        : `pm3 started. Detected ${ready.port}`
    };
  }catch(err){pm3Proc=null; return {ok:false,status:'failed',message:String(err)};}
});
ipcMain.handle('pm3:state',async()=>({running:!!pm3Proc,pid:pm3Proc?.pid || null}));
ipcMain.handle('pm3:send',async(_e,cmd)=>{
  stopDeviceStudioPlotProcess();
  if(!pm3Proc) return {ok:false,message:'pm3 is not running'};
  const safeCmd=String(cmd||'').trim();
  if(!safeCmd) return {ok:false,message:'No PM3 command provided'};
  if(!pm3Proc.stdin || pm3Proc.stdin.destroyed) return {ok:false,message:'pm3 input stream is not available'};
  return await new Promise(resolve=>{
    try{
      const done=err=>resolve(err ? {ok:false,message:String(err.message||err)} : {ok:true,message:'Command sent'});
      pm3Proc.stdin.write(safeCmd+'\r\n','utf8',done);
    }catch(err){
      resolve({ok:false,message:String(err)});
    }
  });
});

ipcMain.handle('pm3:run-command', async(_e,payload)=>{
  const request=normaliseOneShotRequest(payload,{defaultTimeoutMs:60000});
  const safeCmd=request.command;
  if(!safeCmd) return {ok:false,message:'No PM3 command provided',stdout:'',stderr:''};

  if(pm3OneShotProc && !childExited(pm3OneShotProc)){
    return {ok:false,status:'busy',message:`Another Electron PM3 command is still running: ${pm3OneShotCommand || 'device command'}`,stdout:'',stderr:''};
  }

  stopDeviceStudioPlotProcess();
  stopDeviceStudioProcess();

  if(pm3Proc){
    try{pm3Proc.stdin.write('quit\n');}catch{}
    try{pm3Proc.kill();}catch{}
    pm3Proc=null;
    await new Promise(r=>setTimeout(r,450));
  }
  const ready=await pm3DevicePreflightAfterRelease();
  if(!ready.ok) return {...ready,stdout:'',stderr:''};
  sendDeviceStudioActivity(deviceStudioCommandActivity(safeCmd));

  return runManagedPm3OneShot(safeCmd,{port:ready.port,timeoutMs:request.timeoutMs,live:false});
});


async function runManagedPm3OneShot(safeCmd,{port,timeoutMs=45000,live=false}={}){
  if(pm3OneShotProc && !childExited(pm3OneShotProc)){
    return {ok:false,status:'busy',message:`Another Electron PM3 command is still running: ${pm3OneShotCommand || 'device command'}`,stdout:'',stderr:''};
  }

  return new Promise(resolve=>{
    let stdout='',stderr='',settled=false,timingOut=false,forwardOutput=live;
    // The pm3 helper starts client/proxmark3 as a child. A separate process
    // group lets timeout handling terminate both processes instead of leaving
    // the client orphaned with the USB serial port open.
    const args=port ? ['-p',port,'-c',safeCmd] : ['-c',safeCmd];
    const child=spawn(pm3Binary(),args,{shell:false,detached:process.platform!=='win32'});
    child.__pm3Port=port || '';
    pm3OneShotProc=child;
    pm3OneShotCommand=safeCmd;
    child.once('close',()=>{ child.__pm3Closed=true; });

    const finish=result=>{
      if(settled) return;
      settled=true;
      clearTimeout(timeout);
      if(pm3OneShotProc===child){
        pm3OneShotProc=null;
        pm3OneShotCommand='';
      }
      resolve(result);
    };
    const append=(target,data)=>{
      const text=data.toString();
      if(target==='stdout') stdout+=text;
      else stderr+=text;
      if(forwardOutput) send('pm3:live-output',text);
    };

    child.stdout?.on('data',data=>append('stdout',data));
    child.stderr?.on('data',data=>append('stderr',data));

    child.on('error',error=>{
      forwardOutput=false;
      sendDeviceStudioActivity({phase:'error',componentId:'led-d',label:'PM3 action failed'});
      finish({ok:false,message:String(error),stdout,stderr});
    });

    child.on('close',(code,signal)=>{
      child.__pm3Closed=true;
      if(timingOut) return;
      forwardOutput=false;
      const cancelled=child.__pm3Cancelled===true;
      sendDeviceStudioActivity({phase:cancelled?'idle':code===0?'complete':'error',componentId:'led-d',label:cancelled?'PM3 action cancelled':code===0?'PM3 action complete':'PM3 action failed'});
      finish({
        ok:!cancelled && code===0,
        status:cancelled?'cancelled':code===0?'complete':'failed',
        message:cancelled?'Command cancelled; the PM3 process was stopped.':code===0?'Command complete':signal?`Command stopped by ${signal}`:`Command exited with code ${code}`,
        stdout,
        stderr,
        code,
        signal
      });
    });

    const timeout=setTimeout(async()=>{
      if(settled || timingOut) return;
      timingOut=true;
      forwardOutput=false;
      const stopped=await terminateProcessTree(child);
      const released=port ? await waitForPm3PortRelease(port,3500) : stopped.terminated;
      sendDeviceStudioActivity({phase:'error',componentId:'led-d',label:'PM3 action timed out'});
      finish({
        ok:false,
        status:released?'timeout':'busy',
        message:released
          ? `Device command timed out after ${Math.round(timeoutMs/1000)} seconds; the PM3 client was stopped and the port was released.`
          : `Device command timed out after ${Math.round(timeoutMs/1000)} seconds, but the PM3 client did not release the port.`,
        stdout,
        stderr,
        terminated:stopped.terminated,
        portReleased:released
      });
    },timeoutMs);
  });
}


ipcMain.handle('pm3:run-live-command', async(_e,payload)=>{
  const request=normaliseOneShotRequest(payload,{defaultTimeoutMs:45000});
  const safeCmd=request.command;
  if(!safeCmd) return {ok:false,message:'No PM3 command provided',stdout:'',stderr:''};

  if(pm3OneShotProc && !childExited(pm3OneShotProc)){
    return {ok:false,status:'busy',message:`Another Electron PM3 command is still running: ${pm3OneShotCommand || 'device command'}`,stdout:'',stderr:''};
  }

  stopDeviceStudioPlotProcess();
  stopDeviceStudioProcess();

  if(pm3Proc){
    try{pm3Proc.stdin.write('quit\n');}catch{}
    try{pm3Proc.kill();}catch{}
    pm3Proc=null;
    await new Promise(r=>setTimeout(r,450));
  }
  const ready=await pm3DevicePreflightAfterRelease();
  if(!ready.ok) return {...ready,stdout:'',stderr:''};
  sendDeviceStudioActivity(deviceStudioCommandActivity(safeCmd));

  return runManagedPm3OneShot(safeCmd,{port:ready.port,timeoutMs:request.timeoutMs,live:true});
});

ipcMain.handle('pm3:cancel-live-command',async()=>{
  const proc=pm3OneShotProc;
  const command=pm3OneShotCommand;
  if(!proc || childExited(proc)) return {ok:true,status:'idle',message:'No Electron PM3 command is running.'};
  const port=proc.__pm3Port || '';
  const stopped=await stopPm3OneShot({cancelled:true});
  const released=port ? await waitForPm3PortRelease(port,3500) : stopped.terminated;
  return {
    ok:stopped.terminated && released,
    status:released?'cancelled':'busy',
    command,
    terminated:stopped.terminated,
    portReleased:released,
    message:released?'Command cancelled and the PM3 port was released.':'Cancel was requested, but the PM3 port may still be releasing.'
  };
});


function safeFileNamePart(v){
  return String(v || '').replace(/[^a-z0-9._-]+/gi,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'atlas';
}
function assistantPackFolder(){
  return ensureBackupFolder(path.join(appFolder('preview'), 'Assistant Review Packs'));
}
function writeJsonFile(filePath, data){
  fs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2), 'utf8');
}
function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function feedbackPreviewHtml(parts={}){
  const screenshots=parts.screenshots || [];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Electron Feedback Package</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;margin:28px;color:#111827;background:#f8fafc}
    main{max-width:1100px;margin:auto;background:#fff;border:1px solid #dbe4f0;border-radius:14px;padding:24px}
    h1,h2{margin:0 0 12px} section{margin:22px 0;padding-top:16px;border-top:1px solid #e5e7eb}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b1020;color:#e5e7eb;border-radius:10px;padding:14px;font-size:12px}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.meta div{background:#f8fbff;border:1px solid #dbe4f0;border-radius:10px;padding:10px}.meta span{display:block;color:#64748b;font-weight:800}
    img{max-width:100%;border:1px solid #dbe4f0;border-radius:10px;margin:10px 0;background:#fff}
  </style></head><body><main>
    <h1>Electron Feedback Package</h1>
    <div class="meta">
      <div><span>Support ID</span><b>${escapeHtml(parts.supportId)}</b></div>
      <div><span>Installation ID</span><b>${escapeHtml(parts.installationId)}</b></div>
      <div><span>Category</span><b>${escapeHtml(parts.category)}</b></div>
      <div><span>Build</span><b>${escapeHtml(parts.previewLabel)}</b></div>
    </div>
    <section><h2>Feedback Text</h2><pre>${escapeHtml(parts.feedbackText)}</pre></section>
    <section><h2>feedback.json</h2><pre>${escapeHtml(JSON.stringify(parts.feedbackJson || {}, null, 2))}</pre></section>
    <section><h2>Device Console Output</h2><pre>${escapeHtml(parts.deviceLog || "Not included.")}</pre></section>
    <section><h2>Screenshots</h2>${screenshots.length ? screenshots.map(name=>`<img src="${escapeHtml(name)}" alt="${escapeHtml(name)}">`).join("") : "<p>No screenshots included.</p>"}</section>
  </main></body></html>`;
}
function previewFeedbackFolder(){
  return ensureBackupFolder(path.join(appFolder('preview'), 'Feedback'));
}
async function openElectronPortalWebsite(){
  return openElectronPortalPage("index.html", BUILD_CONFIG.PORTAL_URL);
}
async function openElectronPortalDocumentation(){
  return openElectronPortalPage("documentation.html", BUILD_CONFIG.PORTAL_DOCUMENTATION_URL || `${BUILD_CONFIG.PORTAL_URL || ""}/documentation.html`);
}
async function openElectronPortalContact(){
  return openElectronPortalPage("contact.html", BUILD_CONFIG.PORTAL_CONTACT_URL || `${BUILD_CONFIG.PORTAL_URL || ""}/contact.html`);
}
async function openElectronPortalPage(fileName, configuredUrl){
  const portalUrl=String(configuredUrl || "").trim();
  if(portalUrl){
    await shell.openExternal(portalUrl);
    return {ok:true,target:portalUrl,source:"configured"};
  }
  const localPortal=path.join(__dirname, 'portal', fileName || 'index.html');
  if(fs.existsSync(localPortal)){
    const fileUrl=pathToFileURL(localPortal).toString();
    await shell.openExternal(fileUrl);
    return {ok:true,target:localPortal,source:"local"};
  }
  return {ok:false,error:"Electron Portal URL is not configured yet."};
}
function buildInfo(){
  return {
    appName:APP_CONFIG.APP_NAME,
    appDisplayName:APP_CONFIG.APP_DISPLAY_NAME,
    appVersion:APP_CONFIG.APP_VERSION,
    buildType:BUILD_CONFIG.BUILD_TYPE,
    previewBuildVersion:BUILD_CONFIG.PREVIEW_BUILD_VERSION,
    previewLabel:BUILD_CONFIG.PREVIEW_LABEL,
    isPreviewBuild:!!BUILD_CONFIG.IS_PREVIEW_BUILD,
    electronVersion:process.versions.electron,
    nodeVersion:process.versions.node,
    chromeVersion:process.versions.chrome,
    platform:process.platform,
    arch:process.arch,
    macOSVersion:os.release(),
    feedbackEmail:BUILD_CONFIG.FEEDBACK_EMAIL || "",
    supportEmail:BUILD_CONFIG.SUPPORT_EMAIL || "electron.platform@gmail.com",
    portalUrl:BUILD_CONFIG.PORTAL_URL || "",
    portalDocumentationUrl:BUILD_CONFIG.PORTAL_DOCUMENTATION_URL || "",
    portalContactUrl:BUILD_CONFIG.PORTAL_CONTACT_URL || "",
    installationId:ensurePlatformIdentity().platform?.installationId || "",
    previewState:previewState(),
    expiration:BUILD_CONFIG.PREVIEW_EXPIRATION || {},
    maintainer:maintainerCapabilityStatus()
  };
}
function previewChecklist(){
  const checks=[];
  const add=(id,label,ok,detail="")=>checks.push({id,label,ok:!!ok,detail});
  const packageFiles=(require('./package.json').build?.files || []).join('\n');
  let starter={};
  try{ starter=JSON.parse(fs.readFileSync(path.join(__dirname,'starter-db.json'),'utf8')); }catch(err){ starter={_error:String(err)}; }
  const sourceDataFiles=[];
  function isAllowedPreviewAsset(file){
    return /^assets\/electron-icon\.png$/i.test(file) ||
      /^build\/electron\.iconset\/icon_\d+x\d+(?:@2x)?\.png$/i.test(file) ||
      /^build\/icon\.icns$/i.test(file);
  }
  function walk(dir){
    if(!fs.existsSync(dir)) return;
    for(const name of fs.readdirSync(dir)){
      if(['node_modules','.git','dist','release'].includes(name)) continue;
      const full=path.join(dir,name);
      const stat=fs.statSync(full);
      if(stat.isDirectory()) walk(full);
      else if(/\.(bin|dump|keys|log|jpg|jpeg|png|pdf|doc)$/i.test(name)){
        const rel=path.relative(__dirname, full);
        if(!isAllowedPreviewAsset(rel)) sourceDataFiles.push(rel);
      }
    }
  }
  walk(__dirname);
  const appRoot=appRootFolder();
  const runtimeFolders=['photos','backups','logs','reports'].map(key=>appFolder(key));
  let runtimeDb={};
  try{ runtimeDb=JSON.parse(fs.readFileSync(dbPath(),'utf8')); }catch(err){ runtimeDb={_error:String(err)}; }
  add('preview-mode','Preview Mode active',BUILD_CONFIG.IS_PREVIEW_BUILD,`Build type: ${BUILD_CONFIG.BUILD_TYPE}`);
  add('assistant-hidden','Assistant Review Pack hidden',BUILD_CONFIG.HIDE_INTERNAL_TOOLS,'Internal tools are hidden in Preview Mode.');
  add('support-email','Official support email configured',BUILD_CONFIG.SUPPORT_EMAIL === 'electron.platform@gmail.com',BUILD_CONFIG.SUPPORT_EMAIL || '');
  const mainSource=fs.readFileSync(path.join(__dirname,'main.js'),'utf8');
  add('devtools-disabled','Public DevTools disabled',mainSource.includes('devTools:DEVELOPER_MODE') && mainSource.includes("DEVELOPER_MODE ? [{role:'toggleDevTools'}"),'DevTools require the local --developer-mode launch flag; Reload app is a public interface refresh action.');
  add('app-name','Correct app name',/Electron/i.test(APP_CONFIG.APP_DISPLAY_NAME),APP_CONFIG.APP_DISPLAY_NAME);
  add('portal-skeleton','Electron Portal skeleton present',fs.existsSync(path.join(__dirname,'renderer','portalManager.js')),'renderer/portalManager.js');
  add('preview-folder','Preview storage folder isolated',APP_CONFIG.APP_FOLDER===APP_CONFIG.APP_PREVIEW_NAME,`<Documents>/${APP_CONFIG.APP_FOLDER}`);
  add('folder-structure','Correct folder structure',Object.keys(APP_CONFIG.STORAGE_FOLDERS || {}).every(key=>fs.existsSync(appFolder(key))),`<Documents>/${APP_CONFIG.APP_FOLDER}`);
  add('starter-db-empty','No personal starter database',Array.isArray(starter.assets) && starter.assets.length===0 && Array.isArray(starter.log) && starter.log.length===0,'starter-db.json should contain no cards or log entries.');
  add('runtime-db-empty','Starter runtime database has no cards or command history',Array.isArray(runtimeDb.assets) && runtimeDb.assets.length===0 && Array.isArray(runtimeDb.log) && runtimeDb.log.length===0,`<Documents>/${APP_CONFIG.APP_FOLDER}/Database/pm3-assets.json`);
  add('no-source-sensitive-files','No bundled photos/dumps/keys/logs/reports',sourceDataFiles.length===0,sourceDataFiles.join(', '));
  add('package-files-clean','Distribution file list is scoped',!/(Documents|Card Reports|Backups|Photos|Logs|Reports|\.zip|Archive)/i.test(packageFiles),'electron-builder files list reviewed.');
  for(const folder of runtimeFolders){
    const exists=fs.existsSync(folder);
    const files=exists ? fs.readdirSync(folder).filter(name=>!name.startsWith('.')) : [];
    const folderKey=Object.entries(APP_CONFIG.STORAGE_FOLDERS || {}).find(([,name])=>name===path.basename(folder))?.[0] || path.basename(folder);
    add(`runtime-${path.basename(folder).toLowerCase()}`,`Runtime folder clean: ${path.basename(folder)}`,files.length===0,files.length ? files.slice(0,8).join(', ') : previewFolderLabel(folderKey));
  }
  return {ok:checks.every(c=>c.ok),checks,createdAt:new Date().toISOString(),build:buildInfo()};
}
async function zipFolderMac(folderPath){
  const zipPath = folderPath + '.zip';
  return await new Promise(resolve=>{
    execFile('zip', ['-r', zipPath, path.basename(folderPath)], {cwd:path.dirname(folderPath), timeout:30000}, (error)=>{
      if(error) return resolve({ok:false, error:String(error), zipPath});
      resolve({ok:true, zipPath});
    });
  });
}

ipcMain.handle('assistant:create-review-pack', async(_e, payload)=>{
  try{
    const d=new Date();
    const pad=n=>String(n).padStart(2,'0');
    const stamp=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const folder=path.join(assistantPackFolder(), `atlas-review-${stamp}`);
    ensureBackupFolder(folder);

    const appInfo={
      app:APP_CONFIG.APP_DISPLAY_NAME,
      appName:APP_CONFIG.APP_NAME,
      subtitle:APP_CONFIG.APP_SUBTITLE,
      folder:APP_CONFIG.APP_FOLDER,
      codename:APP_CONFIG.APP_PREVIEW_NAME,
      createdAt:d.toISOString(),
      platform:process.platform,
      electron:process.versions.electron,
      node:process.versions.node,
      userData:displayPath(app.getPath('userData')),
      appRoot:displayPath(appRootFolder())
    };

    writeJsonFile(path.join(folder,'app-info.json'), appInfo);
    writeJsonFile(path.join(folder,'card-lab-state.json'), payload || {});

    if(payload?.lastPm3Output){
      fs.writeFileSync(path.join(folder,'last-pm3-output.txt'), String(payload.lastPm3Output), 'utf8');
    }
    if(payload?.pastedOutput){
      fs.writeFileSync(path.join(folder,'pasted-output.txt'), String(payload.pastedOutput), 'utf8');
    }
    if(payload?.lastAnalysis){
      writeJsonFile(path.join(folder,'last-analysis.json'), payload.lastAnalysis);
    }
    try{
      writeJsonFile(path.join(folder,'settings.json'), sanitizeSupportData(loadSettings()));
    }catch{}
    try{
      const db=JSON.parse(fs.readFileSync(ensureDb(),'utf8'));
      writeJsonFile(path.join(folder,'database-summary.json'), {
        version:db.version || null,
        assetCount:Array.isArray(db.assets) ? db.assets.length : 0,
        logCount:Array.isArray(db.log) ? db.log.length : 0,
        settings:db.settings || {}
      });
    }catch(err){
      fs.writeFileSync(path.join(folder,'database-summary-error.txt'), String(err), 'utf8');
    }

    const zip=await zipFolderMac(folder);
    return {ok:true, folderPath:folder, zipped:zip.ok, filePath:zip.ok ? zip.zipPath : '', zipError:zip.error || ''};
  }catch(err){
    return {ok:false, message:String(err && err.message ? err.message : err)};
  }
});

ipcMain.handle('preview:get-build-info', async()=>buildInfo());
if(MAINTAINER_CAPABILITY.enabled){
  ipcMain.handle('preview:run-checklist',async()=>previewChecklist());
}
ipcMain.handle('preview-license:get-status', async()=>previewLicenseManager().getStatus());
ipcMain.handle('preview-license:should-show-feedback-prompt', async()=>previewLicenseManager().shouldShowFeedbackPrompt());
ipcMain.handle('preview-license:apply-extension-key', async(_e,key)=>previewLicenseManager().applyExtensionKey(key));
ipcMain.handle('preview-license:mark-feedback-prompt-shown', async()=>previewLicenseManager().markFeedbackPromptShown());
ipcMain.handle('portal:get-state', async()=>platformState());
ipcMain.handle('portal:open-website', async()=>openElectronPortalWebsite());
ipcMain.handle('portal:open-documentation', async()=>openElectronPortalDocumentation());
ipcMain.handle('portal:open-contact', async()=>openElectronPortalContact());
ipcMain.handle('portal:open-feedback-packages-folder', async()=>{
  const folder=previewFeedbackFolder();
  shell.openPath(folder);
  return {ok:true,folder};
});
ipcMain.handle('portal:request-preview-extension', async(_e, payload={})=>{
  const state=platformState();
  const reason=String(payload.reason || '').trim();
  const requestType=String(payload.requestType || 'preview-extension');
  const subject=encodeURIComponent(requestType==='device-review'
    ? 'Electron Platform Device Verification Review'
    : 'Electron Platform Preview Extension Request');
  const body=encodeURIComponent(previewLicenseManager().requestBody(reason,{requestType}));
  shell.openExternal(`mailto:${encodeURIComponent(state.supportEmail)}?subject=${subject}&body=${body}`);
  return {ok:true,supportEmail:state.supportEmail,installationId:state.installationId};
});
ipcMain.handle('preview:reveal-feedback-package', async(_e, filePath)=>{
  const target=String(filePath || '');
  if(!target || !fs.existsSync(target)) return {ok:false,message:'Feedback package was not found.'};
  shell.showItemInFolder(target);
  return {ok:true};
});
ipcMain.handle('preview:open-feedback-preview', async(_e, filePath)=>{
  const target=String(filePath || '');
  if(!target || !fs.existsSync(target)) return {ok:false,message:'Feedback preview was not found.'};
  const error=await shell.openPath(target);
  return error ? {ok:false,message:error} : {ok:true};
});
ipcMain.handle('preview:submit-feedback', async(_e, payload={})=>{
  try{
    const d=new Date();
    const pad=n=>String(n).padStart(2,'0');
    const stamp=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const folder=path.join(previewFeedbackFolder(), `${BUILD_CONFIG.FEEDBACK_PACKAGE_PREFIX || 'electron-preview-feedback'}-${stamp}`);
    ensureBackupFolder(folder);
    const info=buildInfo();
    const supportId=createSupportId(d);
    const feedback={
      supportId,
      createdAt:d.toISOString(),
      build:info,
      category:String(payload.category || 'Bug'),
      title:String(payload.title || '').trim(),
      description:String(payload.description || '').trim(),
      activeDeviceProfile:payload.activeDeviceProfile || null,
      includeElectronLog:!!payload.includeElectronLog,
      includeDeviceLog:!!payload.includeDeviceLog
    };
    writeJsonFile(path.join(folder,'feedback.json'), feedback);
    const feedbackText=[
      `Electron Preview Feedback`,
      ``,
      `Support ID: ${supportId}`,
      `Installation ID: ${info.installationId || ""}`,
      `Category: ${feedback.category}`,
      `Title: ${feedback.title}`,
      ``,
      feedback.description,
      ``,
      `Preview Build: ${info.previewLabel}`,
      `Electron Version: ${info.electronVersion}`,
      `macOS: ${info.macOSVersion}`,
      `Device Profile: ${feedback.activeDeviceProfile?.displayName || feedback.activeDeviceProfile?.id || 'Unknown'}`
    ].join('\n');
    const feedbackTextPath=path.join(folder,'feedback.txt');
    fs.writeFileSync(feedbackTextPath, feedbackText, 'utf8');
    const deviceLogText=feedback.includeDeviceLog && payload.deviceLog ? String(payload.deviceLog) : "";
    if(deviceLogText){
      fs.writeFileSync(path.join(folder,'device-console-output.txt'), deviceLogText, 'utf8');
    }
    if(feedback.includeElectronLog){
      writeJsonFile(path.join(folder,'electron-log.json'), {
        build:info,
        appRoot:displayPath(appRootFolder()),
        userData:displayPath(app.getPath('userData')),
        settings:sanitizeSupportData(loadSettings())
      });
    }
    const pastedScreenshots=Array.isArray(payload.pastedScreenshots) ? payload.pastedScreenshots : (payload.pastedScreenshot ? [payload.pastedScreenshot] : []);
    const screenshotNames=[];
    pastedScreenshots.slice(0,12).forEach((item,index)=>{
      if(item?.dataUrl){
        const match=String(item.dataUrl).match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);
        if(match){
          const ext=match[1].toLowerCase().replace('jpeg','jpg').replace(/[^a-z0-9]/g,'') || 'png';
          const fileName=`pasted-screenshot-${index+1}.${ext}`;
          screenshotNames.push(fileName);
          fs.writeFileSync(path.join(folder,fileName), Buffer.from(match[2], 'base64'));
        }
      }
    });
    const feedbackPreviewPath=path.join(folder,'feedback-preview.html');
    fs.writeFileSync(feedbackPreviewPath, feedbackPreviewHtml({
      supportId,
      installationId:info.installationId || "",
      category:feedback.category,
      previewLabel:info.previewLabel,
      feedbackText,
      feedbackJson:feedback,
      deviceLog:deviceLogText,
      screenshots:screenshotNames
    }), 'utf8');
    const zip=await zipFolderMac(folder);
    const packagePath=zip.ok ? zip.zipPath : folder;
    const subject=encodeURIComponent(`[Electron Preview Feedback] ${feedback.category}: ${feedback.title || 'Untitled'}`);
    const emailBody=[
      `Electron Preview feedback package created.`,
      ``,
      `Title: ${feedback.title || 'Untitled'}`,
      `Category: ${feedback.category}`,
      `Preview Build: ${info.previewLabel}`,
      `Support ID: ${supportId}`,
      `Installation ID: ${info.installationId || ""}`,
      `Electron Version: ${info.electronVersion}`,
      `macOS: ${info.macOSVersion}`,
      `Device Profile: ${feedback.activeDeviceProfile?.displayName || feedback.activeDeviceProfile?.id || 'Unknown'}`,
      ``,
      `Description:`,
      feedback.description,
      ``,
      `Feedback package:`,
      packagePath,
      ``,
      `Please attach the feedback package if your mail client does not attach it automatically.`
    ].join('\n');
    const body=encodeURIComponent(emailBody);
    if(BUILD_CONFIG.FEEDBACK_EMAIL){
      shell.openExternal(`mailto:${encodeURIComponent(BUILD_CONFIG.FEEDBACK_EMAIL)}?subject=${subject}&body=${body}`);
    }else{
      shell.showItemInFolder(packagePath);
    }
    return {ok:true,folderPath:folder,filePath:packagePath,feedbackTextPath,feedbackPreviewPath,feedbackText,zipped:zip.ok,emailConfigured:!!BUILD_CONFIG.FEEDBACK_EMAIL,supportEmail:BUILD_CONFIG.SUPPORT_EMAIL || "electron.platform@gmail.com",supportId};
  }catch(err){
    return {ok:false,message:String(err && err.message ? err.message : err)};
  }
});


function reportFolder(){
  const settings=loadSettings();
  return ensureBackupFolder(cleanReportFolderPath(settings.lastReportFolder || defaultReportFolder()));
}
function extensionForReportFormat(format){
  const f=String(format || 'txt').toLowerCase();
  if(f === 'pdf') return 'pdf';
  if(f === 'doc' || f === 'word') return 'doc';
  return 'txt';
}
function reportFilterForFormat(format){
  const ext=extensionForReportFormat(format);
  if(ext === 'pdf') return [{name:'PDF report', extensions:['pdf']}];
  if(ext === 'doc') return [{name:'Word-compatible document', extensions:['doc']}];
  return [{name:'Text report', extensions:['txt']}];
}
function cleanReportBaseName(value){
  return String(value || 'electron-card-report')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140) || 'electron-card-report';
}
function escapeReportHtml(value){
  return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function ensureReportFileExtension(filePath, ext){
  const wanted=`.${ext}`;
  return path.extname(filePath).toLowerCase() === wanted ? filePath : `${filePath}${wanted}`;
}
function fallbackReportHtml(text){
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:14mm 14mm 20mm}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#111827;line-height:1.45}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-size:11px}</style></head><body><pre>${escapeReportHtml(text)}</pre></body></html>`;
}
function reportPdfFooterTemplate(options={}){
  const electronVersion=escapeReportHtml(options.electronVersion || app.getVersion() || '1.x.x');
  const reportFormatVersion=escapeReportHtml(options.reportFormatVersion || '1.0');
  return `<div style="box-sizing:border-box;width:100%;padding:0 14mm;color:#64748b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:8px;display:flex;align-items:center;justify-content:space-between;">
    <span>Electron v${electronVersion}</span>
    <span>Report Format v${reportFormatVersion}</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;
}
function reportDocFooterTemplate(options={}){
  const electronVersion=escapeReportHtml(options.electronVersion || app.getVersion() || '1.x.x');
  const reportFormatVersion=escapeReportHtml(options.reportFormatVersion || '1.0');
  return `<div style="mso-element:footer" id="electronDocReportFooter">
    <table class="electronDocFooter"><tr>
      <td>Electron v${electronVersion}</td>
      <td align="center">Report Format v${reportFormatVersion}</td>
      <td align="right">Page <span style='mso-field-code:" PAGE "'></span> of <span style='mso-field-code:" NUMPAGES "'></span></td>
    </tr></table>
  </div>`;
}
function addDocReportFooter(html, options={}){
  let output=String(html || fallbackReportHtml(''));
  if(output.includes('electronDocReportFooter')) return output;
  const style=`<style>
@page electronReportSection{size:A4;margin:14mm 14mm 20mm;mso-footer:electronDocReportFooter;}
div.electronReportSection{page:electronReportSection;}
.electronDocFooter{width:100%;border-collapse:collapse;margin:0;color:#64748b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:9pt;}
.electronDocFooter td{border:none;padding:0;}
</style>`;
  if(/<\/head>/i.test(output)) output=output.replace(/<\/head>/i, `${style}</head>`);
  else output=output.replace(/<html[^>]*>/i, match=>`${match}<head><meta charset="utf-8">${style}</head>`);
  if(/<body[^>]*>/i.test(output)) output=output.replace(/<body([^>]*)>/i, '<body$1><div class="electronReportSection">');
  else output=`<!doctype html><html><head><meta charset="utf-8">${style}</head><body><div class="electronReportSection">${output}`;
  if(/<\/body>/i.test(output)) output=output.replace(/<\/body>/i, `${reportDocFooterTemplate(options)}</div></body>`);
  else output+=`${reportDocFooterTemplate(options)}</div></body></html>`;
  return output;
}
async function renderHtmlToPdf(html, options={}){
  const pdfWin = new BrowserWindow({
    show:false,
    width:900,
    height:1200,
    webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false}
  });
  try{
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String(html || '')));
    await pdfWin.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true');
    await new Promise(resolve=>setTimeout(resolve, 150));
    return await pdfWin.webContents.printToPDF({
      printBackground:true,
      preferCSSPageSize:true,
      displayHeaderFooter:true,
      headerTemplate:'<span></span>',
      footerTemplate:reportPdfFooterTemplate(options),
      pageSize:'A4',
      margins:{top:0.45,bottom:0.75,left:0.45,right:0.45}
    });
  }finally{
    if(!pdfWin.isDestroyed()) pdfWin.close();
  }
}

ipcMain.handle('card-report:export', async(_e, payload)=>{
  try{
    const format=String(payload?.format || 'txt').toLowerCase();
    const ext=extensionForReportFormat(format);
    const baseName=cleanReportBaseName(payload?.baseName);
    const defaultPath=path.join(reportFolder(), `${baseName}.${ext}`);
    const r=await dialog.showSaveDialog(win,{
      title:'Export Full Card Report',
      defaultPath,
      filters:reportFilterForFormat(format)
    });
    if(r.canceled || !r.filePath) return {ok:false,canceled:true};

    const filePath=ensureReportFileExtension(r.filePath, ext);
    if(ext === 'pdf'){
      const pdf=await renderHtmlToPdf(payload?.pdfHtml || payload?.html || fallbackReportHtml(payload?.text || ''), {
        reportFormatVersion:payload?.reportFormatVersion
      });
      fs.writeFileSync(filePath, pdf);
    }else if(ext === 'doc'){
      const html=addDocReportFooter(payload?.html || fallbackReportHtml(payload?.text || ''), {
        reportFormatVersion:payload?.reportFormatVersion
      });
      fs.writeFileSync(filePath, html, 'utf8');
    }else{
      fs.writeFileSync(filePath, String(payload?.text || ''), 'utf8');
    }
    setLastReportFile(filePath);
    await dialog.showMessageBox(win,{
      type:'info',
      buttons:['OK'],
      title:'Report exported',
      message:'Full Card Report exported.',
      detail:`Saved as:\n\n${path.basename(filePath)}\n\nFolder:\n${path.dirname(filePath)}`
    });
    return {ok:true,filePath,filename:path.basename(filePath),format:ext};
  }catch(err){
    return {ok:false,message:String(err && err.message ? err.message : err)};
  }
});

ipcMain.handle('pm3:stop',async()=>{
  stopPm3();
  const oneShot=await stopPm3OneShot();
  return {ok:true,oneShotStopped:oneShot.terminated};
});
