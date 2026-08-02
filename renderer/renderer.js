
const fields=["assetId","alias","form","color","band","frequency","type","magic","currentUid","originalUid","cloneOf","prng","status","backupStatus","lastBackup","source","storage","notes","dateAdded","lastUpdated"];
const labels={assetId:"RFID Tag ID",alias:"Alias / Name",form:"Form",color:"Colour",band:"Band",frequency:"Frequency",type:"Type",magic:"Magic",currentUid:"Current UID",originalUid:"Original UID",cloneOf:"Clone of",prng:"PRNG",status:"Status",backupStatus:"Backup status",lastBackup:"Last backup",source:"Source",storage:"Storage location",notes:"Notes",dateAdded:"Date added",lastUpdated:"Last updated"};
const editFields=["assetId","alias","form","color","band","frequency","type","magic","currentUid","originalUid","cloneOf","prng","status","backupStatus","lastBackup","source","storage","notes"];
const selects={form:["","Card","Keyfob","Sticker","Coin Tag","Wristband","Ring","Other"],color:["","White","Blue","Black","Green","Red","Yellow","Transparent","Other"],band:["","HF","LF","Dual","Unknown"],frequency:["","13.56 MHz","125 kHz","Dual","Unknown"],status:["Active","Blank","Test","Cloned","Unusable","Lost","Archived","Deleted"],backupStatus:["No backup","Partial backup","Backup available","Needs refresh"],source:["","Supplied with PM3","Purchased","Cloned","Self made","Customer","Unknown","Other"],storage:["","PM3 kit","RFID box","Drawer","Workbench","Keyring","Office","Other"]};
let db=null,currentAssetId=null,selectedAssetIds=new Set(),consoleBuffer="",lastParsedScan=null,lastScanStart=0,commandRunning=false,runStart=0,currentCommand="",lastCommandCompleteAt=0,outputIdleTimer=null,autoFollowConsole=true,activeDashboardFilter=null,pm3PresencePollTimer=null,pm3PresenceCheckInFlight=false,lastPm3Presence=null,pm3TransportLossHandled=false,activePm3Port=null,activePm3Offline=false,lastDetectedPm3Port=null,headerPm3LedPollTimer=null,headerPm3LedPollInFlight=false,rfidTagEditState="none";
let deviceCommandLibraryTerminalEl=null;
let previewFeedbackPastedScreenshots=[];
const deviceConnectionPresentationState={
  detected:null,
  connected:false,
  diagnostics:"not-measured",
  checking:true,
  port:"",
  sessionOwner:"none"
};
const workflowProgressPanel=window.WorkflowProgressPanel;
let deviceConsoleWorkflowProgress=null;
let deviceConsoleWorkflowDismissTimer=null;
let deviceConsoleManagedBatch=false;
const PM3_TERMINAL_MAX_CHARS=180000;
const headerPm3LedState={usbPresent:false,leds:{a:false,b:false,c:false,d:false}};

function renderHeaderPm3Leds(){
  const panel=document.getElementById("headerPm3LedPanel");
  if(!panel) return;
  const labels={power:"Power",d:"LED D",c:"LED C",b:"LED B",a:"LED A"};
  ["power","d","c","b","a"].forEach(name=>{
    const indicator=panel.querySelector(`[data-header-pm3-led="${name}"]`);
    if(!indicator) return;
    const on=name==="power" ? headerPm3LedState.usbPresent===true : headerPm3LedState.leds[name]===true;
    indicator.classList.toggle("is-on",on);
    indicator.setAttribute("aria-label",`${labels[name]} ${on?"on":"off"}`);
  });
  panel.classList.toggle("has-pm3",headerPm3LedState.usbPresent===true);
}
function updateHeaderPm3Leds(detail={}){
  if(typeof detail.usbPresent==="boolean") headerPm3LedState.usbPresent=detail.usbPresent;
  if(detail.leds && typeof detail.leds==="object"){
    ["a","b","c","d"].forEach(letter=>{
      if(typeof detail.leds[letter]==="boolean") headerPm3LedState.leds[letter]=detail.leds[letter];
    });
  }
  renderHeaderPm3Leds();
}
window.addEventListener("device-studio-led-state-changed",event=>updateHeaderPm3Leds(event.detail||{}));
function headerLedsFromFirmware(data={}){
  const physical={a:false,b:false,c:false,d:false};
  const mapping=data?.ledMapping?.logicalToSilkscreen || {};
  ["a","b","c","d"].forEach(logical=>{
    const physicalLetter=String(mapping[logical]||logical).toLowerCase();
    if(/^[a-d]$/.test(physicalLetter)) physical[physicalLetter]=data?.leds?.[logical]===true;
  });
  return physical;
}
async function refreshHeaderPm3LedStatus(){
  // This is a quiet request on the already-running Console client.  It never
  // opens a second serial connection, and pauses while a user command runs.
  if(headerPm3LedPollInFlight || commandRunning || document.hidden || !headerPm3LedState.usbPresent || !window.pm3api?.getHeaderPm3LedStatus) return;
  if(window.DeviceStudioManager?.state?.ledTestActiveId || window.DeviceStudioManager?.state?.refreshing) return;
  headerPm3LedPollInFlight=true;
  try{
    const result=await window.pm3api.getHeaderPm3LedStatus();
    if(result?.ok && result.data?.leds) updateHeaderPm3Leds({usbPresent:true,leds:headerLedsFromFirmware(result.data)});
  }catch{
    // The next one-second interval retries.  A transient status read must not
    // change the visible PM3 connection state or clutter the console.
  }finally{ headerPm3LedPollInFlight=false; }
}
function startHeaderPm3LedMonitor(){
  if(headerPm3LedPollTimer) return;
  headerPm3LedPollTimer=window.setInterval(refreshHeaderPm3LedStatus,1000);
  refreshHeaderPm3LedStatus();
}
const PM3_TERMINAL_LEGACY_STORAGE_KEY="electron.pm3TerminalBuffer.v1";
const BUILD_STORAGE_PREFIX=window.ElectronBuildConfig?.IS_PREVIEW_BUILD ? `electron.preview.${window.ElectronBuildConfig.PREVIEW_BUILD_VERSION || "dev"}.${window.ElectronBuildConfig.PREVIEW_DATA_REVISION || "r1"}` : "electron";
const RFID_TAG_OPEN_SEARCH_FIELDS_STORAGE_KEY=`${BUILD_STORAGE_PREFIX}.rfidTagOpenSearchFields.v1`;
const RFID_TAG_OPEN_SEARCH_FIELDS=[
  {id:"assetId",label:"RFID Tag ID",defaultSelected:true},
  {id:"alias",label:"Alias / Name",defaultSelected:true},
  {id:"currentUid",label:"Current UID"},
  {id:"originalUid",label:"Original UID"},
  {id:"cloneOf",label:"Clone of"},
  {id:"source",label:"Source"},
  {id:"storage",label:"Storage location"},
  {id:"notes",label:"Notes"},
  {id:"magic",label:"Magic"},
  {id:"prng",label:"PRNG"},
  {id:"status",label:"Status"},
  {id:"backupStatus",label:"Backup status"}
];
const PM3_CUSTOM_ACTIONS_STORAGE_KEY=`${BUILD_STORAGE_PREFIX}.pm3CustomActions.v1`;
const CUSTOM_PM3_ACTION_COUNT=8;
const PM3_CUSTOM_ACTION_DEFAULTS=Array.from({length:CUSTOM_PM3_ACTION_COUNT},(_,index)=>({
  id:`custom-pm3-action-${index+1}`,
  label:`Custom command button ${index+1}`,
  description:"Configure this custom command button before use.",
  command:"",
  scan:false
}));

function renderDeviceConsoleWorkflowProgress(){
  const host=document.getElementById("deviceConsoleWorkflowProgressHost");
  if(!host) return;
  host.innerHTML=workflowProgressPanel?.render?.(deviceConsoleWorkflowProgress,{
    visible:!!deviceConsoleWorkflowProgress,
    maxVisibleSteps:4,
    cancelAvailable:false
  }) || "";
}

function beginDeviceConsoleWorkflow({id="device-console-command",title="Device Console",status="Preparing device command..."}={}){
  if(deviceConsoleWorkflowDismissTimer) clearTimeout(deviceConsoleWorkflowDismissTimer);
  deviceConsoleWorkflowDismissTimer=null;
  deviceConsoleWorkflowProgress=workflowProgressPanel?.create?.({
    id,
    title,
    status,
    sourceLabel:"Electron-observed",
    unitSingular:"PM3 command",
    unitPlural:"PM3 commands"
  }) || null;
  renderDeviceConsoleWorkflowProgress();
}

function startDeviceConsoleWorkflowStep(label,command){
  if(!deviceConsoleWorkflowProgress) return;
  workflowProgressPanel?.startStep?.(deviceConsoleWorkflowProgress,{label,command});
  renderDeviceConsoleWorkflowProgress();
}

function setDeviceConsoleWorkflowStatus(status,currentCommand){
  if(!deviceConsoleWorkflowProgress) return;
  const command=currentCommand===undefined ? deviceConsoleWorkflowProgress.currentCommand : currentCommand;
  workflowProgressPanel?.setStatus?.(deviceConsoleWorkflowProgress,status,command || "");
  renderDeviceConsoleWorkflowProgress();
}

function finishDeviceConsoleWorkflowStep(command,result){
  if(!deviceConsoleWorkflowProgress) return;
  workflowProgressPanel?.finishStep?.(deviceConsoleWorkflowProgress,command,result);
  renderDeviceConsoleWorkflowProgress();
}

function completeDeviceConsoleWorkflow(outcome,status){
  if(!deviceConsoleWorkflowProgress) return;
  const completedProgress=deviceConsoleWorkflowProgress;
  workflowProgressPanel?.finish?.(completedProgress,{outcome,status});
  renderDeviceConsoleWorkflowProgress();
  if(deviceConsoleWorkflowDismissTimer) clearTimeout(deviceConsoleWorkflowDismissTimer);
  deviceConsoleWorkflowDismissTimer=setTimeout(()=>{
    if(deviceConsoleWorkflowProgress!==completedProgress) return;
    deviceConsoleWorkflowProgress=null;
    deviceConsoleWorkflowDismissTimer=null;
    renderDeviceConsoleWorkflowProgress();
  },1400);
}
function defaultCustomPm3Actions(){
  return PM3_CUSTOM_ACTION_DEFAULTS.map(item=>({...item}));
}
function readCustomPm3Actions(){
  try{
    const saved=JSON.parse(localStorage.getItem(PM3_CUSTOM_ACTIONS_STORAGE_KEY) || "[]");
    const defaults=defaultCustomPm3Actions();
    if(!Array.isArray(saved)) return defaults;
    return defaults.map(item=>{
      const merged=Object.assign({}, item, saved.find(savedItem=>savedItem?.id===item.id) || {});
      if(/^Custom Device \d+$/i.test(String(merged.label || "")) && !String(merged.command || "").trim()) merged.label=item.label;
      if(/Configure this button/i.test(String(merged.description || "")) && !String(merged.command || "").trim()) merged.description=item.description;
      return merged;
    });
  }catch{
    return defaultCustomPm3Actions();
  }
}
function saveCustomPm3Actions(actions){
  localStorage.setItem(PM3_CUSTOM_ACTIONS_STORAGE_KEY, JSON.stringify(actions, null, 2));
}
let PM3_CUSTOM_ACTIONS=readCustomPm3Actions();
window.ElectronCustomPm3Actions=PM3_CUSTOM_ACTIONS;

function applyAppBranding(){
  const cfg=window.ElectronAppConfig || {};
  const build=cfg.BUILD_CONFIG || window.ElectronBuildConfig || {};
  const name=cfg.APP_NAME || "Electron";
  const subtitle=cfg.APP_SUBTITLE || "RFID Intelligence Platform";
  const title=cfg.APP_DISPLAY_NAME || `${name} ${subtitle}`;
  document.title=`${name} - ${subtitle}`;
  const h=document.getElementById("appDisplayName");
  const p=document.getElementById("appSubtitle");
  if(h) h.textContent=name;
  if(p) p.textContent=subtitle;
  const header=document.querySelector("header");
  if(header) header.title=title;
  const badge=document.getElementById("previewBuildBadge");
  if(build.IS_PREVIEW_BUILD && badge){
    badge.textContent=build.PREVIEW_LABEL || "Preview Build";
    badge.classList.remove("hidden");
    badge.title="Show Preview information";
    badge.onclick=()=>showPreviewWelcomeModal();
    document.body.classList.add("previewMode");
    document.title=`${name} Preview - ${subtitle}`;
  }
  if(build.HIDE_INTERNAL_TOOLS){
    document.querySelectorAll('[data-internal-tool="true"]').forEach(el=>el.classList.add("hidden"));
  }
}

function previewBuildConfig(){
  return window.ElectronAppConfig?.BUILD_CONFIG || window.ElectronBuildConfig || {};
}
function showPreviewWelcomeIfNeeded(){
  const build=previewBuildConfig();
  if(!build.IS_PREVIEW_BUILD || !window.UIEngine?.modal) return;
  const key=build.WELCOME_STORAGE_KEY || "electron.preview.welcomeAccepted";
  if(localStorage.getItem(key)==="yes") return;
  showPreviewWelcomeModal({markAccepted:true});
}
function showPreviewWelcomeModal(options={}){
  const build=previewBuildConfig();
  if(!build.IS_PREVIEW_BUILD || !window.UIEngine?.modal) return;
  const key=build.WELCOME_STORAGE_KEY || "electron.preview.welcomeAccepted";
  const body=`<div class="previewWelcome">
    <p><b>Thank you for testing Electron.</b></p>
    <p>This is a Preview Build of Electron RFID Intelligence Platform. It is still actively being developed, and some features may be incomplete or change before a public release.</p>
    <ul>
      <li>Use this build to explore workflows and report feedback.</li>
      <li>The standard Preview lasts 30 days from first launch. After expiry, Electron opens an access screen until a valid signed Preview Extension Key is applied. Your Collection data is not deleted.</li>
      <li>Do not rely on this Preview Build as a final production release.</li>
      <li>Only share logs or screenshots when you choose to include them.</li>
    </ul>
    <p>By continuing, you acknowledge that this is a Preview Build intended for testing and feedback.</p>
    <label class="inlineCheck previewWelcomeChoice"><input type="checkbox" id="previewWelcomeHideNextTime"> Do not show this welcome screen next time</label>
  </div>`;
  window.UIEngine.modal({
    id:"electronPreviewWelcomeModal",
    title:"Welcome to Electron Preview",
    subtitle:build.PREVIEW_LABEL || "Preview Build",
    body,
    size:"md",
    closeOnOverlay:false,
    showX:false,
    buttons:[{text:"I understand - continue", variant:"success", onClick:()=>{
      if(options.markAccepted && document.getElementById("previewWelcomeHideNextTime")?.checked) localStorage.setItem(key,"yes");
      else if(options.markAccepted) localStorage.removeItem(key);
      return true;
    }}]
  });
}
async function showPreviewExpiryFeedbackPromptIfNeeded(){
  if(!window.pm3api?.shouldShowPreviewFeedbackPrompt || !window.UIEngine?.modal) return;
  const result=await window.pm3api.shouldShowPreviewFeedbackPrompt();
  if(!result?.show) return;
  const days=result.status?.daysRemaining ?? 0;
  window.UIEngine.modal({
    id:"previewExpiryFeedbackPrompt",
    title:"Your Preview is ending soon",
    subtitle:`${days} day${days===1?"":"s"} remaining`,
    body:`<p>We would really appreciate your feedback before your Preview expires.</p><p class="small">Nothing is sent automatically. Electron creates a local feedback package only when you choose to create one.</p>`,
    size:"sm",
    buttons:[
      {text:"Remind Me Later",variant:"secondary",onClick:async()=>{await window.pm3api.markPreviewFeedbackPromptShown?.(); return true;}},
      {text:"Send Feedback",variant:"success",onClick:async()=>{await window.pm3api.markPreviewFeedbackPromptShown?.(); openPreviewFeedbackModal(); return true;}}
    ]
  });
}
function showPreviewTestingInstructionsModal(){
  const build=previewBuildConfig();
  const body=`<div class="previewWelcome">
    <p><b>Use this build to test Electron before it is shared more widely.</b></p>
    <ul>
      <li>Open the app with right-click → Open if macOS blocks the unsigned Preview.</li>
      <li>Confirm the Inventory and Research Library start clean.</li>
      <li>Test Device Console connect, disconnect and safe read-only commands.</li>
      <li>Test Scan / Intelligence, Report Ready and Export Report when a supported card is available.</li>
      <li>Use Send Feedback for bugs, unclear workflows and screenshots.</li>
    </ul>
    <p class="small">Nothing is uploaded automatically. Feedback packages are created locally and must be shared manually unless a feedback channel is configured later.</p>
  </div>`;
  window.UIEngine?.modal({
    id:"previewTestingInstructionsModal",
    title:"Preview Testing Instructions",
    subtitle:build.PREVIEW_LABEL || "Electron Preview",
    body,
    size:"md",
    buttons:[{text:"Close",variant:"secondary"}]
  });
}
window.showPreviewTestingInstructionsModal=showPreviewTestingInstructionsModal;
function feedbackDeviceProfile(){
  const profile=window.DeviceRegistry?.activeProfile?.();
  return profile ? {id:profile.id,displayName:profile.displayName,supportStatus:profile.supportStatus,capabilities:profile.capabilities || {}} : null;
}
function previewFeedbackDraftKey(){
  const build=previewBuildConfig();
  return `electron.preview.feedbackDraft.${build.PREVIEW_BUILD_VERSION || "dev"}.${build.PREVIEW_DATA_REVISION || "r1"}`;
}
function readPreviewFeedbackDraft(){
  try{ return JSON.parse(localStorage.getItem(previewFeedbackDraftKey()) || "{}") || {}; }
  catch{ return {}; }
}
function savePreviewFeedbackDraft(){
  const draft={
    category:document.getElementById("previewFeedbackCategory")?.value || "Bug",
    title:document.getElementById("previewFeedbackTitle")?.value || "",
    description:document.getElementById("previewFeedbackDescription")?.value || "",
    includeElectronLog:!!document.getElementById("previewFeedbackElectronLog")?.checked,
    includeDeviceLog:!!document.getElementById("previewFeedbackDeviceLog")?.checked
  };
  localStorage.setItem(previewFeedbackDraftKey(), JSON.stringify(draft, null, 2));
}
function clearPreviewFeedbackDraft(){
  localStorage.removeItem(previewFeedbackDraftKey());
  previewFeedbackPastedScreenshots=[];
  openPreviewFeedbackModal();
}
function setupPreviewFeedbackScreenshotPaste(){
  const drop=document.getElementById("previewFeedbackScreenshotPaste");
  const status=document.getElementById("previewFeedbackScreenshotPasteStatus");
  const clear=document.getElementById("previewFeedbackClearPastedScreenshot");
  const preview=document.getElementById("previewFeedbackScreenshotPreview");
  if(!drop) return;
  const render=()=>{
    if(status) status.textContent=previewFeedbackPastedScreenshots.length
      ? `${previewFeedbackPastedScreenshots.length} pasted screenshot${previewFeedbackPastedScreenshots.length===1?"":"s"} attached.`
      : "No pasted screenshots attached.";
    if(preview) preview.innerHTML=previewFeedbackPastedScreenshots.map((item,index)=>`<div class="previewScreenshotThumb"><img src="${item.dataUrl}" alt="Pasted screenshot ${index+1}"><span>${tableEscape(item.name || `Screenshot ${index+1}`)}</span><button type="button" data-preview-screenshot-remove="${index}">Remove</button></div>`).join("");
    preview?.querySelectorAll("[data-preview-screenshot-remove]").forEach(btn=>btn.onclick=()=>{
      previewFeedbackPastedScreenshots.splice(Number(btn.dataset.previewScreenshotRemove), 1);
      render();
    });
  };
  const setStatus=text=>{ if(status) status.textContent=text; };
  const useFile=file=>{
    if(!file || !/^image\//i.test(file.type || "")){
      setStatus("Paste or drop an image file.");
      return;
    }
    const reader=new FileReader();
    reader.onload=()=>{
      previewFeedbackPastedScreenshots.push({name:file.name || `pasted-screenshot-${previewFeedbackPastedScreenshots.length+1}.png`, type:file.type || "image/png", dataUrl:String(reader.result || "")});
      drop.classList.add("hasImage");
      render();
    };
    reader.readAsDataURL(file);
  };
  drop.addEventListener("paste", event=>{
    const files=[...(event.clipboardData?.files || [])].filter(item=>/^image\//i.test(item.type || ""));
    if(files.length){
      event.preventDefault();
      files.forEach(useFile);
    }
  });
  drop.addEventListener("dragover", event=>{ event.preventDefault(); drop.classList.add("dragOver"); });
  drop.addEventListener("dragleave", ()=>drop.classList.remove("dragOver"));
  drop.addEventListener("drop", event=>{
    event.preventDefault();
    drop.classList.remove("dragOver");
    [...(event.dataTransfer?.files || [])].filter(item=>/^image\//i.test(item.type || "")).forEach(useFile);
  });
  drop.addEventListener("click", ()=>drop.focus());
  if(clear) clear.onclick=()=>{
    previewFeedbackPastedScreenshots=[];
    drop.classList.remove("hasImage");
    render();
  };
  render();
}
function renderPreviewFeedbackResult(result){
  const status=document.getElementById("previewFeedbackStatus");
  if(!status) return;
  const path=result.filePath || result.folderPath || "";
  status.innerHTML=`<div class="previewFeedbackResult">
    <b>Feedback package created</b>
    ${result.supportId ? `<span><b>Support ID:</b> ${tableEscape(result.supportId)}</span>` : ""}
    <span>${result.emailConfigured ? "Your mail app was opened. Attach the package if it was not attached automatically." : `Send this package manually to ${tableEscape(result.supportEmail || "electron.platform@gmail.com")}.`}</span>
    <code>${tableEscape(path)}</code>
    <div class="toolbar">
      <button type="button" id="previewFeedbackOpenPackageBtn">Open package folder</button>
      ${result.feedbackPreviewPath ? `<button type="button" id="previewFeedbackOpenHtmlBtn">Open HTML preview</button>` : ""}
      <button type="button" id="previewFeedbackCopyPathBtn">Copy package path</button>
      <button type="button" id="previewFeedbackCopyTextBtn">Copy feedback text</button>
    </div>
    <small>Your email address is not shared by Electron. Nothing is uploaded automatically.</small>
  </div>`;
  const openBtn=document.getElementById("previewFeedbackOpenPackageBtn");
  const openHtmlBtn=document.getElementById("previewFeedbackOpenHtmlBtn");
  const copyPathBtn=document.getElementById("previewFeedbackCopyPathBtn");
  const copyTextBtn=document.getElementById("previewFeedbackCopyTextBtn");
  if(openBtn) openBtn.onclick=()=>window.pm3api.revealPreviewFeedbackPackage?.(path);
  if(openHtmlBtn) openHtmlBtn.onclick=()=>window.pm3api.openPreviewFeedbackPreview?.(result.feedbackPreviewPath);
  if(copyPathBtn) copyPathBtn.onclick=async()=>{
    await navigator.clipboard.writeText(path);
    window.UIEngine?.toast?.("Feedback package path copied.","success");
  };
  if(copyTextBtn) copyTextBtn.onclick=async()=>{
    await navigator.clipboard.writeText(result.feedbackText || "");
    window.UIEngine?.toast?.("Feedback text copied.","success");
  };
}
function openPreviewFeedbackModal(){
  const build=previewBuildConfig();
  const draft=readPreviewFeedbackDraft();
  const body=`<div class="previewFeedbackForm">
    <label>Category<select id="previewFeedbackCategory"><option ${draft.category==="Bug"?"selected":""}>Bug</option><option ${draft.category==="Idea"?"selected":""}>Idea</option><option ${draft.category==="Improvement"?"selected":""}>Improvement</option><option ${draft.category==="Question"?"selected":""}>Question</option></select></label>
    <label>Title<input id="previewFeedbackTitle" placeholder="Short summary" value="${tableEscape(draft.title || "")}"></label>
    <label>Description<textarea id="previewFeedbackDescription" placeholder="What happened, what did you expect, and what should we know?">${tableEscape(draft.description || "")}</textarea></label>
    <div class="previewScreenshotPaste" id="previewFeedbackScreenshotPaste" tabindex="0">
      <b>Paste or drop extra screenshots here</b>
      <span>Click this box, then press Cmd+V, or drop one or more image files.</span>
      <small id="previewFeedbackScreenshotPasteStatus">No pasted screenshots attached.</small>
      <div id="previewFeedbackScreenshotPreview" class="previewScreenshotPreview"></div>
      <button type="button" id="previewFeedbackClearPastedScreenshot">Clear pasted screenshots</button>
    </div>
    <label class="inlineCheck"><input type="checkbox" id="previewFeedbackElectronLog" ${draft.includeElectronLog ? "checked" : ""}> Include Electron log</label>
    <label class="inlineCheck"><input type="checkbox" id="previewFeedbackDeviceLog" ${draft.includeDeviceLog ? "checked" : ""}> Include Device Console output</label>
    <p class="small">Logs and screenshots are only included when selected. Electron creates a local feedback package. Nothing is uploaded automatically.</p>
    <div class="previewFeedbackStatus" id="previewFeedbackStatus">${tableEscape(build.PREVIEW_LABEL || "Preview Build")}</div>
  </div>`;
  window.UIEngine?.modal({
    id:"electronPreviewFeedbackModal",
    title:"Send Feedback",
    subtitle:build.PREVIEW_LABEL || "Electron Preview",
    body,
    size:"md",
    closeOnOverlay:false,
    buttons:[
      {id:"previewFeedbackClearWindowBtn",text:"Clear feedback window",variant:"secondary",close:false,onClick:()=>{clearPreviewFeedbackDraft(); return false;}},
      {text:"Close",variant:"secondary"},
      {id:"previewFeedbackCreatePackageBtn",text:"Create Feedback Package",variant:"success",close:false,onClick:async({button})=>{
        savePreviewFeedbackDraft();
        const title=(document.getElementById("previewFeedbackTitle")?.value || "").trim();
        const description=(document.getElementById("previewFeedbackDescription")?.value || "").trim();
        const status=document.getElementById("previewFeedbackStatus");
        if(!title || !description){
          if(status) status.textContent="Enter a title and description before creating feedback.";
          return false;
        }
        button.disabled=true;
        if(status) status.textContent="Creating feedback package...";
        const result=await window.pm3api.submitPreviewFeedback?.({
          category:document.getElementById("previewFeedbackCategory")?.value || "Bug",
          title,
          description,
          includeElectronLog:!!document.getElementById("previewFeedbackElectronLog")?.checked,
          includeDeviceLog:!!document.getElementById("previewFeedbackDeviceLog")?.checked,
          pastedScreenshots:previewFeedbackPastedScreenshots,
          deviceLog:window.electronGetPm3Terminal?.() || "",
          activeDeviceProfile:feedbackDeviceProfile()
        });
        button.disabled=false;
        if(!result?.ok){
          if(status) status.textContent=result?.message || "Feedback package could not be created.";
          return false;
        }
        renderPreviewFeedbackResult(result);
        window.UIEngine?.toast?.("Feedback package created.","success");
        return false;
      }}
    ],
    onOpen:()=>window.HelpEngine?.refresh?.()
  });
  setTimeout(()=>{
    setupPreviewFeedbackScreenshotPaste();
    ["previewFeedbackCategory","previewFeedbackTitle","previewFeedbackDescription","previewFeedbackElectronLog","previewFeedbackDeviceLog"].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.addEventListener("input", savePreviewFeedbackDraft);
      if(el) el.addEventListener("change", savePreviewFeedbackDraft);
    });
  }, 0);
}


function closeExportConfirmModal(){
  const old=document.getElementById("exportConfirmOverlay");
  if(old) old.remove();
}

async function openExportConfirmModal(kind, exportAction){
  closeExportConfirmModal();

  const info=await window.pm3api.getBackupFolder();
  const overlay=document.createElement("div");
  overlay.id="exportConfirmOverlay";
  overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:9999;display:flex;align-items:center;justify-content:center;";

  const box=document.createElement("div");
  box.style.cssText="background:white;border-radius:18px;padding:16px 20px;max-width:400px;min-width:340px;box-shadow:0 18px 60px rgba(0,0,0,.32);font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:#111827;";

  box.innerHTML=`
    <h2 style="margin:0 0 14px 0;font-size:18px;">Export ${kind}?</h2>
    <p style="font-size:14px;margin:0 0 8px 0;">This file will be saved to:</p>
    <div style="font-size:13px;font-weight:600;word-break:break-word;margin-bottom:14px;">${tableEscape((info.current || "").replace(/^\/Users\/[^\/]+\//,"").replace(/^Documents\//,"Documents/"))}</div>
    <p style="font-size:14px;margin:0 0 6px 0;">To change the backup location:</p>
    <div style="margin:0 0 20px 0;font-size:14px;font-weight:700;color:#111827;">
      Electron → Settings...
      <button id="exportSettingsShortcut" title="Open Settings" style="border:none;background:transparent;padding:0 0 0 4px;margin:0;font-size:18px;font-weight:700;cursor:pointer;color:#2563eb;">⚙</button>
    </div>
    <div style="display:flex;gap:14px;justify-content:flex-end;">
      <button id="exportCancelBtn" style="font-size:16px;border:1px solid #ef4444;border-radius:12px;padding:8px 20px;background:#fff5f5;color:#b91c1c;cursor:pointer;">Cancel</button>
      <button id="exportDoBtn" style="font-size:16px;border:none;border-radius:12px;padding:8px 24px;background:#2563eb;color:white;cursor:pointer;">Export</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById("exportCancelBtn").onclick=closeExportConfirmModal;

  document.getElementById("exportSettingsShortcut").onclick=()=>{
    closeExportConfirmModal();
    window.pm3api.openSettingsWindow?.("settingsBackup");
  };

  document.getElementById("exportDoBtn").onclick=async()=>{
    document.getElementById("exportDoBtn").disabled=true;
    await exportAction();
    closeExportConfirmModal();
  };
}

function getSelectedAssets(){
  return (db.assets || []).filter(a=>selectedAssetIds.has(a.assetId));
}

function updateSelectionStatus(){
  const el=document.getElementById("selectionStatus");
  if(!el) return;
  const selected=getSelectedAssets().length;
  const visible=typeof getVisibleAssets==="function" ? getVisibleAssets().length : 0;
  el.textContent = `${selected} selected`;
  el.title = `${selected} selected. ${visible} currently visible.`;
}

function toggleInventorySelection(assetId, checked){
  if(checked) selectedAssetIds.add(assetId);
  else selectedAssetIds.delete(assetId);
  updateSelectionStatus();
}

function selectVisibleInventory(){
  getVisibleAssets().forEach(a=>selectedAssetIds.add(a.assetId));
  renderInventory();
  updateSelectionStatus();
}

function clearInventorySelection(){
  selectedAssetIds.clear();
  renderInventory();
  updateSelectionStatus();
}

function requireSelectedAssets(actionName){
  const selected=getSelectedAssets();
  if(!selected.length){
    appAlert("No RFID tags selected", `Use Select All or tick individual RFID tags before ${actionName}.`, "warning");
    return null;
  }
  return selected;
}
function appAlert(title, message, variant="primary"){
  const body=String(message||"").includes("<") ? String(message||"") : `<p>${tableEscape(String(message||""))}</p>`;
  if(window.UIEngine?.alert) return window.UIEngine.alert({title,body,variant:variant==="error"?"danger":variant,buttonText:"Close",size:"sm"});
  alert(`${title}\n\n${String(message||"").replace(/<[^>]+>/g," ")}`);
}
function appConfirm(title, message, options={}){
  if(window.UIEngine?.confirm) return window.UIEngine.confirm({title,body:message,confirmText:options.confirmText||"OK",cancelText:options.cancelText||"Cancel",danger:!!options.danger,variant:options.variant});
  return Promise.resolve(confirm(`${title}\n\n${String(message||"").replace(/<[^>]+>/g," ")}`));
}
function normaliseDatabase(next){
  const clean=JSON.parse(JSON.stringify(next || {}));
  clean.version=clean.version || 5;
  clean.settings=clean.settings || {lastAssignedNumber:0};
  if(!Array.isArray(clean.assets)) clean.assets=[];
  if(!Array.isArray(clean.log)) clean.log=[];
  clean.assets=[...clean.assets].sort((a,b)=>{
    const na=assetSortNumber(a);
    const nb=assetSortNumber(b);
    if(na!==nb) return na-nb;
    return String(a?.assetId || "").localeCompare(String(b?.assetId || ""));
  });
  return clean;
}

function collectionDiagnosticMessage(result){
  const errors=(result?.diagnostics || []).filter(item=>item?.severity==="error");
  return errors.map(item=>item.message).filter(Boolean).join("\n") || "The Collection change could not be saved.";
}

async function mutateCollection(operation,payload={},options={}){
  if(!window.pm3api?.mutateCollection){
    appAlert("Collection unavailable","The Collection Service is not available in this build.","error");
    return null;
  }
  const result=await window.pm3api.mutateCollection(operation,payload);
  if(!result?.ok){
    if(options.showError!==false) appAlert("Collection not changed",collectionDiagnosticMessage(result),"error");
    return null;
  }
  db=normaliseDatabase(result.database);
  if(options.notify!==false) window.pm3api.notifySettingsUpdated?.({type:"database"});
  return result;
}

async function updateCollectionSettings(changes){
  return mutateCollection("updateSettings",{changes},{notify:true});
}

function buildSelectedExportDb(){
  const selected=requireSelectedAssets("exporting");
  if(!selected) return null;
  const ids=new Set(selected.map(a=>a.assetId));
  return {
    version: db.version || 5,
    settings: db.settings || {},
    assets: JSON.parse(JSON.stringify(selected)),
    log: (db.log || []).filter(l=>{
      const id=String(l.assetId || "");
      if(ids.has(id)) return true;
      return [...ids].some(x=>id.includes(x));
    })
  };
}


function updateClearSearchButton(){
  const search=document.getElementById("search");
  const btn=document.getElementById("clearSearchBtn");
  if(!search || !btn) return;
  btn.style.display=search.value.trim() ? "block" : "none";
}

function clearInventorySearch(){
  const search=document.getElementById("search");
  if(!search) return;
  search.value="";
  clearDashboardFilter();
  renderInventory();
  updateClearSearchButton();
  search.focus();
}

function assetMatchesTextFilter(asset){
  const q=(document.getElementById("search")?.value || "").trim().toLowerCase();
  if(!q) return true;
  return fields.some(f=>String(asset?.[f] ?? "").toLowerCase().includes(q));
}

function getVisibleAssets(){
  return (db.assets || [])
    .filter(assetMatchesDashboardFilter)
    .filter(assetMatchesTextFilter);
}

function buildVisibleExportDb(){
  const visible=getVisibleAssets();
  const ids=new Set(visible.map(a=>a.assetId));
  return {
    version: db.version || 5,
    settings: db.settings || {},
    assets: JSON.parse(JSON.stringify(visible)),
    log: (db.log || []).filter(l=>{
      const id=String(l.assetId || "");
      if(ids.has(id)) return true;
      return [...ids].some(x=>id.includes(x));
    })
  };
}

function confirmExportJson(){
  const exportDb=buildSelectedExportDb(); if(!exportDb) return; openExportConfirmModal("JSON backup",()=>window.pm3api.exportJson(exportDb));
}

function confirmExportCsv(){
  const selected=requireSelectedAssets("exporting");
  if(!selected) return;
  openExportConfirmModal("CSV export",()=>window.pm3api.exportCsv(exportCsvString()));
}



function closeInventoryHelpModal(){
  const old=document.getElementById("inventoryHelpOverlay");
  if(old) old.remove();
}

function openInventoryHelpModal(){
  closeInventoryHelpModal();

  const overlay=document.createElement("div");
  overlay.id="inventoryHelpOverlay";
  overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:9999;display:flex;align-items:center;justify-content:center;";

  const box=document.createElement("div");
  box.style.cssText="background:white;border-radius:18px;padding:18px 22px;max-width:460px;min-width:360px;box-shadow:0 18px 60px rgba(0,0,0,.32);font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:#111827;";

  box.innerHTML=`
    <h2 style="margin:0 0 14px 0;font-size:20px;">Inventory Import / Export Help</h2>

    <div style="font-size:14px;line-height:1.45;">
      <p><b>Export JSON</b><br>Export the selected RFID tags as a JSON backup.</p>

      <p><b>Import Tags</b><br>Open a JSON backup and choose which RFID tags to import.</p>

      <p><b>Export CSV</b><br>Export the selected RFID tags for Excel, LibreOffice or Google Sheets.</p>

      <p><b>Note:</b><br>Export JSON and Export CSV use the selected RFID tags.<br>Import Tags lets you choose tags from the selected backup file.</p>
      <p>Complete database maintenance is available in Electron Settings.</p>
    </div>

    <div style="display:flex;justify-content:flex-end;margin-top:18px;">
      <button id="inventoryHelpCloseBtn" style="font-size:14px;border:none;border-radius:12px;padding:8px 22px;background:#2563eb;color:white;cursor:pointer;">OK</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById("inventoryHelpCloseBtn").onclick=closeInventoryHelpModal;
  overlay.onclick=e=>{ if(e.target===overlay) closeInventoryHelpModal(); };
}


function assetSortNumber(asset){
  const n=parseInt(String(asset?.assetId || "").replace(/[^0-9]/g,""),10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function tableEscape(v){
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function deviceConnectionNextStep(state,context){
  if(state.checking) return {text:"Electron is checking the current device state.",label:"",action:""};
  if(state.detected!==true) return {text:"Connect the Proxmark3 by USB, then check again.",label:"Check Device",action:"check"};
  if(context==="studio" && state.connected===true && state.sessionOwner==="console" && state.diagnostics!=="available"){
    return {text:"Device Console is using the PM3 port. Disconnect that session before running Full RF Check.",label:"Disconnect Console Session",action:"disconnect-console"};
  }
  if(context==="studio" && state.diagnostics!=="available"){
    return {text:"The USB device is ready for safe diagnostic measurements.",label:"Run Full RF Check",action:"full-check"};
  }
  if(state.connected!==true) return {text:"The USB device is visible. Start an active session to use it.",label:"Connect Device",action:"connect"};
  if(state.diagnostics!=="available"){
    return context==="studio"
      ? {text:"The session is ready. Run the safe RF check when you want diagnostic measurements.",label:"Run Full RF Check",action:"full-check"}
      : {text:"The session is ready. Open Device Studio to measure diagnostics.",label:"Open Device Studio",action:"open-studio"};
  }
  return {text:"The device session and latest diagnostics are ready.",label:"",action:""};
}

function deviceConnectionStatusItem(label,value,stateClass){
  return `<div class="deviceConnectionStatusItem ${stateClass}"><span>${tableEscape(label)}</span><b>${tableEscape(value)}</b></div>`;
}

function renderDeviceConnectionStatusCards(){
  document.querySelectorAll("[data-device-connection-status]").forEach(host=>{
    const state=deviceConnectionPresentationState;
    const context=host.dataset.statusContext || "shared";
    const usbValue=state.checking && state.detected===null ? "Checking..." : state.detected===true ? "Detected" : "Not detected";
    const sessionValue=state.connected===true
      ? `Connected${state.port ? ` · ${state.port}` : ""}`
      : "Not connected";
    const diagnosticsValue=state.diagnostics==="available"
      ? "Available"
      : state.diagnostics==="running" ? "Measuring..." : "Not yet measured";
    const next=deviceConnectionNextStep(state,context);
    host.innerHTML=`<section class="deviceConnectionStatusCard" aria-label="Proxmark3 connection status">
      <div class="deviceConnectionStatusHeading"><div><span>DEVICE CONNECTION</span><h3>Proxmark3 status</h3></div><small>The same connection information across Electron workspaces</small></div>
      <div class="deviceConnectionStatusGrid">
        ${deviceConnectionStatusItem("USB device",usbValue,state.detected===true?"ready":state.detected===false?"missing":"pending")}
        ${deviceConnectionStatusItem("Active session",sessionValue,state.connected===true?"ready":"pending")}
        ${deviceConnectionStatusItem("Diagnostics",diagnosticsValue,state.diagnostics==="available"?"ready":state.diagnostics==="running"?"pending":"unknown")}
      </div>
      <div class="deviceConnectionNextStep"><div><span>Recommended next step</span><b>${tableEscape(next.text)}</b></div>${next.action?`<button type="button" data-device-connection-action="${next.action}">${tableEscape(next.label)}</button>`:""}</div>
    </section>`;
    const action=host.querySelector("[data-device-connection-action]");
    if(action) action.onclick=async()=>{
      if(action.dataset.deviceConnectionAction==="check") await checkPm3();
      if(action.dataset.deviceConnectionAction==="connect") await startPm3();
      if(action.dataset.deviceConnectionAction==="disconnect-console") document.getElementById("stopPm3Btn")?.click();
      if(action.dataset.deviceConnectionAction==="open-studio") showTab("device-studio");
      if(action.dataset.deviceConnectionAction==="full-check") await window.DeviceStudioManager?.refreshDiagnostics?.({kind:"full"});
    };
  });
}

function updateDeviceConnectionStatus(patch={}){
  Object.assign(deviceConnectionPresentationState,patch);
  renderDeviceConnectionStatusCards();
  syncDeviceConnectionActionButtons();
}

function syncDeviceConnectionActionButtons(){
  const check=document.getElementById("listPm3Btn");
  const connect=document.getElementById("startPm3Btn");
  if(check){
    check.textContent=deviceConnectionPresentationState.detected===true ? "Check Again" : "Check Device";
    check.classList.toggle("green",deviceConnectionPresentationState.detected!==true);
  }
  if(connect){
    connect.textContent=deviceConnectionPresentationState.connected===true ? "Device Connected" : "Connect Device";
    connect.disabled=deviceConnectionPresentationState.connected===true || deviceConnectionPresentationState.checking===true;
    connect.classList.toggle("green",deviceConnectionPresentationState.detected===true && deviceConnectionPresentationState.connected!==true);
  }
}

window.DeviceConnectionStatusCard=Object.freeze({
  update:updateDeviceConnectionStatus,
  render:renderDeviceConnectionStatusCards,
  getState:()=>({...deviceConnectionPresentationState})
});

/* Inventory helpers moved to inventoryManager.js */
function today(){const d=new Date();return String(d.getDate()).padStart(2,"0")+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+d.getFullYear();}
function nowTime(){const d=new Date();return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")+":"+String(d.getSeconds()).padStart(2,"0");}
async function reserveNextAssetId(){
  const result=await mutateCollection("reserveAssetId",{}, {notify:false});
  return result?.summary?.assetId || "";
}
function normalizeUid(v){if(!v)return"";const h=v.replace(/[^0-9A-Fa-f]/g,"").toUpperCase();return h.length%2?v.trim():h.match(/.{1,2}/g).join(" ");}
function uidKey(v){return (v||"").replace(/[^0-9A-Fa-f]/g,"").toUpperCase();}
function parsePm3(t){
  const o={};
  const uid=t.match(/UID:\s*([0-9A-Fa-f ]+)/);
  const em=t.match(/EM\s*410x ID\s*([0-9A-Fa-f]+)/i);
  const hid=t.match(/HID\s+Prox\s+ID\s*[:=]?\s*([0-9A-Fa-fx ]{4,})/i) || t.match(/\braw\s*(?:ID|id)?\s*[:=]\s*([0-9A-Fa-fx ]{4,})/i);
  const atqa=t.match(/ATQA:\s*([0-9A-Fa-f ]+)/i);
  const sak=t.match(/SAK:\s*([0-9A-Fa-f]+)/i);
  if(uid)o.currentUid=normalizeUid(uid[1]);
  if(em)o.currentUid=em[1].toUpperCase();
  if(/Valid\s+HID\s+Prox\s+ID\s+found/i.test(t)&&hid)o.currentUid=hid[1].trim().toUpperCase();
  if(/MIFARE Classic 1K/i.test(t)){o.type="MIFARE Classic 1K";o.band="HF";o.frequency="13.56 MHz"}
  if(/EM410x/i.test(t)){o.type="EM410x";o.band="LF";o.frequency="125 kHz"}
  if(/Valid\s+HID\s+Prox\s+ID\s+found|HID\s+H10301|H10301/i.test(t)){o.type="HID H10301 26-bit";o.band="LF";o.frequency="125 kHz"}
  if(/ATR fingerprinting|Pre-issuing data|EF\.DIR|EMV|Try `emv reader`|Try `emv`/i.test(t)){
    o.type="ISO14443-A / EMV card";
    o.band="HF";
    o.frequency="13.56 MHz";
  }
  if(/ISO14443-A Information/i.test(t) && !o.type){o.type="ISO14443-A tag";o.band="HF";o.frequency="13.56 MHz"}
  if(/Magic capabilities.*Gen\s*1a/i.test(t))o.magic="Gen1A";
  if(/Prng.*weak|PRNG.*weak|Prng detection.*weak/i.test(t))o.prng="Weak";
  if(atqa)o.atqa=atqa[1].trim();
  if(sak)o.sak=sak[1].trim();
  if(/ATQA:\s*00 04/i.test(t)&&!o.band){o.band="HF";o.frequency="13.56 MHz"}
  return o;
}
function commandPromptSeen(t){
  return t.split(/\r?\n/).some(line =>
    /^\[[^\]]+\]\s*pm3\s*-->\s*$/.test(line.trim())
  );
}
/* Backup file detection moved to backupManager.js */
function getAsset(id){return db.assets.find(a=>a.assetId===id)}
function showTab(name){document.querySelectorAll("main > section").forEach(s=>s.classList.add("hidden"));document.getElementById("tab-"+name).classList.remove("hidden");document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));render();
  if(name==="live"){const panel=document.querySelector("#tab-live .commandSetPanel"); if(panel) panel.open=true; syncPm3TerminalElement(true); refreshPm3UsbPresenceInBackground?.();}
  if(name==="research" && window.ElectronResearchManager){window.ElectronResearchManager.renderResearchLibrary();}
  if(name==="portal" && window.ElectronPortalManager){window.ElectronPortalManager.refresh();}
  if(name==="device-studio" && window.DeviceStudioManager){window.DeviceStudioManager.init();}}
function clearDashboardFilter(){
  activeDashboardFilter=null;
}

function setTextFilter(v){
  clearDashboardFilter();
  document.getElementById("search").value=v||"";
  updateClearSearchButton();
  showTab("inventory");
}

function setDashboardFilter(filter){
  activeDashboardFilter=filter||null;
  document.getElementById("search").value="";
  updateClearSearchButton();
  showTab("inventory");
}

function assetMatchesDashboardFilter(asset){
  if(!activeDashboardFilter) return true;
  const field=activeDashboardFilter.field;
  const value=activeDashboardFilter.value;
  if(!field) return true;
  return String(asset?.[field] ?? "") === String(value ?? "");
}

function getDashboardFilterLabel(){
  if(!activeDashboardFilter) return "";
  return activeDashboardFilter.label || `${activeDashboardFilter.field}: ${activeDashboardFilter.value}`;
}

// Backwards-compatible helper for older code paths.
function setFilter(v){
  setTextFilter(v);
}
function render(){renderDashboard();renderStudioDirectory();renderInventory();renderRfidTagEditState();renderSelects();renderHistory();renderLog();renderRestore();renderBackupHint();renderLabel();renderCompareSelects();syncPm3TerminalElement();}
const studioDirectoryConfig=[
  {name:"Card Lab", kicker:"Recommended first step", description:"Start your first guided scan, identify the card and review Electron's explanation.", tab:"cardlab", state:"Recommended for your first scan", openLabel:"Start first scan", recommended:true},
  {name:"Device Studio", kicker:"Hardware laboratory", description:"Understand the physical Proxmark3: PCB components, live state and safe diagnostics.", tab:"device-studio", state:"Available now", openLabel:"Open"},
  {name:"Firmware Studio", kicker:"Firmware laboratory", description:"Review installed firmware, capabilities, source matching and firmware history through Device Studio.", tab:"device-studio", state:"Available in Device Studio", openLabel:"Open in Device Studio"},
  {name:"Signal Studio", kicker:"RF laboratory", description:"Review HF/LF antenna readings and carefully labelled signal measurements through Device Studio.", tab:"device-studio", state:"Available in Device Studio", openLabel:"Open in Device Studio"},
  {name:"Standalone Studio", kicker:"Standalone laboratory", description:"Learn about standalone behaviour, button gestures, LED roles, source mapping and safe simulation.", tab:"standalone-studio", state:"Available now", openLabel:"Open standalone workspace"},
  {name:"Collection", kicker:"Collection workspace", description:"Manage RFID records, backups, comparisons and labels.", tab:"inventory", state:"Available now", openLabel:"Open"},
  {name:"Advanced Console", kicker:"Advanced workspace", description:"Use direct PM3 commands and raw output when an expert workflow genuinely needs them.", tab:"live", state:"Available now", openLabel:"Open"}
];
function renderStudioDirectory(){
  const wrap=document.getElementById("studioDirectoryCards");
  if(!wrap) return;
  wrap.innerHTML=studioDirectoryConfig.map(studio=>`<button type="button" class="studioDirectoryCard${studio.recommended?" recommended":""}" data-studio-open="${tableEscape(studio.tab)}"><span>${tableEscape(studio.kicker)}</span><b>${tableEscape(studio.name)}</b><p>${tableEscape(studio.description)}</p><small>${tableEscape(studio.state)} <i>${tableEscape(studio.openLabel || "Open")}</i></small></button>`).join("");
  wrap.querySelectorAll("[data-studio-open]").forEach(button=>{
    button.onclick=()=>showTab(button.dataset.studioOpen);
  });
}
const dashboardCardConfig=[
  {label:"Total", field:null, value:null},
  {label:"HF", field:"band", value:"HF"},
  {label:"LF", field:"band", value:"LF"},
  {label:"Cards", field:"form", value:"Card"},
  {label:"Keyfobs", field:"form", value:"Keyfob"},
  {label:"Backed up", field:"backupStatus", value:"Backup available"},
  {label:"No backup", field:"backupStatus", value:"No backup"},
  {label:"Unusable", field:"status", value:"Unusable"}
];
function dashboardCountForFilter(assets, filter){
  if(!filter.field) return assets.length;
  return assets.filter(asset=>String(asset?.[filter.field] ?? "") === String(filter.value ?? "")).length;
}

function renderDashboard(){
  const a=db.assets;

  document.getElementById("dashboardCards").innerHTML=dashboardCardConfig
    .map((cfg,index)=>{
      const count=dashboardCountForFilter(a,cfg);
      return `<div class="card" data-filter-index="${index}"><span>${tableEscape(cfg.label)}</span><b>${count}</b></div>`;
    })
    .join("");

  document.querySelectorAll(".card").forEach(card=>{
    card.onclick=()=>{
      const cfg=dashboardCardConfig[Number(card.dataset.filterIndex)];
      if(!cfg || !cfg.field){
        setDashboardFilter(null);
      }else{
        setDashboardFilter({label:cfg.label, field:cfg.field, value:cfg.value});
      }
    };
  });

  const tc={},bc={};
  a.forEach(x=>{
    tc[x.type||"Unknown"]=(tc[x.type||"Unknown"]||0)+1;
    bc[x.backupStatus||"No backup"]=(bc[x.backupStatus||"No backup"]||0)+1;
  });

  document.getElementById("summaryTable").innerHTML=
    "<tr><th>Type</th><th>Count</th></tr>"+
    Object.entries(tc)
      .map(([k,v])=>`<tr class="dashboardFilterRow" data-field="type" data-value="${tableEscape(k)}" data-label="${tableEscape(k)}" title="Show RFID tags of this type"><td>${tableEscape(k)}</td><td>${v}</td></tr>`)
      .join("");

  document.getElementById("backupSummaryTable").innerHTML=
    "<tr><th>Status</th><th>Count</th></tr>"+
    Object.entries(bc)
      .map(([k,v])=>`<tr class="dashboardFilterRow" data-field="backupStatus" data-value="${tableEscape(k)}" data-label="${tableEscape(k)}" title="Show RFID tags with this backup status"><td>${tableEscape(k)}</td><td>${v}</td></tr>`)
      .join("");

  document.querySelectorAll(".dashboardFilterRow").forEach(row=>{
    row.onclick=()=>setDashboardFilter({
      label:row.dataset.label || row.dataset.value || "",
      field:row.dataset.field,
      value:row.dataset.value || ""
    });
  });
}

/* Inventory rendering moved to inventoryManager.js */

const fieldLimits = {
  alias: 40,
  source: 40,
  storage: 40,
  notes: 300
};

function fieldLimitInfo(f){
  const max = fieldLimits[f];
  return max ? `<div class="charCounter" id="counter_${f}">0 / ${max}</div>` : "";
}

function setupFieldLimits(){
  Object.entries(fieldLimits).forEach(([f,max])=>{
    const el=document.getElementById("f_"+f);
    const counter=document.getElementById("counter_"+f);
    if(!el || !counter) return;
    el.maxLength=max;
    const update=()=>{
      counter.textContent=`${el.value.length} / ${max}`;
      counter.classList.toggle("nearLimit", el.value.length >= Math.floor(max*0.85));
      counter.classList.toggle("atLimit", el.value.length >= max);
    };
    el.removeEventListener("input", el.__limitUpdate || (()=>{}));
    el.__limitUpdate=update;
    el.addEventListener("input", update);
    update();
  });
}


/* Moved to photoManager.js */

function readRfidTagOpenSearchFields(){
  const defaults=RFID_TAG_OPEN_SEARCH_FIELDS.filter(field=>field.defaultSelected).map(field=>field.id);
  try{
    const saved=JSON.parse(localStorage.getItem(RFID_TAG_OPEN_SEARCH_FIELDS_STORAGE_KEY)||"null");
    if(!Array.isArray(saved)) return defaults;
    const allowed=new Set(RFID_TAG_OPEN_SEARCH_FIELDS.map(field=>field.id));
    const selected=saved.filter(id=>allowed.has(id));
    return selected.length ? selected : defaults;
  }catch{
    return defaults;
  }
}

function saveRfidTagOpenSearchFields(selectedFields){
  try{
    localStorage.setItem(RFID_TAG_OPEN_SEARCH_FIELDS_STORAGE_KEY,JSON.stringify(selectedFields));
  }catch{
    // Search preferences are optional; the selector still works without storage.
  }
}

function renderRfidTagEditState(){
  const title=document.getElementById("rfidTagPageTitle");
  const status=document.getElementById("rfidTagSelectionStatus");
  const formTitle=document.getElementById("rfidTagFormTitle");
  const hasEditor=rfidTagEditState!=="none";
  document.querySelectorAll(".rfidTagEditorPanel").forEach(panel=>panel.classList.toggle("hidden",!hasEditor));
  if(!title||!status) return;

  if(rfidTagEditState==="new"){
    title.textContent="New RFID Tag";
    status.textContent="Creating a new RFID tag";
    if(formTitle) formTitle.textContent="New RFID Tag details";
    return;
  }
  if(rfidTagEditState==="existing"){
    const asset=getAsset(currentAssetId);
    const formAlias=document.getElementById("f_alias")?.value?.trim();
    const identity=formAlias || asset?.alias || currentAssetId || asset?.assetId || "RFID tag";
    const id=currentAssetId || asset?.assetId || "";
    title.textContent="Edit RFID Tag";
    status.textContent=id && identity!==id ? `Editing ${identity} · ${id}` : `Editing ${identity}`;
    if(formTitle) formTitle.textContent="RFID Tag details";
    return;
  }
  title.textContent="RFID Tag";
  status.textContent="No RFID tag selected";
  if(formTitle) formTitle.textContent="RFID Tag details";
}

function renderWorkspaceAssetSelection(selectId,statusId){
  const select=document.getElementById(selectId);
  const status=document.getElementById(statusId);
  const asset=getAsset(select?.value);
  if(status) status.textContent=asset
    ? `${asset.alias || "Unnamed RFID tag"} · ${asset.assetId}`
    : "No RFID tag selected.";
  return asset;
}

function openWorkspaceAssetSelector(selectId,statusId,onSelected){
  openRfidTagSelector({
    onSelect:asset=>{
      const select=document.getElementById(selectId);
      if(select) select.value=asset.assetId;
      renderWorkspaceAssetSelection(selectId,statusId);
      if(typeof onSelected==="function") onSelected(asset);
    }
  });
}

function openRfidTagSelector(options={}){
  if(!window.UIEngine?.modal){
    appAlert("RFID Tag selector unavailable","The RFID Tag selector could not be opened.","warning");
    return;
  }

  const selectAsset=assetId=>{
    const asset=getAsset(assetId);
    if(!asset) return false;
    if(typeof options.onSelect==="function") options.onSelect(asset);
    else openAsset(assetId);
    return true;
  };
  const assets=[...(db?.assets||[])].sort((left,right)=>
    String(left.assetId||"").localeCompare(String(right.assetId||""),undefined,{numeric:true})
  );
  const selectedSearchFields=new Set(readRfidTagOpenSearchFields());
  let selectedAssetId="";
  let sortField="assetId";
  let sortDirection="asc";
  const searchFieldOptions=RFID_TAG_OPEN_SEARCH_FIELDS.map(field=>`
    <label class="rfidTagSearchFieldOption">
      <input type="checkbox" value="${field.id}" ${selectedSearchFields.has(field.id)?"checked":""}>
      <span>${field.label}</span>
    </label>
  `).join("");

  window.UIEngine.modal({
    id:"rfidTagOpenModal",
    title:"Open RFID Tag",
    subtitle:"Select one existing tag from Collection",
    size:"lg",
    body:`
      <div class="rfidTagOpenControls">
        <label for="rfidTagOpenSearch">Search RFID Tags</label>
        <input id="rfidTagOpenSearch" type="search" placeholder="Search by RFID Tag ID or Alias / Name..." autocomplete="off">
      </div>
      <details class="rfidTagSearchOptions">
        <summary>More Search Options</summary>
        <div class="rfidTagSearchFieldGrid">${searchFieldOptions}</div>
      </details>
      <div id="rfidTagOpenResultCount" class="rfidTagOpenResultCount"></div>
      <div class="rfidTagOpenTableWrap">
        <table class="rfidTagOpenTable">
          <thead><tr><th data-sort-field="assetId" tabindex="0">RFID Tag ID</th><th data-sort-field="alias" tabindex="0">Alias / Name</th><th data-sort-field="currentUid" tabindex="0">Current UID</th><th data-sort-field="type" tabindex="0">Type</th><th data-sort-field="status" tabindex="0">Status</th></tr></thead>
          <tbody id="rfidTagOpenResults"></tbody>
        </table>
      </div>
    `,
    buttons:[
      {text:"Cancel",variant:"secondary"},
      {
        id:"rfidTagOpenConfirmBtn",
        text:"Open RFID Tag",
        variant:"success",
        disabled:true,
        onClick:()=>{
          if(!selectedAssetId) return false;
          return selectAsset(selectedAssetId);
        }
      }
    ],
    onOpen:({card,close})=>{
      const search=card.querySelector("#rfidTagOpenSearch");
      const results=card.querySelector("#rfidTagOpenResults");
      const count=card.querySelector("#rfidTagOpenResultCount");
      const openButton=card.querySelector("#rfidTagOpenConfirmBtn");
      const checkboxes=[...card.querySelectorAll(".rfidTagSearchFieldOption input")];
      const sortHeaders=[...card.querySelectorAll(".rfidTagOpenTable th[data-sort-field]")];

      const activeSearchFields=()=>checkboxes.filter(box=>box.checked).map(box=>box.value);
      const updateSortHeaders=()=>sortHeaders.forEach(header=>{
        const active=header.dataset.sortField===sortField;
        header.classList.toggle("is-sorted",active);
        header.dataset.sortDirection=active ? sortDirection : "";
        header.setAttribute("aria-sort",active ? (sortDirection==="asc"?"ascending":"descending") : "none");
      });
      const selectRow=assetId=>{
        selectedAssetId=assetId;
        results.querySelectorAll("tr[data-asset-id]").forEach(row=>{
          const selected=row.dataset.assetId===selectedAssetId;
          row.classList.toggle("is-selected",selected);
          row.setAttribute("aria-selected",selected?"true":"false");
        });
        if(openButton) openButton.disabled=!selectedAssetId;
      };
      const renderResults=()=>{
        const query=String(search?.value||"").trim().toLocaleLowerCase();
        const fields=activeSearchFields();
        const visible=assets.filter(asset=>
          !query || fields.some(field=>String(asset?.[field]??"").toLocaleLowerCase().includes(query))
        ).sort((left,right)=>{
          const comparison=String(left?.[sortField]??"").localeCompare(String(right?.[sortField]??""),undefined,{numeric:true,sensitivity:"base"});
          return sortDirection==="asc" ? comparison : -comparison;
        });
        if(selectedAssetId && !visible.some(asset=>asset.assetId===selectedAssetId)) selectedAssetId="";
        count.textContent=visible.length===0 ? "No RFID tags found" : visible.length===1 ? "1 RFID tag found" : `${visible.length} RFID tags found`;
        results.innerHTML=visible.length ? visible.map(asset=>`
          <tr data-asset-id="${tableEscape(asset.assetId)}" tabindex="0" aria-selected="${asset.assetId===selectedAssetId?"true":"false"}" class="${asset.assetId===selectedAssetId?"is-selected":""}">
            <td>${tableEscape(asset.assetId||"—")}</td>
            <td>${tableEscape(asset.alias||"—")}</td>
            <td>${tableEscape(asset.currentUid||"—")}</td>
            <td>${tableEscape(asset.type||"—")}</td>
            <td>${tableEscape(asset.status||"—")}</td>
          </tr>
        `).join("") : `<tr><td colspan="5" class="rfidTagOpenEmpty">${assets.length?"No matching RFID tags.":"No RFID tags are saved in Collection yet."}</td></tr>`;
        results.querySelectorAll("tr[data-asset-id]").forEach(row=>{
          row.onclick=()=>selectRow(row.dataset.assetId);
          row.ondblclick=()=>{
            const assetId=row.dataset.assetId;
            close();
            selectAsset(assetId);
          };
          row.onkeydown=event=>{
            if(event.key==="Enter"||event.key===" "){
              event.preventDefault();
              selectRow(row.dataset.assetId);
            }
          };
        });
        if(openButton) openButton.disabled=!selectedAssetId;
      };

      if(search) search.oninput=renderResults;
      sortHeaders.forEach(header=>{
        const changeSort=()=>{
          const field=header.dataset.sortField;
          if(sortField===field) sortDirection=sortDirection==="asc"?"desc":"asc";
          else{
            sortField=field;
            sortDirection="asc";
          }
          updateSortHeaders();
          renderResults();
        };
        header.onclick=changeSort;
        header.onkeydown=event=>{
          if(event.key==="Enter"||event.key===" "){
            event.preventDefault();
            changeSort();
          }
        };
      });
      checkboxes.forEach(checkbox=>{
        checkbox.onchange=()=>{
          if(!activeSearchFields().length) checkbox.checked=true;
          saveRfidTagOpenSearchFields(activeSearchFields());
          renderResults();
        };
      });
      updateSortHeaders();
      renderResults();
      search?.focus();
    }
  });
}

function buildEditForm(){
  document.getElementById("editForm").innerHTML=editFields.map(f=>
    f==="notes"
      ? `<label>${labels[f]}<textarea class="notesField" id="f_${f}"></textarea>${fieldLimitInfo(f)}</label>`
      : selects[f]
        ? `<label>${labels[f]}<select id="f_${f}">${selects[f].map(v=>`<option>${v}</option>`).join("")}</select>${fieldLimitInfo(f)}</label>`
        : `<label>${labels[f]}<input id="f_${f}">${fieldLimitInfo(f)}</label>`
  ).join("");
  setupFieldLimits();
}
function fillForm(a,{persisted=true}={}){
  currentAssetId=persisted ? (a?.assetId||null) : null;
  rfidTagEditState=a ? (persisted ? "existing" : "new") : "none";
  editFields.forEach(f=>document.getElementById("f_"+f).value=a?.[f]||"");
  updatePhotoPanel(a);
  if(typeof renderBackupFields==="function") renderBackupFields(a);
  setupFieldLimits();
  renderRfidTagEditState();
}
function readForm(){
const a={};
editFields.forEach(f=>a[f]=document.getElementById("f_"+f).value.trim());
return a;
}

/* Moved to photoManager.js */

function assetLogSnapshot(asset){
  if(!asset) return null;
  const copy={...asset};
  if(copy.photo) copy.photo=photoLogSnapshot(copy.photo);
  return copy;
}

function assetLogString(asset){
  return JSON.stringify(assetLogSnapshot(asset));
}

async function newAsset(){
  const assetId=await reserveNextAssetId();
  if(!assetId) return;
  fillForm({assetId,status:"Active",backupStatus:"No backup"},{persisted:false});
}
async function saveAsset(){
  const fields=readForm();
  const existing=currentAssetId ? getAsset(currentAssetId) : null;
  const result=existing
    ? await mutateCollection("edit",{targetAssetId:currentAssetId,changes:fields})
    : await mutateCollection("create",{fields});
  if(!result) return;
  currentAssetId=result.record?.assetId || null;
  rfidTagEditState=currentAssetId ? "existing" : "none";
  render();
  showTab("inventory");
}
async function parseAsNew(){const p=parsePm3(document.getElementById("scanInput").value);await newAsset();Object.entries(p).forEach(([k,v])=>{const el=document.getElementById("f_"+k);if(el)el.value=v});if(p.currentUid)document.getElementById("f_originalUid").value=p.currentUid;lastParsedScan=p;renderUidMatchPanel(p);}
function updateFromScan(){if(!document.getElementById("f_assetId").value.trim())return appAlert("Select a tag first","Select or create an RFID tag first.","warning");const p=parsePm3(document.getElementById("scanInput").value);Object.entries(p).forEach(([k,v])=>{const el=document.getElementById("f_"+k);if(el)el.value=v});lastParsedScan=p;renderUidMatchPanel(p);}
async function duplicateAsset(){
  const changes=readForm();
  const result=await mutateCollection("duplicate",{
    sourceAssetId:currentAssetId || changes.assetId,
    changes
  });
  if(!result) return;
  currentAssetId=result.record?.assetId || null;
  rfidTagEditState=currentAssetId ? "existing" : "none";
  render();
  showTab("inventory");
}
async function markUnusable(){document.getElementById("f_status").value="Unusable";document.getElementById("f_notes").value=(document.getElementById("f_notes").value+" | Marked unusable "+today()).trim();await saveAsset();}
async function deleteAsset(){const id=currentAssetId || document.getElementById("f_assetId").value.trim();if(!id||!confirm(`Delete ${id}? Use this only for database mistakes. Asset numbers are not reused.`))return;const result=await mutateCollection("delete",{assetId:id});if(!result)return;currentAssetId=null;rfidTagEditState="none";render();showTab("inventory");}
/* Moved to photoManager.js */

function findUidMatches(uid){const key=uidKey(uid);if(!key)return[];const matches=[];db.assets.forEach(a=>{if(uidKey(a.currentUid)===key)matches.push({asset:a,where:"Current UID"});else if(uidKey(a.originalUid)===key)matches.push({asset:a,where:"Original UID"});else if((a.uidHistory||[]).some(h=>uidKey(h.uid)===key))matches.push({asset:a,where:"UID History"});});return matches;}
function renderUidMatchPanel(scan){const box=document.getElementById("scanSummary");if(!box)return;if(!scan||!scan.currentUid){box.className="matchPanel";box.innerHTML="No UID parsed yet.";return;}const refreshHelp=()=>setTimeout(()=>window.HelpEngine?.refresh?.(), 0);const matches=findUidMatches(scan.currentUid);lastParsedScan=scan;if(matches.length===0){box.className="matchPanel good";box.innerHTML=`<b>🟢 New tag detected</b><br>UID: <code>${scan.currentUid}</code><br>Type: ${scan.type||"Unknown"}<div class="toolbar"><button data-help-topic="uidRegisterNewBtn" onclick="registerLastScan()">Register as new physical asset</button></div>`;refreshHelp();return;}box.className="matchPanel warn";box.innerHTML=`<b>⚠️ Existing UID found</b><br>UID: <code>${scan.currentUid}</code> &nbsp; Type: ${scan.type||"Unknown"} &nbsp; Magic: ${scan.magic||""} &nbsp; PRNG: ${scan.prng||""}<br>`+matches.map(m=>`<div class="matchRow"><b>${m.asset.assetId}</b> ${m.asset.alias||""} <span class="small">(${m.where})</span><button onclick="openAsset('${m.asset.assetId}')">Open</button><button data-help-topic="uidRegisterCloneBtn" onclick="makeCloneOf('${m.asset.assetId}')">Register clone</button></div>`).join("")+`<div class="toolbar"><button data-help-topic="uidRegisterNewBtn" onclick="registerLastScan()">Register as new physical asset anyway</button></div>`;refreshHelp();}
async function registerLastScan(){if(!lastParsedScan)return;await newAsset();Object.entries(lastParsedScan).forEach(([k,v])=>{const el=document.getElementById("f_"+k);if(el)el.value=v});if(lastParsedScan.currentUid)document.getElementById("f_originalUid").value=lastParsedScan.currentUid;showTab("edit");}
window.electronPrepareScanForInventory=async function(rawOutput){
  const raw=String(rawOutput || "").trim();
  if(!raw) return false;
  const input=document.getElementById("scanInput");
  if(input) input.value=raw;
  showTab("edit");
  await parseAsNew();
  setCommandStatus("Status: Scan prepared as a new RFID Tag. Review the details, then select Save RFID Tag.");
  return true;
};
function openAsset(id){fillForm(getAsset(id));showTab("edit");}
async function makeCloneOf(id){const source=getAsset(id);await registerLastScan();document.getElementById("f_cloneOf").value=id;document.getElementById("f_status").value="Cloned";document.getElementById("f_alias").value=(source?.alias||id)+" - Clone";document.getElementById("f_source").value=source?.source||"";document.getElementById("f_storage").value=source?.storage||"";document.getElementById("f_form").value=source?.form||document.getElementById("f_form").value;document.getElementById("f_color").value=source?.color||document.getElementById("f_color").value;document.getElementById("f_notes").value=`Physical clone of ${id}\nCreated: ${today()}`;setCommandStatus("🟢 Clone form prepared from "+id);}
function renderSelects(){
  const opts=db.assets.map(a=>`<option value="${a.assetId}">${a.assetId} — ${a.alias||a.currentUid}</option>`).join("");
  const backup=document.getElementById("backupAsset");
  if(backup) backup.innerHTML=opts;
  ["restoreAsset","labelAsset"].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    const old=el.value;
    el.innerHTML=`<option value="">Select RFID tag...</option>${opts}`;
    el.value=old && getAsset(old) ? old : "";
  });
}
function renderHistory(){document.getElementById("historyTable").innerHTML="<tr><th>RFID Tag</th><th>Date</th><th>UID</th><th>Reason</th></tr>"+db.assets.flatMap(a=>(a.uidHistory||[]).map(h=>`<tr><td>${a.assetId}</td><td>${h.date}</td><td>${h.uid}</td><td>${h.reason||""}</td></tr>`)).join("");}




/* Change Log functions moved to changeLogManager.js */

/* Backup metadata functions moved to backupManager.js */
function restoreFileName(file){return typeof file==="string"?file:(file?.name||"");}
function restoreFindFile(asset, pattern){return (asset?.backupFiles||[]).map(restoreFileName).find(name=>pattern.test(name||""))||"";}
function restoreWarnings(asset,target,dump){
  const warnings=[];
  const isLf=asset?.band==="LF"||/EM410x|HID|Hitag|T55/i.test(asset?.type||"");
  const isClassic=/MIFARE Classic/i.test(asset?.type||"")||asset?.band==="HF";
  if(!asset) warnings.push("No RFID tag selected.");
  if(target.includes("Gen1A")&&!isClassic) warnings.push("Selected target is a MIFARE Classic magic card, but this RFID tag is not clearly MIFARE Classic.");
  if(target.includes("EM410x")&&!isLf) warnings.push("Selected target is an LF/T5577 workflow, but this RFID tag is not clearly LF.");
  if(target.includes("Gen1A")&&!dump) warnings.push("No registered dump .bin backup was found for this RFID tag.");
  if(asset?.backupStatus==="Backup registered with warnings") warnings.push("The saved backup has validation warnings. Review Backup info on the RFID Tag screen before any restore.");
  return warnings;
}
function renderRestore(){
  const a=renderWorkspaceAssetSelection("restoreAsset","restoreAssetStatus");
  const generate=document.getElementById("generateRestoreBtn");
  const copy=document.getElementById("copyRestoreBtn");
  if(generate) generate.disabled=!a;
  if(copy) copy.disabled=!a;
  if(!a){
    document.getElementById("restoreCommands").textContent="No RFID tag selected.";
    return;
  }
  const target=document.getElementById("restoreTarget")?.value||"";
  const dump=restoreFindFile(a,/dump\.bin$/i);
  const uid=(a.currentUid||"").replace(/[^0-9A-Fa-f]/g,"").toUpperCase();
  const warnings=restoreWarnings(a,target,dump);
  let txt=`# Restore Helper - review only\n# RFID Tag: ${a.assetId} - ${a.alias||""}\n# Current UID/ID: ${a.currentUid||"unknown"}\n# Type: ${a.type||"unknown"}\n# Target: ${target||"unknown"}\n\n`;
  txt+=`# Safety checks\n${warnings.length?warnings.map(w=>`# WARNING: ${w}`).join("\n"):"# Basic card/target checks passed."}\n# Electron does not run restore/write commands automatically.\n# Only continue when you own the card/tag and the blank target is correct.\n\n`;
  if(target.includes("Gen1A")){
    txt+=`# Safe restore order for Magic Gen1A MIFARE Classic 1K\n# 1. Verify the blank target card first:\nhf search\nhf mf info\n\n# 2. Confirm the registered backup belongs to this RFID tag:\n# Dump: ${dump||"NO_REGISTERED_DUMP_BIN"}\n\n# 3. Manual restore command - review your PM3 build syntax before running:\n# hf mf cload -f ${dump||"PATH_TO_DUMP_BIN"}\n\n# 4. Verify after restore:\nhf search\nhf mf info\n\n# No automatic writes are performed by Electron.\n`;
  }else if(target.includes("EM410x")){
    txt+=`# Safe LF/T5577 restore/copy review\n# 1. Verify the writable LF target first:\nlf search\n\n# 2. Confirm the ID to write/copy:\n# ID: ${uid||"NO_CURRENT_ID"}\n\n# 3. Manual write command - only for a blank authorised T5577/test tag:\n# lf em 410x clone --id ${uid||"HEX_ID_HERE"}\n\n# 4. Verify after write:\nlf search\n\n# No automatic writes are performed by Electron.\n`;
  }else{
    txt+="# Manual restore recommended.\n# Select a target type and register a validated backup before preparing write commands.\n";
  }
  document.getElementById("restoreCommands").textContent=txt;
}
function renderLabel(){
  const a=renderWorkspaceAssetSelection("labelAsset","labelAssetStatus");
  const refresh=document.getElementById("refreshLabelBtn");
  const print=document.getElementById("printLabelBtn");
  if(refresh) refresh.disabled=!a;
  if(print) print.disabled=!a;
  const preview=document.getElementById("labelPreview");
  if(!a){
    if(preview) preview.innerHTML='<div class="small">No RFID tag selected.</div>';
    return;
  }
  const style=document.getElementById("labelStyle")?.value||"Compact";
  preview.innerHTML=style==="Compact"
    ? `<div class="asset">${a.assetId}</div><div class="alias">${a.alias||""}</div><div class="uid">${a.currentUid||""}</div>`
    : `<div class="asset">${a.assetId}</div><div class="alias">${a.alias||""}</div><div class="uid">UID: ${a.currentUid||""}</div><div class="uid">Type: ${a.type||""}</div><div class="uid">Status: ${a.status||""}</div>`;
}
function printLabel(){const html=`<html><head><title>Label</title><style>body{font-family:Arial}.label{border:2px solid #000;padding:12px;display:inline-block}.asset{font-size:26px;font-weight:800}.alias{font-size:16px;font-weight:700}.uid{font-family:monospace;font-size:14px;margin-top:6px}</style></head><body><div class="label">${document.getElementById("labelPreview").innerHTML}</div><script>window.print()<\/script></body></html>`;const w=window.open("");w.document.write(html);w.document.close();}


function importComparableFields(){
  return fields.filter(f=>!["dateAdded","lastUpdated"].includes(f));
}

function importFieldDiffs(currentAsset, importedAsset){
  return DeltaEngine.diffObjects(currentAsset, importedAsset, {
    fields,
    labels,
    ignoreFields:["dateAdded","lastUpdated"]
  });
}

function importAssetStatus(importedAsset){
  return DeltaEngine.assetStatus(getAsset(importedAsset?.assetId), importedAsset, {
    fields,
    labels,
    ignoreFields:["dateAdded","lastUpdated"]
  });
}

function renderImportCompactChangePreview(importedAsset){
  const current=getAsset(importedAsset?.assetId);
  const status=importAssetStatus(importedAsset);
  const diffs=importFieldDiffs(current, importedAsset);

  if(status==="New"){
    return `<div class="compactChangeLine"><span class="changeLabel newLabel">New</span><span class="changeText">${tableEscape(JSON.stringify(importedAsset||{}))}</span></div>`;
  }

  if(!current){
    return `<span class="small">Will be added</span>`;
  }

  if(!diffs.length){
    return `<span class="small">No changes</span>`;
  }

  return `
    <div class="compactChangeLine"><span class="changeLabel previousLabel">Previous</span><span class="changeText">${tableEscape(JSON.stringify(current||{}))}</span></div>
    <div class="compactChangeLine"><span class="changeLabel newLabel">New</span><span class="changeText">${tableEscape(JSON.stringify(importedAsset||{}))}</span></div>
  `;
}

function renderImportDiffDetails(importedAsset){
  const current=getAsset(importedAsset?.assetId);
  if(!current){
    return `<div class="small">This RFID Tag ID does not exist in the current inventory. It will be added as a new RFID tag.</div>`;
  }

  const diffs=importFieldDiffs(current, importedAsset);
  if(!diffs.length){
    return `<div class="small">No field differences found.</div>`;
  }

  return `
    <div style="font-weight:800;margin-bottom:8px;">Changes for ${tableEscape(importedAsset.assetId || "Unknown RFID Tag")}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr><th>Field</th><th>Current inventory</th><th>Import file</th></tr></thead>
      <tbody>
        ${diffs.map(d=>`
          <tr>
            <td><b>${tableEscape(d.label)}</b></td>
            <td style="white-space:normal;">${tableEscape(d.currentValue)}</td>
            <td style="white-space:normal;">${tableEscape(d.importValue)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;
}


function closeImportPreviewModal(){
  const old=document.getElementById("importPreviewOverlay");
  if(old) old.remove();
}

function openImportPreviewModal(importedDb){
  const importedAssets=Array.isArray(importedDb?.assets) ? importedDb.assets : [];
  if(!importedAssets.length){
    appAlert("No RFID tags found", "No RFID tags were found in this JSON file.", "warning");
    return false;
  }

  closeImportPreviewModal();

  const selectedImportRows=new Set();

  const existingCount = importedAssets.filter(a=>getAsset(a.assetId)).length;
  const newCount = importedAssets.length - existingCount;
  const changedCount = importedAssets.filter(a=>importAssetStatus(a)==="Changed").length;
  const identicalCount = importedAssets.filter(a=>importAssetStatus(a)==="Identical").length;

  const overlay=document.createElement("div");
  overlay.id="importPreviewOverlay";
  overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:10000;display:flex;align-items:center;justify-content:center;padding:22px;";

  const box=document.createElement("div");
  box.style.cssText="background:white;border-radius:18px;width:96vw;max-width:1800px;min-width:min(1100px,96vw);max-height:94vh;box-shadow:0 18px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;color:#111827;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden;";

  const rows=importedAssets.map((a,i)=>{
    const status=importAssetStatus(a);
    const diffs=importFieldDiffs(getAsset(a.assetId), a);
    const changesCell=renderImportCompactChangePreview(a);

    return `<tr>
      <td style="text-align:center;"><input type="checkbox" class="importPreviewCheck" data-index="${i}"></td>
      <td><b>${tableEscape(a.assetId || "Unknown")}</b></td>
      <td>${tableEscape(a.alias || "")}</td>
      <td>${tableEscape(a.type || "")}</td>
      <td>${tableEscape(a.currentUid || "")}</td>
      <td><b>${status}</b></td>
      <td class="logChangeCell importReviewChangeCell" data-index="${i}" title="Double-click to open full change details">${changesCell}</td>
    </tr>`;
  }).join("");

  box.innerHTML=`
    <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc;">
      <h2 style="margin:0 0 6px 0;font-size:20px;">Import RFID Tags</h2>
      <div class="small">Found in: <b>${importedDb.__fileName || "Unknown file"}</b></div>
      <div class="small">Tags in file: <b>${importedAssets.length}</b></div>
      <div class="small">Already in inventory: <b>${existingCount}</b></div>
      <div class="small">Changed: <b>${changedCount}</b> &nbsp; | &nbsp; Identical: <b>${identicalCount}</b> &nbsp; | &nbsp; New: <b>${newCount}</b></div>
      <div class="small" id="importPreviewSelectedCount">Selected: 0</div>
    </div>

    <div style="padding:14px 20px;overflow:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th>Select</th>
            <th>RFID Tag ID</th>
            <th>Alias</th>
            <th>Type</th>
            <th>Current UID</th>
            <th>Status</th>
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div style="padding:14px 20px;border-top:1px solid #e5e7eb;background:#f8fafc;display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap;">
      <div style="display:flex;gap:10px;">
        <button id="importPreviewSelectAllBtn">Select All</button>
        <button id="importPreviewClearBtn">Clear Selection</button>
        <button id="importPreviewReviewAllBtn">Review All Changes</button>
      </div>
      <div style="display:flex;gap:10px;">
        <button id="importPreviewCancelBtn" style="background:#fff5f5;color:#b91c1c;border:1px solid #ef4444;">Cancel</button>
        <button id="importPreviewDoBtn" class="green">Import Selected (0)</button>
      </div>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function updateImportPreviewCount(){
    const n=selectedImportRows.size;
    let selectedChanged=0;
    let selectedIdentical=0;
    let selectedNew=0;

    selectedImportRows.forEach(i=>{
      const status=importAssetStatus(importedAssets[i]);
      if(status==="Changed") selectedChanged++;
      else if(status==="Identical") selectedIdentical++;
      else if(status==="New") selectedNew++;
    });

    document.getElementById("importPreviewSelectedCount").textContent =
      n > 0
        ? `Selected: ${n} (${selectedChanged} changed, ${selectedIdentical} identical, ${selectedNew} new)`
        : "Selected: 0";
    const btn=document.getElementById("importPreviewDoBtn");
    btn.textContent=`Import Selected (${n})`;
    btn.disabled=n===0;
  }

  document.querySelectorAll(".importReviewChangeCell").forEach(td=>{
    td.ondblclick=()=>{
      const importedAsset=importedAssets[Number(td.dataset.index)];
      const currentAsset=getAsset(importedAsset?.assetId);

      if(importAssetStatus(importedAsset)==="Identical") return;

      showDeltaDetail(
        "Review Changes Before Import",
        `${importedAsset?.assetId || "Unknown RFID Tag"} — ${importedAsset?.alias || ""}`,
        JSON.stringify(currentAsset || {}, null, 2),
        JSON.stringify(importedAsset || {}, null, 2)
      );
    };
  });

  document.querySelectorAll(".importPreviewCheck").forEach(chk=>{
    chk.onchange=()=>{
      const idx=Number(chk.dataset.index);
      if(chk.checked) selectedImportRows.add(idx);
      else selectedImportRows.delete(idx);
      updateImportPreviewCount();
    };
  });

  document.getElementById("importPreviewSelectAllBtn").onclick=()=>{
    selectedImportRows.clear();
    document.querySelectorAll(".importPreviewDiffBtn").forEach(btn=>{
    btn.onclick=(e)=>{
      e.stopPropagation();
      const row=document.getElementById(`importDiffRow_${btn.dataset.index}`);
      if(!row) return;

      row.classList.toggle("hidden");

      const isOpen=!row.classList.contains("hidden");
      const count=(btn.textContent.match(/\((\d+)\)/)||[])[1] || "";
      btn.textContent=isOpen ? "Close View Changes" : `View Changes (${count})`;
    };
  });

  document.querySelectorAll(".importPreviewCheck").forEach(chk=>{
      chk.checked=true;
      selectedImportRows.add(Number(chk.dataset.index));
    });
    updateImportPreviewCount();
  };

  document.getElementById("importPreviewClearBtn").onclick=()=>{
    selectedImportRows.clear();
    document.querySelectorAll(".importPreviewCheck").forEach(chk=>chk.checked=false);
    updateImportPreviewCount();
  };

  document.getElementById("importPreviewReviewAllBtn").onclick=()=>{
    const changedAssets=importedAssets.filter(a=>importAssetStatus(a)==="Changed");
    if(!changedAssets.length){
      appAlert("No changed RFID tags", "No changed RFID tags were found in this import file.", "warning");
      return;
    }

    const currentCombined={};
    const importCombined={};

    changedAssets.forEach(a=>{
      const key=`${a.assetId || "Unknown"} — ${a.alias || ""}`;
      currentCombined[key]=getAsset(a.assetId) || {};
      importCombined[key]=a || {};
    });

    showDeltaDetail(
      "Review All Changes Before Import",
      `${changedAssets.length} changed RFID tag${changedAssets.length===1 ? "" : "s"}`,
      JSON.stringify(currentCombined, null, 2),
      JSON.stringify(importCombined, null, 2)
    );
  };

  document.getElementById("importPreviewCancelBtn").onclick=closeImportPreviewModal;
  overlay.onclick=e=>{ if(e.target===overlay) closeImportPreviewModal(); };

  document.getElementById("importPreviewDoBtn").onclick=()=>{
    const selectedAssets=[...selectedImportRows].map(i=>importedAssets[i]).filter(Boolean);
    importSelectedPreviewAssets(selectedAssets);
  };

  updateImportPreviewCount();
}

async function importSelectedPreviewAssets(candidates){
  if(!candidates.length){
    appAlert("No RFID tags selected", "Select one or more RFID tags before importing.", "warning");
    return false;
  }

  const counts={};
  candidates.forEach(a=>{
    counts[a.assetId]=(counts[a.assetId]||0)+1;
  });

  const duplicates=Object.entries(counts).filter(([,count])=>count>1);
  if(duplicates.length){
    appAlert("Duplicate RFID Tag IDs", `<p>Multiple selected records use the same RFID Tag ID.</p><ul>${duplicates.map(([id,count])=>`<li>${tableEscape(id)}: ${count} selected records</li>`).join("")}</ul><p>Please select only one record per RFID Tag ID.</p>`, "warning");
    return false;
  }

  const result=await mutateCollection("legacyImport",{candidates});
  if(!result) return false;
  const added=result.summary?.added || 0;
  const updated=result.summary?.updated || 0;
  render();
  closeImportPreviewModal();

  appAlert("Import complete", `Added: ${added}<br>Updated: ${updated}`, "success");
  return true;
}


function exportFileComparableFields(){
  return fields.filter(f=>!["dateAdded","lastUpdated"].includes(f));
}

function exportFileFieldDiffs(currentAsset, fileAsset){
  return DeltaEngine.diffObjects(fileAsset, currentAsset, {
    fields,
    labels,
    ignoreFields:["dateAdded","lastUpdated"]
  });
}

function exportFileAssetStatus(currentAsset, fileAsset){
  if(!fileAsset) return "New";
  return exportFileFieldDiffs(currentAsset, fileAsset).length ? "Changed" : "Identical";
}

function renderExportUpdateCompactChangePreview(currentAsset, fileAsset){
  const status=exportFileAssetStatus(currentAsset, fileAsset);

  if(status==="New"){
    return `<div class="compactChangeLine"><span class="changeLabel newLabel">New</span><span class="changeText">${tableEscape(JSON.stringify(currentAsset||{}))}</span></div>`;
  }

  if(status==="Identical"){
    return `<span class="small">No changes</span>`;
  }

  return `
    <div class="compactChangeLine"><span class="changeLabel previousLabel">Previous</span><span class="changeText">${tableEscape(JSON.stringify(fileAsset||{}))}</span></div>
    <div class="compactChangeLine"><span class="changeLabel newLabel">New</span><span class="changeText">${tableEscape(JSON.stringify(currentAsset||{}))}</span></div>
  `;
}

function closeUpdateExportPreviewModal(){
  const old=document.getElementById("updateExportOverlay");
  if(old) old.remove();
}

function openUpdateExportPreviewModal(fileDb, modeLabel="Update Existing Export"){
  const fileAssets=Array.isArray(fileDb?.assets) ? fileDb.assets : [];
  const fileMap=new Map(fileAssets.map(a=>[a.assetId,a]));
  const currentAssets=(db.assets || []);

  if(!currentAssets.length){
    appAlert("No RFID tags found", "No RFID tags were found in the current inventory.", "warning");
    return false;
  }

  closeUpdateExportPreviewModal();

  const selectedRows=new Set();
  const statusFor=a=>exportFileAssetStatus(a,fileMap.get(a.assetId));
  const changedCount=currentAssets.filter(a=>statusFor(a)==="Changed").length;
  const identicalCount=currentAssets.filter(a=>statusFor(a)==="Identical").length;
  const newCount=currentAssets.filter(a=>statusFor(a)==="New").length;

  const overlay=document.createElement("div");
  overlay.id="updateExportOverlay";
  overlay.className="updateExportOverlay";

  const box=document.createElement("div");
  box.className="updateExportModal";

  const rows=currentAssets.map((a,i)=>{
    const fileAsset=fileMap.get(a.assetId);
    const status=statusFor(a);
    const changesCell=renderExportUpdateCompactChangePreview(a,fileAsset);

    return `<tr>
      <td style="text-align:center;"><input type="checkbox" class="updateExportCheck" data-index="${i}"></td>
      <td><b>${tableEscape(a.assetId || "Unknown")}</b></td>
      <td>${tableEscape(a.alias || "")}</td>
      <td>${tableEscape(a.type || "")}</td>
      <td>${tableEscape(a.currentUid || "")}</td>
      <td><b>${status}</b></td>
      <td class="logChangeCell updateExportChangeCell" data-index="${i}" title="Double-click to open full change details">${changesCell}</td>
    </tr>`;
  }).join("");

  box.innerHTML=`
    <div class="updateExportModalHeader">
      <h2 style="margin:0 0 6px 0;font-size:20px;">${tableEscape(modeLabel)}</h2>
      <div class="small">Found in: <b>${tableEscape(fileDb.__fileName || "Unknown file")}</b></div>
      <div class="small">Current inventory RFID tags: <b>${currentAssets.length}</b></div>
      <div class="small">Changed: <b>${changedCount}</b> &nbsp; | &nbsp; Identical: <b>${identicalCount}</b> &nbsp; | &nbsp; New in inventory: <b>${newCount}</b></div>
      <div class="small" id="updateExportSelectedCount">Selected: 0</div>
    </div>

    <div class="updateExportModalBody">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th>Select</th>
            <th>RFID Tag ID</th>
            <th>Alias</th>
            <th>Type</th>
            <th>Current UID</th>
            <th>Status</th>
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="updateExportModalFooter">
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="updateExportSelectChangedBtn">Select Changed + New</button>
        <button id="updateExportSelectAllBtn">Select All</button>
        <button id="updateExportClearBtn">Clear Selection</button>
        <button id="updateExportReviewAllBtn">Review All Changes</button>
      </div>
      <div style="display:flex;gap:10px;">
        <button id="updateExportCancelBtn" class="updateExportCancelButton">Cancel</button>
        <button id="updateExportDoBtn" class="green">Update Selected (0)</button>
      </div>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function updateCount(){
    const n=selectedRows.size;
    let selectedChanged=0, selectedIdentical=0, selectedNew=0;

    selectedRows.forEach(i=>{
      const status=statusFor(currentAssets[i]);
      if(status==="Changed") selectedChanged++;
      else if(status==="Identical") selectedIdentical++;
      else if(status==="New") selectedNew++;
    });

    document.getElementById("updateExportSelectedCount").textContent =
      n > 0
        ? `Selected: ${n} (${selectedChanged} changed, ${selectedIdentical} identical, ${selectedNew} new)`
        : "Selected: 0";

    const btn=document.getElementById("updateExportDoBtn");
    btn.textContent=`Update Selected (${n})`;
    btn.disabled=n===0;
  }

  document.querySelectorAll(".updateExportChangeCell").forEach(td=>{
    td.ondblclick=()=>{
      const currentAsset=currentAssets[Number(td.dataset.index)];
      const fileAsset=fileMap.get(currentAsset?.assetId);

      if(statusFor(currentAsset)==="Identical") return;

      showDeltaDetail(
        "Review Changes Before Updating Export",
        `${currentAsset?.assetId || "Unknown RFID Tag"} — ${currentAsset?.alias || ""}`,
        JSON.stringify(fileAsset || {}, null, 2),
        JSON.stringify(currentAsset || {}, null, 2)
      );
    };
  });

  document.querySelectorAll(".updateExportCheck").forEach(chk=>{
    chk.onchange=()=>{
      const idx=Number(chk.dataset.index);
      if(chk.checked) selectedRows.add(idx);
      else selectedRows.delete(idx);
      updateCount();
    };
  });

  document.getElementById("updateExportSelectChangedBtn").onclick=()=>{
    selectedRows.clear();
    document.querySelectorAll(".updateExportCheck").forEach(chk=>{
      const idx=Number(chk.dataset.index);
      const status=statusFor(currentAssets[idx]);
      chk.checked=status==="Changed" || status==="New";
      if(chk.checked) selectedRows.add(idx);
    });
    updateCount();
  };

  document.getElementById("updateExportSelectAllBtn").onclick=()=>{
    selectedRows.clear();
    document.querySelectorAll(".updateExportCheck").forEach(chk=>{
      chk.checked=true;
      selectedRows.add(Number(chk.dataset.index));
    });
    updateCount();
  };

  document.getElementById("updateExportClearBtn").onclick=()=>{
    selectedRows.clear();
    document.querySelectorAll(".updateExportCheck").forEach(chk=>chk.checked=false);
    updateCount();
  };

  document.getElementById("updateExportReviewAllBtn").onclick=()=>{
    const changedAssets=currentAssets.filter(a=>statusFor(a)==="Changed" || statusFor(a)==="New");
    if(!changedAssets.length){
      appAlert("No changes found", "No changed or new RFID tags were found for this export file.", "warning");
      return;
    }

    const fileCombined={};
    const currentCombined={};

    changedAssets.forEach(a=>{
      const key=`${a.assetId || "Unknown"} — ${a.alias || ""}`;
      fileCombined[key]=fileMap.get(a.assetId) || {};
      currentCombined[key]=a || {};
    });

    showDeltaDetail(
      "Review All Changes Before Updating Export",
      `${changedAssets.length} RFID tag${changedAssets.length===1 ? "" : "s"} changed or new`,
      JSON.stringify(fileCombined, null, 2),
      JSON.stringify(currentCombined, null, 2)
    );
  };

  document.getElementById("updateExportCancelBtn").onclick=closeUpdateExportPreviewModal;
  overlay.onclick=e=>{ if(e.target===overlay) closeUpdateExportPreviewModal(); };

  document.getElementById("updateExportDoBtn").onclick=async()=>{
    const selectedAssets=[...selectedRows].map(i=>currentAssets[i]).filter(Boolean);
    if(!selectedAssets.length) return appAlert("No RFID tags selected", "Select one or more RFID tags before updating the export file.", "warning");

    const updatedDb=JSON.parse(JSON.stringify(fileDb));
    delete updatedDb.__fileName;
    delete updatedDb.__filePath;
    delete updatedDb.__isLastExport;

    updatedDb.assets=Array.isArray(updatedDb.assets) ? updatedDb.assets : [];

    selectedAssets.forEach(asset=>{
      const clean=JSON.parse(JSON.stringify(asset));
      const idx=updatedDb.assets.findIndex(a=>a.assetId===clean.assetId);
      if(idx>=0) updatedDb.assets[idx]=clean;
      else updatedDb.assets.push(clean);
    });

    const ok=await appConfirm("Update existing export file?", `<p>${tableEscape(fileDb.__fileName || "Selected file")}</p><p>A .bak backup will be created before writing.</p>`, {confirmText:"Update", variant:"success"});
    if(!ok) return;

    const result=await window.pm3api.updateExistingExportFile({
      filePath:fileDb.__filePath,
      db:updatedDb
    });

    if(!result?.ok){
      appAlert("Update failed", result?.message || "Unknown error", "error");
      return;
    }

    closeUpdateExportPreviewModal();
    appAlert("Export file updated", `Updated RFID tags: ${selectedAssets.length}<br>Backup created: ${tableEscape(result.backupName || "")}`, "success");
  };

  updateCount();
}

async function updateExistingExport(){
  const fileDb=await window.pm3api.chooseExportFileForUpdate();
  if(!fileDb) return;
  openUpdateExportPreviewModal(fileDb, "Update Existing Export");
}

async function updateLastExport(){
  const result=await window.pm3api.getLastExportFileForUpdate();
  if(!result?.ok){
    appAlert("No last export file found", result?.message || "No last export file found.", "warning");
    return;
  }
  openUpdateExportPreviewModal(result.db, "Update Last Export");
}


async function importTags(){
  const imported=await window.pm3api.importTags();
  if(!imported) return;
  openImportPreviewModal(imported);
}


function exportCsvString(){const assets=getSelectedAssets();return[fields.map(f=>labels[f]||f).join(",")].concat(assets.map(a=>fields.map(f=>`"${String(a[f]||"").replaceAll('"','""')}"`).join(","))).join("\n");}
function setCommandStatus(t){document.getElementById("commandStatus").textContent=t;}
function setButtonsRunning(r){commandRunning=r;document.querySelectorAll("#tab-live button[data-cmd],#readRegisterBtn,#sendCmdBtn,#tab-live .customPm3ActionBtn").forEach(b=>{if(b.classList?.contains("customPm3ActionBtn") && !b.dataset.configured)return;b.disabled=r;});}
function persistPm3Terminal(){
  // Keep PM3 terminal history only for the current app session.
}
function syncPm3TerminalElement(forceScroll=false){
  const el=document.getElementById("console");
  if(!el) return;
  if(el.textContent!==consoleBuffer) el.textContent=consoleBuffer;
  if(forceScroll || autoFollowConsole) requestAnimationFrame(()=>{ el.scrollTop=el.scrollHeight; });
}
function appendPm3Terminal(text, options={}){
  const value=String(text||"");
  if(!value) return;
  consoleBuffer=(consoleBuffer+value).slice(-PM3_TERMINAL_MAX_CHARS);
  persistPm3Terminal();
  syncPm3TerminalElement(!!options.forceScroll);
}
function appendDeviceCommandModalOutput(text){
  const el=deviceCommandLibraryTerminalEl || document.getElementById("deviceCommandLibraryTerminal");
  if(el && !document.body.contains(el)) deviceCommandLibraryTerminalEl=null;
  const liveEl=deviceCommandLibraryTerminalEl || document.getElementById("deviceCommandLibraryTerminal");
  if(!liveEl) return;
  liveEl.textContent += String(text || "");
  liveEl.scrollTop=liveEl.scrollHeight;
}
function attachTerminalResizeHandle(handle, target, options={}){
  if(!handle || !target || handle.dataset.resizeReady==="true") return;
  handle.dataset.resizeReady="true";
  const min=Number(options.min || 140);
  const max=Number(options.max || 900);
  let dragging=false;
  const startDrag=event=>{
    if(dragging) return;
    dragging=true;
    event.preventDefault();
    const point=event.touches?.[0] || event;
    const startY=point.clientY;
    const startHeight=target.getBoundingClientRect().height;
    handle.classList.add("dragging");
    const move=moveEvent=>{
      const movePoint=moveEvent.touches?.[0] || moveEvent;
      const direction=options.invert ? -1 : 1;
      const next=Math.max(min, Math.min(max, startHeight + ((movePoint.clientY - startY) * direction)));
      target.style.height=`${next}px`;
      target.style.flexBasis=`${next}px`;
    };
    const up=()=>{
      dragging=false;
      handle.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, {once:true});
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up, {once:true});
    window.addEventListener("touchmove", move, {passive:false});
    window.addEventListener("touchend", up, {once:true});
  };
  handle.addEventListener("pointerdown", startDrag);
  handle.addEventListener("mousedown", startDrag);
  handle.addEventListener("touchstart", startDrag, {passive:false});
}
function restorePm3Terminal(){
  try{ localStorage.removeItem(PM3_TERMINAL_LEGACY_STORAGE_KEY); }catch{}
  consoleBuffer="";
  syncPm3TerminalElement(true);
}
function clearPm3Terminal(){
  consoleBuffer="";
  try{ localStorage.removeItem(PM3_TERMINAL_LEGACY_STORAGE_KEY); }catch{}
  syncPm3TerminalElement(true);
}
async function copyPm3Terminal(){
  const output=consoleBuffer || document.getElementById("console")?.textContent || "";
  if(!output){
    setCommandStatus("Status: Console is empty");
    return;
  }
  try{
    await navigator.clipboard.writeText(output);
    setCommandStatus("Status: Console copied to clipboard");
  }catch(error){
    setCommandStatus("Status: Could not copy console output");
  }
}
document.getElementById("copyConsoleBtn")?.addEventListener("click", copyPm3Terminal);
function updateLiveTopScrollHint(){
  const top=document.querySelector("#tab-live .liveTop");
  const hint=document.getElementById("liveTopScrollHint");
  if(!top || !hint) return;
  const hasMore=top.scrollHeight > top.clientHeight + 4;
  const atBottom=top.scrollTop + top.clientHeight >= top.scrollHeight - 4;
  hint.hidden=!hasMore || atBottom;
}
function setupLiveTopScrollHint(){
  const top=document.querySelector("#tab-live .liveTop");
  if(!top) return;
  top.addEventListener("scroll",updateLiveTopScrollHint,{passive:true});
  new ResizeObserver(updateLiveTopScrollHint).observe(top);
  requestAnimationFrame(updateLiveTopScrollHint);
}
setupLiveTopScrollHint();
function scrollConsole(force=false){
  const el=document.getElementById("console");
  if(force || autoFollowConsole){
    requestAnimationFrame(()=>{ el.scrollTop = el.scrollHeight; });
  }
}
function scheduleIdleComplete(){
  if(outputIdleTimer) clearTimeout(outputIdleTimer);

  let delay = 6000;
  if (/hf search/i.test(currentCommand)) delay = 6000;
  if (/lf search/i.test(currentCommand)) delay = 16000;

  outputIdleTimer=setTimeout(()=>{
    if(!commandRunning) return;
    finishCommand();
  }, delay);
}
function appendConsole(text){
  appendPm3Terminal(text);

  const recent=consoleBuffer.slice(Math.max(0,lastScanStart));
  const p=parsePm3(recent);
  if(p.currentUid){
    lastParsedScan=p;
    if(commandRunning){
      setStatus("🟡 Tag found: "+p.currentUid+" — scan still running");
      setCommandStatus("Status: Tag found, waiting for device output to stop...");
    }
    renderUidMatchPanel(p);
  }

  if(commandRunning && !deviceConsoleManagedBatch && commandPromptSeen(recent)){
    finishCommand();
  } else if(commandRunning && !deviceConsoleManagedBatch) {
    scheduleIdleComplete();
  }
}
function finishCommand(){
  if(!commandRunning) return;
  commandRunning=false;
  if(outputIdleTimer) clearTimeout(outputIdleTimer);
  const secs=runStart?((Date.now()-runStart)/1000).toFixed(1):"?";
  const recent=consoleBuffer.slice(Math.max(0,lastScanStart));
  const p=parsePm3(recent);
  setButtonsRunning(false);
  finishDeviceConsoleWorkflowStep(currentCommand,{ok:true});
  if(p.currentUid){
    setStatus("🟢 Scan complete: "+p.currentUid);
    setCommandStatus(`Status: Complete (${secs}s)`);
    renderUidMatchPanel(p);
    completeDeviceConsoleWorkflow("completed",`Scan complete — UID ${p.currentUid}`);
  } else if(/search/i.test(currentCommand)) {
    setStatus("🟢 Scan complete — no supported UID parsed");
    setCommandStatus(`Status: Complete (${secs}s)`);
    const box=document.getElementById("scanSummary");
    box.className="matchPanel";
    box.innerHTML="Scan complete. No supported UID was parsed from this output.";
    completeDeviceConsoleWorkflow("warning","Scan complete — no supported UID was parsed.");
  } else {
    completeDeviceConsoleWorkflow("completed",`Device command complete — ${currentCommand}`);
    void restorePm3ReadyStatusAfterCommand(secs);
  }
  lastCommandCompleteAt=Date.now();
  scrollConsole(true);
}
function setStatus(t){document.getElementById("pm3Status").textContent=t;}
function restoreActivePm3ReadyStatus(){
  if(activePm3Offline){
    setStatus("🟡 Active offline PM3 developer session");
    return true;
  }
  if(!activePm3Port) return false;
  setStatus("🟢 Active PM3 session: "+activePm3Port);
  return true;
}
async function restorePm3ReadyStatusAfterCommand(secs){
  if(restoreActivePm3ReadyStatus()){
    setCommandStatus(activePm3Offline
      ? `Status: Offline client ready — last command complete (${secs}s)`
      : `Status: Ready — last command complete (${secs}s)`);
    return;
  }
  setStatus("🟠 Checking PM3 USB status...");
  setCommandStatus(`Status: Command complete (${secs}s) — checking USB status...`);
  try{
    await checkPm3({silent:true});
  }catch{
    setStatus("🟢 Command complete");
    setCommandStatus(`Status: Complete (${secs}s)`);
  }
}
function pm3OutputShowsTransportLoss(text){
  return /communicating with proxmark3 device failed|serial (?:port |device )?(?:disconnected|not found|unavailable)|cannot open (?:serial )?port/i.test(String(text||""));
}
async function handlePm3TransportLoss(text){
  if(pm3TransportLossHandled || !pm3OutputShowsTransportLoss(text)) return;
  pm3TransportLossHandled=true;
  activePm3Port=null;
  activePm3Offline=false;
  updateDeviceConnectionStatus({detected:false,connected:false,diagnostics:"not-measured",checking:false,port:"",sessionOwner:"none"});
  updateHeaderPm3Leds({usbPresent:false,leds:{a:false,b:false,c:false,d:false}});
  if(outputIdleTimer) clearTimeout(outputIdleTimer);
  setButtonsRunning(false);
  setStatus("🔴 PM3 communication lost — check the USB connection");
  setCommandStatus("Status: Session ended — reconnect after checking USB");
  finishDeviceConsoleWorkflowStep(currentCommand,{ok:false,status:"failed"});
  completeDeviceConsoleWorkflow("failed","PM3 communication was lost.");
  try{ await window.pm3api.stopPm3(); }catch{}
  window.setTimeout(async()=>{
    await checkPm3({silent:true});
    pm3TransportLossHandled=false;
  },350);
}
function commandDefinition(command){
  return window.DeviceRegistry?.commandByText?.(command) || null;
}

function isDeviceStudioSafeModeBlockedCommand(item={}){
  const safeMode=window.deviceStudioSafeMode;
  if(!safeMode?.available || !safeMode.enabled) return false;
  return deviceStudioSafeModeBlockKind(item)!=="";
}

function deviceStudioSafeModeBlockKind(item={}){
  const safeMode=window.deviceStudioSafeMode;
  if(!safeMode?.available || !safeMode.enabled) return "";
  const capability=String(item.capability || "").trim().toLowerCase();
  const safety=String(item.safetyLevel || "").trim().toLowerCase();
  const command=String(item.command || "").trim().toLowerCase();
  // These command families are rejected by the Device Studio firmware guard.
  if(["write","emulation","standalone"].includes(capability) || safety==="blocked" || /^(hf\s+mf\s+(?:wrbl|simulate)|lf\s+em\s+4x05\s+clone|lf\s+t55xx\s+(?:write|dangerraw)|hf\s+14a\s+sim|hf\s+legic\s+sim|standalone\b)/i.test(command)) return "firmware";
  // Imported commands are held back only when the source-backed Iceman
  // catalogue identifies them as state-changing or advanced.  Missing
  // documentation alone never becomes a claim that a command is unsafe.
  if(["restricted","advanced"].includes(safety)) return "electron";
  return "";
}

function commandNeedsExplanation(item={}){
  const description=String(item.description || "").trim();
  return !description || /^(Imported command\. Add a description|No verified explanation is recorded)/i.test(description);
}

function commandDisplayDescription(item={}){
  return commandNeedsExplanation(item) ? customPm3CommandDescription(item.command) : String(item.description || "").trim();
}

function showDeviceCommandHelp(command){
  const item=commandDefinition(command) || {command};
  const explanationMissing=commandNeedsExplanation(item);
  const description=commandDisplayDescription(item);
  const expected=Array.isArray(item.expectedOutput) && item.expectedOutput.length
    ? `<div class="deviceCommandHelpSection"><b>Expected output</b><p>${tableEscape(item.expectedOutput.join(", "))}</p></div>` : "";
  const notes=String(item.notes || "").trim()
    ? `<div class="deviceCommandHelpSection"><b>Notes / risks</b><p>${tableEscape(item.notes)}</p></div>` : "";
  const documentation=item.documentationSource ? `<div class="deviceCommandHelpSection"><b>Documentation source</b><p>${tableEscape(item.documentationSource)}${item.documentationMatchedCommand ? ` · matched command: <code>${tableEscape(item.documentationMatchedCommand)}</code>` : ""}</p>${item.documentationUrl ? `<p><a href="${tableEscape(item.documentationUrl)}" target="_blank" rel="noreferrer">Open official command reference</a></p>` : ""}</div>` : "";
  const safety=String(item.safetyLevel || "unknown safety");
  const body=`<div class="deviceCommandHelpDetail">
    <div class="deviceCommandHelpSection"><b>Command</b><code>${tableEscape(item.command || command)}</code></div>
    <div class="deviceCommandHelpSection"><b>What it does</b><p>${tableEscape(description)}</p></div>
    <div class="deviceCommandHelpSection"><b>Category and safety</b><p>${tableEscape(item.category || "Other")} · ${tableEscape(safety)} · ${tableEscape(item.capability || "capability not documented")}</p></div>
    ${expected}${notes}${documentation}
    <p class="small">This command definition is ${window.DeviceRegistry?.isCustomCommand?.(item.command) ? "local/custom" : "bundled"}${explanationMissing && !item.documentationSource ? "; Electron supplied this basic explanation from the command syntax." : ""} Review it before use.</p>
  </div>`;
  window.UIEngine?.modal({id:"deviceCommandHelpModal",title:item.title || item.command || "Command explanation",subtitle:"Device Command Library",body,size:"md",buttons:[{text:"Close",variant:"secondary"}]});
}

function renderDeviceProfileSummary(){
  const box=document.getElementById("deviceProfileSummary");
  if(!box || !window.DeviceRegistry) return;
  const profile=window.DeviceRegistry.activeProfile();
  if(!profile){ box.textContent="No device profile loaded."; return; }
  const safeMode=window.deviceStudioSafeMode;
  const guardedCapabilities=new Set(["write","emulation","standalone"]);
  const caps=Object.entries(profile.capabilities || {}).filter(([,v])=>v?.supported).map(([key,value])=>{
    if(safeMode?.available===true && guardedCapabilities.has(key)){
      return safeMode.enabled
        ? {text:`${key}: blocked`,tone:"blocked"}
        : {text:`${key}: ${value.level || "yes"}`,tone:""};
    }
    return {text:`${key}: ${value.level || "yes"}`,tone:""};
  });
  const status=profile.supportStatus==="supported" ? "Supported" : "Prepared profile";
  const safetyNotice=safeMode?.available===true
    ? safeMode.enabled
      ? `<span class="deviceProfileSafetyNotice protected"><b>Safe Mode on</b><span>High-risk commands blocked</span></span>`
      : `<span class="deviceProfileSafetyNotice off"><b>Safe Mode off</b><span>Advanced commands available</span></span>`
    : "";
  box.innerHTML=`<div class="deviceProfileSummaryHead"><b>${tableEscape(status)}</b><span>${tableEscape(profile.connectionType || "connection unknown")} · ${tableEscape((profile.supportedFrequencies || []).join(" / ") || "frequency unknown")}</span>${safetyNotice}</div>
    <details class="deviceProfileCapabilities"><summary>Capabilities (${caps.length})</summary><div class="deviceProfilePills">${caps.map(cap=>`<span class="${cap.tone}">${tableEscape(cap.text)}</span>`).join("")}</div></details>`;
}
window.addEventListener("device-studio-safe-mode-changed",()=>{
  renderDeviceProfileSummary();
  if(document.getElementById("deviceCommandLibraryModalList")) renderDeviceCommandLibrary();
});
function renderDeviceCommandCategories(){
  const select=document.getElementById("deviceCommandLibraryModalCategory") || document.getElementById("deviceCommandCategory");
  if(!select || !window.DeviceRegistry) return;
  const current=select.value || "all";
  const cats=window.DeviceRegistry.categories();
  select.innerHTML=`<option value="all">All categories</option>`+cats.map(c=>`<option value="${tableEscape(c)}">${tableEscape(c)}</option>`).join("");
  select.value=[...cats,"all"].includes(current) ? current : "all";
}
function renderDeviceCommandLibrary(){
  if(!window.DeviceRegistry) return;
  const list=document.getElementById("deviceCommandLibraryModalList") || document.getElementById("deviceCommandLibraryList");
  const count=document.getElementById("deviceCommandLibraryCount");
  const category=document.getElementById("deviceCommandLibraryModalCategory")?.value || document.getElementById("deviceCommandCategory")?.value || "all";
  const query=(document.getElementById("deviceCommandLibraryModalSearch")?.value || document.getElementById("deviceCommandSearch")?.value || "").trim().toLowerCase();
  const profile=window.DeviceRegistry.activeProfile();
  const allCommands=window.DeviceRegistry.commands();
  let commands=allCommands;
  if(category!=="all") commands=commands.filter(item=>(item.category || "Other")===category);
  if(query) commands=commands.filter(item=>[item.command,item.title,item.description,(item.tags||[]).join(" ")].join(" ").toLowerCase().includes(query));
  const blockedAcrossLibrary=allCommands.reduce((result,item)=>{
    const kind=deviceStudioSafeModeBlockKind(item);
    if(kind) result[kind]=(result[kind]||0)+1;
    return result;
  },{});
  const safeMode=window.deviceStudioSafeMode;
  if(count) count.textContent=`${commands.length} command${commands.length===1?"":"s"} · ${profile?.displayName || "Device"}`;
  const safetyStatus=document.getElementById("deviceCommandLibrarySafetyStatus");
  if(safetyStatus){
    if(safeMode?.available && safeMode.enabled){
      const firmwareCount=blockedAcrossLibrary.firmware||0;
      const electronCount=blockedAcrossLibrary.electron||0;
      safetyStatus.className="deviceCommandLibrarySafetyStatus protected";
      safetyStatus.innerHTML=`<b>Safe Mode is on.</b><span>${firmwareCount+electronCount} known high-risk command${firmwareCount+electronCount===1?"":"s"} are unavailable.</span>`;
    }else if(safeMode?.available){
      safetyStatus.className="deviceCommandLibrarySafetyStatus advanced";
      safetyStatus.innerHTML="<b>Safe Mode is off.</b><span>Known high-risk commands are available. Review each command before running it.</span>";
    }else{
      safetyStatus.className="deviceCommandLibrarySafetyStatus unavailable";
      safetyStatus.innerHTML="<b>Safe Mode is unavailable.</b><span>This firmware does not report the Device Studio Safe Mode contract.</span>";
    }
  }
  if(!list) return;
  list.innerHTML=commands.length ? commands.map(item=>{
    const blockKind=deviceStudioSafeModeBlockKind(item);
    const safeModeBlocked=blockKind!=="";
    const description=commandDisplayDescription(item);
    const runnable=(profile?.supportStatus==="supported" || /^proxmark3/.test(profile?.id || "")) && !safeModeBlocked;
    const expected=Array.isArray(item.expectedOutput) && item.expectedOutput.length ? item.expectedOutput.join(", ") : "";
    const blockMessage=blockKind==="firmware" ? "Blocked by Safe Mode (firmware)" : blockKind==="electron" ? "Blocked by Safe Mode (Electron Library)" : "";
    const runLabel=safeModeBlocked ? "Blocked" : "Run";
    const runTitle=safeModeBlocked ? (blockKind==="firmware" ? "The connected firmware blocks this command while Device Studio Safe Mode is on." : "Electron blocks this state-changing command in the Command Library while Safe Mode is on.") : "Run this command";
    return `<div class="deviceCommandItem ${safeModeBlocked ? "isSafeModeBlocked" : ""}">
      <div>
        <h4>${tableEscape(item.title || item.command)} <button type="button" class="sectionHelpIcon deviceCommandHelpIcon" data-device-command-help="${tableEscape(item.command)}" title="What does this command do?" aria-label="Explain ${tableEscape(item.title || item.command)}">i</button></h4>
        <code>${tableEscape(item.command)}</code>
        <p>${tableEscape(description)}</p>
        ${expected ? `<p class="deviceCommandExpected"><b>Expected:</b> ${tableEscape(expected)}</p>` : ""}
        <div class="deviceCommandMeta">
          <span>${tableEscape(item.category || "Other")}</span>
          <span>${tableEscape(item.safetyLevel || "unknown safety")}</span>
          <span>${tableEscape(item.capability || "no capability")}</span>
          ${safeModeBlocked ? `<span class="deviceCommandSafeModeBadge">${blockMessage}</span>` : ""}
        </div>
      </div>
      <div class="deviceCommandActions">
        <button type="button" data-device-command-run="${tableEscape(item.command)}" ${runnable ? "" : `disabled title="${tableEscape(runTitle)}"`}>${runLabel}</button>
        <button type="button" data-device-command-copy="${tableEscape(item.command)}">Copy</button>
        <button type="button" data-device-command-edit="${tableEscape(item.command)}">Edit</button>
        <button type="button" data-device-command-delete="${tableEscape(item.command)}">Delete</button>
        <button type="button" data-device-command-custom="${tableEscape(item.command)}">Custom Button</button>
      </div>
    </div>`;
  }).join("") : `<div class="matchPanel">No commands found for this filter.</div>`;
  list.querySelectorAll("[data-device-command-run]").forEach(btn=>btn.onclick=()=>runDeviceLibraryCommandToTerminal(btn.dataset.deviceCommandRun, /search|info|read|detect/i.test(btn.dataset.deviceCommandRun || "")));
  list.querySelectorAll("[data-device-command-copy]").forEach(btn=>btn.onclick=async()=>{await navigator.clipboard.writeText(btn.dataset.deviceCommandCopy || ""); setCommandStatus("Status: Command copied");});
  list.querySelectorAll("[data-device-command-edit]").forEach(btn=>btn.onclick=()=>openDeviceCommandEditor(btn.dataset.deviceCommandEdit));
  list.querySelectorAll("[data-device-command-delete]").forEach(btn=>btn.onclick=()=>deleteDeviceCommand(btn.dataset.deviceCommandDelete));
  list.querySelectorAll("[data-device-command-help]").forEach(btn=>btn.onclick=()=>showDeviceCommandHelp(btn.dataset.deviceCommandHelp));
  // Adding a command to a Custom Button is an explicit row action.  Calling
  // this while rendering the library opened the Custom Button editor as soon
  // as the library itself was shown.
  list.querySelectorAll("[data-device-command-custom]").forEach(btn=>{
    btn.onclick=()=>addCommandLibraryItemToCustomButton(btn.dataset.deviceCommandCustom);
  });
}
function addCommandLibraryItemToCustomButton(command){
  const def=commandDefinition(command) || {};
  const actions=Array.isArray(window.ElectronCustomPm3Actions) ? window.ElectronCustomPm3Actions : PM3_CUSTOM_ACTIONS;
  const idx=actions.findIndex(item=>!String(item.command || "").trim());
  const targetIndex=idx>=0 ? idx : 0;
  const action=actions[targetIndex];
  window.UIEngine?.closeModal?.("deviceCommandLibraryModal");
  setTimeout(()=>openCustomPm3ActionEditor(action.id, {
    suggestedCommand:command,
    suggestedLabel:def.title || "",
    suggestedDescription:def.description || customPm3CommandDescription(command),
    suggestedScan:/search|info|read|detect/i.test(command)
  }), 140);
  setCommandStatus(`Status: Review ${command} before saving it to a Custom command button`);
}
async function runDeviceLibraryCommand(command, scan=true){
  command=(command||"").trim();
  if(!command) return;
  const state=await window.pm3api.pm3State?.();
  if(state?.running){
    await sendPm3(command, scan);
    return;
  }
  await pm3OneShotRun(command, scan);
}
async function runDeviceLibraryCommandToTerminal(command, scan=true){
  command=(command||"").trim();
  if(!command) return;
  const terminal=document.getElementById("deviceCommandLibraryTerminal");
  deviceCommandLibraryTerminalEl=terminal || null;
  if(terminal) terminal.textContent += `\n[${nowTime()}] > ${command}\n`;
  const state=await window.pm3api.pm3State?.();
  if(state?.running){
    const startLength=consoleBuffer.length;
    await sendPm3(command, scan);
    appendDeviceCommandModalOutput("[Electron] Command sent to active Device Console session.\n");
    const text=await waitForDeviceConsoleOutput(startLength, {command, requireDeviceText:true});
    const meaningful=meaningfulDeviceConsoleOutput(text, command);
    if(meaningful) appendDeviceCommandModalOutput(meaningful+"\n");
    return;
  }
  const ready=window.DeviceGuard?.ensure ? await window.DeviceGuard.ensure({workflow:"Device Command Library", command}) : {ok:true};
  if(!ready?.ok){
    appendDeviceCommandModalOutput(`[Electron] Device check failed: ${ready?.message || ready?.status || "not available"}\n`);
    return;
  }
  beginDeviceConsoleWorkflow({
    id:"device-command-library",
    title:"Device Command Library",
    status:`Preparing ${command}...`
  });
  startDeviceConsoleWorkflowStep(`Running library command: ${command}`,command);
  let result;
  try{
    result=await window.pm3api.runPm3LiveCommand(command);
  }catch(err){
    result={ok:false,message:String(err),stdout:"",stderr:""};
  }
  const text=(result?.stdout || "")+(result?.stderr || "");
  if(!text) appendDeviceCommandModalOutput(`[Electron] ${result?.message || "No output returned."}\n`);
  mirrorInlinePm3Command(command, text || result?.message || "No output returned.", {ok:!!result?.ok, source:"Device Command Library"});
  finishDeviceConsoleWorkflowStep(command,result);
  completeDeviceConsoleWorkflow(result?.ok?"completed":"failed",result?.ok
    ? `Library command complete — ${command}`
    : `Library command failed — ${result?.message || command}`);
}
function openDeviceCommandLibraryModal(){
  window.UIEngine?.closeModal?.("customPm3ActionEditor");
  window.UIEngine?.closeModal?.("customPm3ActionDetailModal");
  const profile=window.DeviceRegistry?.activeProfile?.();
  const body=`<div class="deviceCommandLibraryModal">
    <div class="deviceLibraryToolbar">
      <label>Category<select id="deviceCommandLibraryModalCategory"></select></label>
      <input id="deviceCommandLibraryModalSearch" placeholder="Search commands...">
      <button id="addDeviceCommandBtn" type="button">Add Command</button>
      <details class="deviceLibraryMoreTools"><summary>Library tools</summary><div><button id="reloadDeviceCommandsModalBtn" type="button">Reload JSON</button><button id="importDeviceCommandsModalBtn" type="button">Import JSON</button><button id="exportDeviceCommandsModalBtn" type="button">Export JSON</button></div></details>
    </div>
    <div id="deviceCommandLibrarySafetyStatus" class="deviceCommandLibrarySafetyStatus" aria-live="polite"></div>
    <div id="deviceCommandLibraryModalList" class="deviceCommandLibraryList"></div>
    <div class="deviceCommandLibraryTerminalWrap">
      <div class="electronInlineCommandHeader">
        <b>Command output</b>
        <span>Shared with Device Console</span>
      </div>
      <pre id="deviceCommandLibraryTerminal" class="normalPre deviceCommandLibraryTerminal">Run a command to show output here.</pre>
      <div class="terminalResizeHandle" id="deviceCommandLibraryResizeHandle">Drag to resize output</div>
      <div class="toolbar compactToolbar">
        <button id="clearDeviceCommandTerminalBtn" type="button">Clear Output</button>
        <button id="copyDeviceCommandTerminalBtn" type="button">Copy Output</button>
      </div>
    </div>
  </div>`;
  window.UIEngine?.modal({
    id:"deviceCommandLibraryModal",
    title:"Device Command Library",
    subtitle:profile?.displayName || "Device commands",
    body,
    size:"xl",
    cardClass:"deviceCommandLibraryDarkCard",
    bodyClass:"deviceCommandLibraryDarkBody",
    closeOnOverlay:false,
    buttons:[{text:"Close", variant:"secondary"}],
    onOpen:()=>{
      deviceCommandLibraryTerminalEl=document.getElementById("deviceCommandLibraryTerminal");
      renderDeviceCommandCategories();
      renderDeviceCommandLibrary();
      document.getElementById("deviceCommandLibraryModalCategory").onchange=renderDeviceCommandLibrary;
      document.getElementById("deviceCommandLibraryModalSearch").oninput=renderDeviceCommandLibrary;
      document.getElementById("addDeviceCommandBtn").onclick=()=>openDeviceCommandEditor();
      document.getElementById("reloadDeviceCommandsModalBtn").onclick=reloadDeviceCommandLibrary;
      document.getElementById("importDeviceCommandsModalBtn").onclick=importDeviceCommandLibrary;
      document.getElementById("exportDeviceCommandsModalBtn").onclick=exportDeviceCommandLibrary;
      document.getElementById("clearDeviceCommandTerminalBtn").onclick=()=>{if(deviceCommandLibraryTerminalEl) deviceCommandLibraryTerminalEl.textContent="";};
      document.getElementById("copyDeviceCommandTerminalBtn").onclick=async()=>{await navigator.clipboard.writeText(deviceCommandLibraryTerminalEl?.textContent || ""); setCommandStatus("Status: Command output copied");};
      attachTerminalResizeHandle(document.getElementById("deviceCommandLibraryResizeHandle"), document.getElementById("deviceCommandLibraryTerminal"), {min:120,max:620});
    }
  });
}
function openDeviceCommandEditor(commandText=""){
  const existing=commandText ? window.DeviceRegistry?.commandByText?.(commandText) : null;
  const modalId="deviceCommandEditorModal";
  const body=`<div class="customPm3ActionEditor">
    <label>Command<input id="deviceCommandEditCommand" value="${tableEscape(existing?.command || commandText || "")}" placeholder="Example: hf 14a info"></label>
    <label>Title<input id="deviceCommandEditTitle" value="${tableEscape(existing?.title || "")}" placeholder="Short readable name"></label>
    <div class="commandSetGrid">
      <label>Category<input id="deviceCommandEditCategory" value="${tableEscape(existing?.category || "")}" placeholder="HF, LF, MIFARE, Utility"></label>
      <label>Capability<input id="deviceCommandEditCapability" value="${tableEscape(existing?.capability || "")}" placeholder="hf, lf, deviceInfo"></label>
    </div>
    <label>Safety level<input id="deviceCommandEditSafety" value="${tableEscape(existing?.safetyLevel || "")}" placeholder="read-only, authorized-read, restricted"></label>
    <label>Description<textarea id="deviceCommandEditDescription" placeholder="What does this command do?">${tableEscape(existing?.description || "")}</textarea></label>
    <label>Expected output<textarea id="deviceCommandEditExpected" placeholder="One expected output item per line">${tableEscape((existing?.expectedOutput || []).join("\n"))}</textarea></label>
    <label>Notes<textarea id="deviceCommandEditNotes" placeholder="Extra notes or risks">${tableEscape(existing?.notes || "")}</textarea></label>
    <label>Tags<input id="deviceCommandEditTags" value="${tableEscape((existing?.tags || []).join(", "))}" placeholder="comma separated"></label>
    <p class="small">Saving creates or updates your local custom command library for the active device. Bundled JSON commands are not destroyed.</p>
  </div>`;
  const save=()=>{
    const command=(document.getElementById("deviceCommandEditCommand")?.value || "").trim();
    if(!command) return false;
    const entry={
      command,
      title:(document.getElementById("deviceCommandEditTitle")?.value || "").trim() || command,
      category:(document.getElementById("deviceCommandEditCategory")?.value || "").trim() || "Other",
      capability:(document.getElementById("deviceCommandEditCapability")?.value || "").trim(),
      safetyLevel:(document.getElementById("deviceCommandEditSafety")?.value || "").trim() || "unknown",
      description:(document.getElementById("deviceCommandEditDescription")?.value || "").trim() || customPm3CommandDescription(command),
      expectedOutput:parseCommandSetText(document.getElementById("deviceCommandEditExpected")?.value || ""),
      notes:(document.getElementById("deviceCommandEditNotes")?.value || "").trim(),
      tags:(document.getElementById("deviceCommandEditTags")?.value || "").split(",").map(s=>s.trim()).filter(Boolean)
    };
    const saved=window.DeviceRegistry?.upsertCommand?.(entry);
    if(!saved?.ok) return appAlert("Command not saved", saved?.message || "Electron could not save this command.", "warning"), false;
    renderDeviceConnect();
    renderDeviceCommandCategories();
    renderDeviceCommandLibrary();
    setCommandStatus(`Status: Saved command ${command}`);
    return true;
  };
  window.UIEngine?.modal({id:modalId,title:existing ? "Edit Command" : "Add Command",subtitle:window.DeviceRegistry?.activeProfile?.()?.displayName || "Device Command Library",body,size:"md",buttons:[{text:"Cancel",variant:"secondary"},{text:"Save",variant:"success",onClick:save}]});
}
async function deleteDeviceCommand(command){
  command=(command||"").trim();
  if(!command) return;
  const custom=window.DeviceRegistry?.isCustomCommand?.(command);
  if(!custom){
    appAlert("Bundled command", "This command belongs to the bundled JSON library. To remove it permanently, edit the device commands JSON file. If you edit it here first, Electron creates a local custom override that can be removed later.", "warning");
    return;
  }
  const ok=window.UIEngine?.confirm ? await window.UIEngine.confirm({title:"Delete command?",body:`Delete <b>${tableEscape(command)}</b> from your local custom command library?`,confirmText:"Delete",danger:true}) : confirm("Delete command?");
  if(!ok) return;
  const removed=window.DeviceRegistry?.removeCommand?.(command);
  if(!removed?.ok) return appAlert("Command not deleted", removed?.message || "Electron could not delete this command.", "warning");
  renderDeviceConnect();
  renderDeviceCommandCategories();
  renderDeviceCommandLibrary();
  setCommandStatus(`Status: Deleted command ${command}`);
}
async function importDeviceCommandLibrary(){
  const result=await window.pm3api.importDeviceCommandLibrary?.();
  if(!result) return;
  if(!result.ok) return appAlert("Import failed", result.message || "Could not import command library.", "error");
  const saved=window.DeviceRegistry?.importLibrary?.(result.data);
  if(!saved?.ok) return appAlert("Import failed", saved?.message || "No commands found.", "warning");
  if(saved.library.deviceId) window.DeviceRegistry.setActiveDevice(saved.library.deviceId);
  renderDeviceConnect();
  appAlert("Command library imported", `${tableEscape(result.filename)}<br>${saved.library.commands.length} commands loaded.`, "success");
}
async function exportDeviceCommandLibrary(){
  const library=window.DeviceRegistry?.exportLibrary?.();
  if(!library) return;
  const result=await window.pm3api.exportDeviceCommandLibrary?.({deviceId:library.deviceId, library});
  if(result?.ok) appAlert("Command library exported", tableEscape(result.filename), "success");
}
async function reloadDeviceCommandLibrary(){
  await window.DeviceRegistry?.reload?.();
  renderDeviceConnect();
  setCommandStatus("Status: Device command JSON reloaded");
}
function renderDeviceConnect(){
  if(!window.DeviceRegistry?.isReady?.()) return;
  const select=document.getElementById("deviceProfileSelect");
  if(select){
    const profiles=window.DeviceRegistry.profiles();
    select.innerHTML=profiles.map(profile=>`<option value="${tableEscape(profile.id)}">${tableEscape(profile.displayName)}${profile.supportStatus==="supported"?"":" · profile"}</option>`).join("");
    select.value=window.DeviceRegistry.activeDeviceId();
  }
  renderDeviceProfileSummary();
  renderDeviceCommandCategories();
  renderDeviceCommandLibrary();
}
async function initDeviceConnect(){
  if(!window.DeviceRegistry) return;
  await window.DeviceRegistry.init();
  const select=document.getElementById("deviceProfileSelect");
  if(select) select.onchange=()=>{window.DeviceRegistry.setActiveDevice(select.value); renderDeviceConnect();};
  const category=document.getElementById("deviceCommandCategory");
  if(category) category.onchange=renderDeviceCommandLibrary;
  const search=document.getElementById("deviceCommandSearch");
  if(search) search.oninput=renderDeviceCommandLibrary;
  const openLibrary=document.getElementById("openDeviceCommandLibraryBtn");
  if(openLibrary) openLibrary.onclick=openDeviceCommandLibraryModal;
  const reload=document.getElementById("reloadDeviceCommandsBtn");
  if(reload) reload.onclick=reloadDeviceCommandLibrary;
  const importBtn=document.getElementById("importDeviceCommandsBtn");
  if(importBtn) importBtn.onclick=importDeviceCommandLibrary;
  const exportBtn=document.getElementById("exportDeviceCommandsBtn");
  if(exportBtn) exportBtn.onclick=exportDeviceCommandLibrary;
  document.addEventListener("electron-device-changed", renderDeviceConnect);
  renderDeviceConnect();
}
function mirrorInlinePm3Command(command, output, options={}){
  const cmd=(command || "").trim();
  const body=String(output || options.message || "");
  const header=`\n[${nowTime()}] Inline device command${options.source ? ` from ${options.source}` : ""}\n[${nowTime()}] > ${cmd}\n`;
  lastScanStart=consoleBuffer.length;
  appendPm3Terminal(header + body + "\n", {forceScroll:true});
  const parsed=parsePm3(body);
  if(parsed.currentUid){
    lastParsedScan=parsed;
    renderUidMatchPanel(parsed);
    setStatus("🟢 Inline command complete: " + parsed.currentUid);
  }else if(/search|info|read|list/i.test(cmd)){
    const box=document.getElementById("scanSummary");
    if(box){
      box.className="matchPanel";
      box.innerHTML=options.ok === false ? "Inline device command finished with an error. Check console output." : "Inline device command complete. No supported UID was parsed from this output.";
    }
    setStatus(options.ok === false ? "🔴 Inline device command failed" : "🟢 Inline device command complete");
  }
  setCommandStatus(options.ok === false ? "Status: Inline command error" : "Status: Inline command mirrored to Device Console");
}
async function checkPm3({silent=false,background=false}={}){
  const profile=window.DeviceRegistry?.activeProfile?.();
  if(profile && profile.id!=="proxmark3" && !/^proxmark3_/.test(profile.id)){
    setStatus("🟠 Device profile only: "+profile.displayName);
    setCommandStatus("Status: This device profile is not runnable yet");
    if(!silent) appAlert("Device profile not runnable yet", `${tableEscape(profile.displayName)} is available as a profile and command library, but Electron does not yet include a connection adapter for it.`, "warning");
    return;
  }
  updateDeviceConnectionStatus({checking:true});
  if(!background) setStatus("🟠 Checking for a Proxmark3 USB device...");
  if(!silent) setCommandStatus("Status: Checking USB device presence...");
  let session=null;
  try{ session=await window.pm3api.pm3State?.(); }catch{}
  const r=await window.pm3api.listPm3();
  if(!silent) appendConsole("[App] pm3 --list\n"+(r.raw||"")+"\n");
  const presence=r.ok ? "detected" : "missing";
  const changed=lastPm3Presence!==presence;
  lastPm3Presence=presence;
  const sessionConnected=session?.running===true;
  const detectedPort=r.ports?.[0] || lastDetectedPm3Port || "";
  const preserveStudioSession=!sessionConnected && r.ok===true && deviceConnectionPresentationState.connected===true && deviceConnectionPresentationState.sessionOwner==="studio";
  updateDeviceConnectionStatus({
    detected:r.ok===true,
    connected:sessionConnected || preserveStudioSession,
    checking:false,
    port:sessionConnected ? (activePm3Port || detectedPort) : preserveStudioSession ? deviceConnectionPresentationState.port : "",
    diagnostics:r.ok===true ? deviceConnectionPresentationState.diagnostics : "not-measured",
    sessionOwner:sessionConnected ? "console" : preserveStudioSession ? "studio" : "none"
  });
  if(background && !changed) return r;
  if(r.ok){
    lastDetectedPm3Port=r.ports?.[0] || lastDetectedPm3Port;
    updateHeaderPm3Leds({usbPresent:true});
    if(session?.running){
      const port=activePm3Port || lastDetectedPm3Port || "RFID reader";
      setStatus("🟢 Active PM3 session: "+port);
      setCommandStatus("Status: Session already active — Electron can send commands");
      return r;
    }
    setStatus("🟠 PM3 detected via USB — no active session");
    setCommandStatus(silent ? "Status: Ready to connect" : "Status: USB device detected. Click Connect Device to start a session.");
  }else{
    updateHeaderPm3Leds({usbPresent:false,leds:{a:false,b:false,c:false,d:false}});
    setStatus("🔴 No Proxmark3 USB device detected");
    setCommandStatus(silent ? "Status: Idle" : "Status: No USB device found");
  }
  return r;
}
async function refreshPm3UsbPresenceInBackground(){
  const liveTab=document.getElementById("tab-live");
  if(pm3PresenceCheckInFlight || commandRunning || document.hidden || !liveTab || liveTab.classList.contains("hidden")) return;
  let state=null;
  try{ state=await window.pm3api.pm3State?.(); }catch{}
  if(state?.running) return;
  pm3PresenceCheckInFlight=true;
  try{ await checkPm3({silent:true,background:true}); }
  catch{ /* Keep the last known USB status; background checks never interrupt the user. */ }
  finally{ pm3PresenceCheckInFlight=false; }
}
function startPm3PresenceMonitor(){
  if(pm3PresencePollTimer) clearInterval(pm3PresencePollTimer);
  pm3PresencePollTimer=window.setInterval(refreshPm3UsbPresenceInBackground,5000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden) refreshPm3UsbPresenceInBackground();});
  refreshPm3UsbPresenceInBackground();
}
async function startPm3(){const profile=window.DeviceRegistry?.activeProfile?.();if(profile && profile.id!=="proxmark3" && !/^proxmark3_/.test(profile.id)){setStatus("🟠 Device profile only: "+profile.displayName);setCommandStatus("Status: Connection adapter not implemented yet");appAlert("Device profile not runnable yet", `${tableEscape(profile.displayName)} is prepared for future support. Proxmark3 remains the active working adapter for now.`, "warning");return;}updateDeviceConnectionStatus({checking:true});setStatus("🟡 Device: Connecting...");setCommandStatus("Status: Starting device client...");const r=await window.pm3api.startPm3();appendConsole("[App] "+r.message+"\n");if(r.ok){
  pm3TransportLossHandled=false;
  activePm3Offline=r.offline===true;
  activePm3Port=activePm3Offline ? null : (r.port || activePm3Port || lastDetectedPm3Port);
  commandRunning=false;
  scanResultComplete=false;
  lastParsedScan=null;
  if(outputIdleTimer) clearTimeout(outputIdleTimer);
  const box=document.getElementById("scanSummary");
  box.className="matchPanel";
  box.innerHTML="No scan parsed yet.";
  setButtonsRunning(false);
  if(r.offline){
    updateHeaderPm3Leds({usbPresent:false,leds:{a:false,b:false,c:false,d:false}});
    updateDeviceConnectionStatus({detected:false,connected:false,checking:false,port:"",sessionOwner:"none"});
    setStatus("🟡 Active offline PM3 developer session");
    setCommandStatus("Status: Offline client ready — hardware commands are unavailable");
  }else{
    updateHeaderPm3Leds({usbPresent:true});
    startHeaderPm3LedMonitor();
    updateDeviceConnectionStatus({detected:true,connected:true,checking:false,port:activePm3Port||"RFID reader",sessionOwner:"console"});
    setStatus("🟢 Active PM3 session: "+(activePm3Port||"RFID reader"));
    setCommandStatus("Status: Ready — Electron can send commands");
  }
}else if(r.status==="busy"){updateDeviceConnectionStatus({detected:true,connected:false,checking:false,port:"",sessionOwner:"none"});setStatus("⚠️ Device port busy: "+r.message);setCommandStatus("Status: Blocked by another app");appendConsole("[App] Close the app shown above, then try Connect again.\n");window.DeviceGuard?.ensure?.({workflow:"Connect Device"});}else{updateDeviceConnectionStatus({connected:false,checking:false,port:"",sessionOwner:"none"});setStatus("🔴 "+r.message);setCommandStatus("Status: Error");window.DeviceGuard?.ensure?.({workflow:"Connect Device"});}}
async function sendPm3(command,scan=false){
  command=(command||"").trim();if(!command)return;
  const state=await window.pm3api.pm3State?.();
  if(!state?.running){
    const ready=window.DeviceGuard?.ensure ? await window.DeviceGuard.ensure({workflow:scan ? "Device scan" : "Device command", command}) : {ok:true};
    if(!ready?.ok){
      setStatus("🔴 Device unavailable");
      setCommandStatus("Status: Device check failed");
      return;
    }
  }
  beginDeviceConsoleWorkflow({
    id:scan?"device-console-scan":"device-console-command",
    title:scan?"Device scan":"Device Console command",
    status:`Preparing ${command}...`
  });
  startDeviceConsoleWorkflowStep(scan?`Running scan command: ${command}`:`Running device command: ${command}`,command);
  lastScanStart=consoleBuffer.length;runStart=Date.now();currentCommand=command;commandRunning=true;setButtonsRunning(true);
  if(scan){setStatus("🟡 Running "+command+"...");document.getElementById("scanSummary").className="matchPanel";document.getElementById("scanSummary").innerHTML="🟡 Scan running...";}else{setStatus("🟡 Running command...");}
  setCommandStatus("Status: Running "+command+"...");
  appendConsole(`\n[${nowTime()}] > ${command}\n`);
  let r;
  try{
    r=await window.pm3api.sendPm3(command);
  }catch(error){
    r={ok:false,message:String(error?.message || error)};
  }
  if(!r.ok){
  commandRunning=false;
  scanResultComplete=false;
  if(outputIdleTimer) clearTimeout(outputIdleTimer);
  if(commandTimeoutTimer) clearTimeout(commandTimeoutTimer);
  appendConsole("[App] "+r.message+"\n");
  setButtonsRunning(false);
  setStatus("🔴 Cannot run command — no active PM3 session");
  setCommandStatus("Status: Idle");
  finishDeviceConsoleWorkflowStep(command,{ok:false,status:"failed"});
  completeDeviceConsoleWorkflow("failed",`Device command failed — ${r.message || "no active PM3 session"}`);
  const box=document.getElementById("scanSummary");
  box.className="matchPanel";
  box.innerHTML="No scan parsed yet.";
}else{
  setCommandStatus("Status: Command sent, waiting for device output...");
  setDeviceConsoleWorkflowStatus("Command sent; waiting for PM3 output...",command);
  scheduleIdleComplete();
}
}
async function readAndRegister(){
  await sendPm3("hf search",true);
  setTimeout(()=>{
    if(!commandRunning) return;
    const recent=consoleBuffer.slice(Math.max(0,lastScanStart));
    const p=parsePm3(recent);
    if(!p.currentUid){
      setStatus("🟡 No HF UID yet — will try LF after HF finishes");
    }
  },3500);
}
function validatePm3Command(command, context="manual"){
  if(window.Pm3CommandSafety?.validate) return window.Pm3CommandSafety.validate(command, {context});
  const cmd=String(command||"").trim();
  return {allowed:!!cmd, command:cmd, reason:cmd ? "" : "No device command provided."};
}
function showBlockedPm3Command(command, result){
  commandRunning=false;
  if(outputIdleTimer) clearTimeout(outputIdleTimer);
  if(commandTimeoutTimer) clearTimeout(commandTimeoutTimer);
  setButtonsRunning(false);
  setStatus("⚠️ Command blocked");
  setCommandStatus("Status: Command not run");
  const reason=result?.reason || "This command is outside Electron's safe Device Console flow.";
  appendConsole(`\n[${nowTime()}] > ${command}\n[App] Command blocked: ${reason}\n`);
}
function renderCustomPm3ActionButtons(){
  const toolbar=document.getElementById("customPm3ActionToolbar");
  if(!toolbar) return;
  const actions=Array.isArray(window.ElectronCustomPm3Actions) ? window.ElectronCustomPm3Actions : PM3_CUSTOM_ACTIONS;
  toolbar.innerHTML=actions.slice(0,CUSTOM_PM3_ACTION_COUNT).map((action,index)=>{
    const id=String(action.id || `custom-pm3-action-${index+1}`);
    const label=String(action.label || `Custom command button ${index+1}`);
    const description=String(action.description || "Custom command button.");
    const command=String(action.command || "").trim();
    const visibleLabel=command ? label : `Custom command button ${index+1}`;
    const ready=command ? `data-configured="true"` : "";
    return `<button type="button" class="customPm3ActionBtn" data-custom-pm3-action="${id}" title="${tableEscape(description)}" ${ready}>${tableEscape(visibleLabel)}</button>`;
  }).join("");
  toolbar.querySelectorAll("[data-custom-pm3-action]").forEach(button=>{
    button.onclick=()=>{
      const action=(Array.isArray(window.ElectronCustomPm3Actions) ? window.ElectronCustomPm3Actions : PM3_CUSTOM_ACTIONS)
        .find(item=>String(item.id)===String(button.dataset.customPm3Action));
      if(String(action?.command || "").trim()) openCustomPm3ActionDetail(button.dataset.customPm3Action);
      else openCustomPm3ActionEditor(button.dataset.customPm3Action);
    };
  });
}
function customPm3Commands(action){
  return parseCommandSetText(String(action?.command || ""));
}
function customPm3SafetyRows(commands, actionId){
  return commands.map(command=>{
    const safety=validatePm3Command(command, `custom-action:${actionId}`);
    const status=safety.allowed ? (safety.exception ? "Allowed · read-only match" : "Allowed") : "Blocked";
    const detail=safety.allowed ? (safety.exception?.reason || "No blocking rule matched.") : safety.reason;
    return {command,safety,status,detail};
  });
}
function customPm3HasBlocked(rows){
  return rows.some(row=>!row.safety?.allowed);
}
function wait(ms){
  return new Promise(resolve=>setTimeout(resolve, ms));
}
function meaningfulDeviceConsoleOutput(raw, command=""){
  const cmd=String(command || "").trim().toLowerCase();
  return String(raw || "").split(/\r?\n/).filter(line=>{
    const text=line.trim();
    if(!text) return false;
    const lower=text.toLowerCase();
    if(cmd && (lower===cmd || lower.endsWith(`> ${cmd}`))) return false;
    if(lower==="command sent") return false;
    if(lower.includes("command sent to active device console session")) return false;
    return true;
  }).join("\n").trim();
}
async function waitForDeviceConsoleOutput(startLength, options={}){
  const timeoutMs=Number(options.timeoutMs || 18000);
  const idleMs=Number(options.idleMs || 1200);
  const command=options.command || "";
  const requireDeviceText=!!options.requireDeviceText;
  const started=Date.now();
  let lastLength=consoleBuffer.length;
  let lastChange=Date.now();
  while(Date.now()-started<timeoutMs){
    await wait(250);
    if(consoleBuffer.length>lastLength){
      lastLength=consoleBuffer.length;
      lastChange=Date.now();
    }
    const current=consoleBuffer.slice(startLength);
    if(consoleBuffer.length>Number(startLength || 0) && Date.now()-lastChange>=idleMs){
      if(!requireDeviceText || meaningfulDeviceConsoleOutput(current, command)) return current;
    }
  }
  return consoleBuffer.slice(startLength);
}
function openCustomPm3ActionDetail(actionId){
  const actions=Array.isArray(window.ElectronCustomPm3Actions) ? window.ElectronCustomPm3Actions : PM3_CUSTOM_ACTIONS;
  const action=actions.find(item=>String(item.id)===String(actionId));
  if(!action) return;
  const commands=customPm3Commands(action);
  const rows=customPm3SafetyRows(commands, actionId);
  const blocked=customPm3HasBlocked(rows);
  const commandList=commands.length
    ? `<ol class="customPm3CommandList">${rows.map((row,index)=>`<li class="customPm3CommandItem ${row.safety?.allowed ? "allowed" : "blocked"}">
        <span class="customPm3CommandNumber" aria-hidden="true">${index+1}</span>
        <div>
          <code>${tableEscape(row.command)}</code>
          <span class="customPm3CommandSafety"><b>${tableEscape(row.status)}</b>${row.detail ? `<small>${tableEscape(row.detail)}</small>` : ""}</span>
        </div>
      </li>`).join("")}</ol>`
    : `<p class="small">No device commands configured yet. Click Edit to add one or more commands.</p>`;
  const body=`<div class="customPm3ActionDetail">
    <section class="customPm3ActionSummary">
      <span>What this action does</span>
      <p>${tableEscape(action.description || "No description saved yet.")}</p>
    </section>
    <section class="customPm3CommandSection">
      <div class="customPm3SectionHeading">
        <div><span>Device commands</span><b>Review before running</b></div>
        <small>${commands.length} command${commands.length===1?"":"s"}</small>
      </div>
      ${commandList}
    </section>
    <section class="customPm3RiskBox ${blocked ? "blocked" : "available"}">
      <span class="customPm3RiskIcon" aria-hidden="true">${blocked ? "!" : "✓"}</span>
      <div>
        <b>Device Command Safety</b>
        <p>Electron checks every command before it reaches the device. You remain responsible for custom commands you create and run.</p>
        ${blocked ? `<strong>Run blocked — at least one command failed the safety check.</strong>` : `<strong>Ready to run — no blocking safety rule matched.</strong>`}
      </div>
    </section>
    <div class="electronInlineCommandRunner">
      <div class="electronInlineCommandHeader">
        <b>Command output</b>
        <span id="customPm3ActionRunStatus">Not run yet</span>
      </div>
      <pre id="customPm3ActionOutput" class="normalPre electronInlineCommandOutput">Run this action to see the device response here.</pre>
    </div>
  </div>`;
  window.UIEngine?.modal({
    id:"customPm3ActionDetailModal",
    title:action.label || "Custom command",
    subtitle:"Custom command · review before running",
    body,
    size:"md",
    cardClass:"customPm3ActionDetailCard",
    closeOnOverlay:false,
    buttons:[
      {text:"Run commands", variant:"success", close:false, disabled:!commands.length || blocked, onClick:async({button})=>{
        await runCustomPm3ActionSet(actionId, {button});
        return false;
      }},
      {text:"Edit", variant:"primary", close:false, onClick:()=>{
        window.UIEngine?.closeModal?.("customPm3ActionDetailModal");
        setTimeout(()=>openCustomPm3ActionEditor(actionId, {returnToDetail:true}), 140);
        return false;
      }},
      {text:"Close", variant:"secondary"}
    ]
  });
}
async function runCustomPm3ActionSet(actionId, ui={}){
  const actions=Array.isArray(window.ElectronCustomPm3Actions) ? window.ElectronCustomPm3Actions : PM3_CUSTOM_ACTIONS;
  const action=actions.find(item=>String(item.id)===String(actionId));
  const commands=customPm3Commands(action);
  const rows=customPm3SafetyRows(commands, actionId);
  const output=document.getElementById("customPm3ActionOutput");
  const status=document.getElementById("customPm3ActionRunStatus");
  if(!commands.length){
    if(status) status.textContent="No commands configured";
    return;
  }
  if(customPm3HasBlocked(rows)){
    if(status) status.textContent="Blocked";
    if(output) output.textContent=rows.filter(row=>!row.safety.allowed).map(row=>`> ${row.command}\nCommand blocked: ${row.detail}`).join("\n\n");
    return;
  }
  beginDeviceConsoleWorkflow({
    id:"custom-command-action",
    title:action?.label || "Custom Command Button",
    status:"Preparing custom command workflow..."
  });
  if(ui.button) ui.button.disabled=true;
  if(status) status.textContent="Running...";
  let all="";
  let failed=false;
  for(const command of commands){
    const startLength=consoleBuffer.length;
    startDeviceConsoleWorkflowStep(`Running custom command: ${command}`,command);
    if(output) output.textContent=all+`\n> ${command}\nRunning...\n`;
    let result;
    try{
      result=window.DeviceGuard?.runLiveCommand
        ? await window.DeviceGuard.runLiveCommand(command, {workflow:action?.label || "Custom Command Button"})
        : await window.pm3api.runPm3LiveCommand(command);
    }catch(err){
      result={ok:false,message:String(err),stdout:"",stderr:""};
    }
    let text=(result?.stdout||"")+(result?.stderr||"");
    if(result?.sentToActiveSession && !text.trim()){
      if(status) status.textContent="Waiting for Device Console output...";
      setDeviceConsoleWorkflowStatus("Waiting for PM3 output...",command);
      text=await waitForDeviceConsoleOutput(startLength, {command, requireDeviceText:true});
    }
    if(!text.trim() && result?.message) text=result.message;
    all+=`\n> ${command}\n${text || "No output returned."}\n`;
    mirrorInlinePm3Command(command, text || "No output returned.", {ok:!!result?.ok, source:action?.label || "Custom command button"});
    finishDeviceConsoleWorkflowStep(command,result);
    if(!result?.ok){
      failed=true;
      break;
    }
  }
  if(output) output.textContent=all.trim() || "No output returned.";
  if(status) status.textContent=failed ? "Stopped with error" : "Complete";
  completeDeviceConsoleWorkflow(failed?"failed":"completed",failed
    ? `${action?.label || "Custom command"} stopped because a command failed.`
    : `${action?.label || "Custom command"} complete.`);
  if(ui.button) ui.button.disabled=false;
}
function customPm3CommandDescription(command){
  const def=commandDefinition(command);
  if(def?.description && !/^(Imported command\. Add a description|No verified explanation is recorded)/i.test(String(def.description).trim())) return def.description;
  const cmd=String(command||"").trim().toLowerCase();
  const map=[
    [/^hf help$/,"Shows the Proxmark3 help overview for high-frequency RFID/NFC commands."],
    [/^lf help$/,"Shows the Proxmark3 help overview for low-frequency RFID commands."],
    [/^hf search$/,"Searches for nearby high-frequency RFID/NFC cards and prints safe identification details."],
    [/^lf search$/,"Searches for nearby low-frequency RFID tags and prints safe identification details."],
    [/^hf 14a info$/,"Reads public ISO14443-A information such as UID, ATQA, SAK and protocol hints."],
    [/^hf mf info$/,"Reads public MIFARE Classic information and card capability hints without writing data."],
    [/^hf mf rdsc\b/,"Reads a MIFARE Classic sector using the supplied sector number and authorised key. It does not write card data."],
    [/^hf mf wrbl\b/,"Writes a MIFARE Classic block using the supplied data and authentication key. This changes card data and is restricted by Safe Mode."],
    [/^hf fudan rdbl\b/,"Reads a FUDAN card block using the supplied block number and authorised key."],
    [/^hf fudan wrbl\b/,"Writes a FUDAN card block using the supplied data. This changes card data and is restricted by Safe Mode."],
    [/^data bytes\b/,"Shows the current Proxmark3 data buffer as bytes."],
    [/^hw version$/,"Prints Proxmark3 hardware, firmware and client version information."]
  ];
  const found=map.find(([pattern])=>pattern.test(cmd));
  if(found) return found[1];
  if(/\bhelp\b/.test(cmd)) return "Shows Proxmark3 help text for this command group.";
  if(/\binfo\b/.test(cmd)) return "Runs a read-only information command and prints the result in Device Console.";
  if(/\bsearch\b/.test(cmd)) return "Runs a read-only search command and prints detected tag information in Device Console.";
  return "Runs this device command in the Device Console. Review the command before saving.";
}
function openCustomPm3ActionEditor(actionId, options={}){
  const actions=Array.isArray(window.ElectronCustomPm3Actions) ? window.ElectronCustomPm3Actions : PM3_CUSTOM_ACTIONS;
  const action=actions.find(item=>String(item.id)===String(actionId));
  if(!action) return;
  const modalId="customPm3ActionEditor";
  const body=`<div class="customPm3ActionEditor">
    <label>Button name<input id="customPm3ActionLabel" value="${tableEscape(action.command ? action.label : options.suggestedLabel || action.label || "")}" placeholder="Example: HF Help"></label>
    <label>Device commands<textarea id="customPm3ActionCommand" placeholder="One device command per line, for example: hf help">${tableEscape(action.command || options.suggestedCommand || "")}</textarea></label>
    <label>Button explanation<textarea id="customPm3ActionDescription" placeholder="What does this button do?">${tableEscape(action.command ? action.description : options.suggestedDescription || action.description || "")}</textarea></label>
    <label class="inlineCheck"><input type="checkbox" id="customPm3ActionScan" ${(action.scan || options.suggestedScan) ? "checked" : ""}> Treat output as scan/read result</label>
    <p class="small">If explanation is empty, Electron fills it from local command knowledge. Internet lookup is not automatic yet.</p>
    <p class="small" id="customPm3ActionEditorStatus"></p>
  </div>`;
  const saveAction=()=>{
    const label=(document.getElementById("customPm3ActionLabel")?.value || "").trim() || action.label || "Custom command button";
    const command=(document.getElementById("customPm3ActionCommand")?.value || "").trim();
    let description=(document.getElementById("customPm3ActionDescription")?.value || "").trim();
    if(!description) description=customPm3CommandDescription(parseCommandSetText(command)[0] || command);
    const scan=!!document.getElementById("customPm3ActionScan")?.checked;
    const next=actions.map(item=>String(item.id)===String(actionId) ? {...item,label,command,description,scan} : item);
    PM3_CUSTOM_ACTIONS=next;
    window.ElectronCustomPm3Actions=next;
    saveCustomPm3Actions(next);
    renderCustomPm3ActionButtons();
    setCommandStatus(command ? `Status: Saved custom button ${label}` : `Status: ${label} still needs a command`);
    if(options.returnToDetail) setTimeout(()=>openCustomPm3ActionDetail(actionId), 160);
    return true;
  };
  const clearAction=()=>{
    const fallback=PM3_CUSTOM_ACTION_DEFAULTS.find(item=>String(item.id)===String(actionId)) || {id:actionId,label:"Custom command button",description:"Configure this custom command button before use.",command:"",scan:false};
    const next=actions.map(item=>String(item.id)===String(actionId) ? {...fallback} : item);
    PM3_CUSTOM_ACTIONS=next;
    window.ElectronCustomPm3Actions=next;
    saveCustomPm3Actions(next);
    renderCustomPm3ActionButtons();
    setCommandStatus(`Status: Cleared ${fallback.label}`);
    return true;
  };
  const modal=window.UIEngine?.modal ? window.UIEngine.modal({
    id:modalId,
    title:"Configure Device Button",
    subtitle:action.label || "Custom command button",
    body,
    size:"md",
    buttons:[
      {text:"Close", variant:"secondary"},
      {text:"Clear button", variant:"warning", onClick:clearAction},
      {text:"Save", variant:"success", onClick:saveAction}
    ]
  }) : null;
  setTimeout(()=>{
    const commandInput=document.getElementById("customPm3ActionCommand");
    const descriptionInput=document.getElementById("customPm3ActionDescription");
    if(commandInput && descriptionInput){
      commandInput.addEventListener("blur", ()=>{
        const firstCommand=parseCommandSetText(commandInput.value)[0] || commandInput.value;
        if(!descriptionInput.value.trim()) descriptionInput.value=customPm3CommandDescription(firstCommand);
      });
      commandInput.focus();
    }
  }, 80);
  if(!modal && typeof prompt==="function"){
    const command=prompt("Device command", action.command || "");
    if(command!==null){
      action.command=command.trim();
      action.description=action.description || customPm3CommandDescription(action.command);
      saveCustomPm3Actions(actions);
      renderCustomPm3ActionButtons();
    }
  }
}
function handleManualPm3Command(){
  const command=(document.getElementById("manualCmd")?.value || "").trim();
  if(!command) return;
  const safety=validatePm3Command(command, "manual");
  if(!safety.allowed){
    showBlockedPm3Command(command, safety);
    return;
  }
  pm3OneShotRun(command,/search|info|dump|list|read/i.test(command));
}
function parseCommandSetText(text){
  return String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(x=>x && !x.startsWith("#"));
}
function getCommandSets(){
  if(window.ElectronDatabase?.getCommandSets) return window.ElectronDatabase.getCommandSets();
  try{ return JSON.parse(localStorage.getItem("electronPm3CommandSets.v1") || "[]") || []; }catch{ return []; }
}
function saveCommandSetRecord(record){
  if(window.ElectronDatabase?.saveCommandSet) return window.ElectronDatabase.saveCommandSet(record);
  const items=getCommandSets(); const idx=items.findIndex(x=>x.id===record.id); const item=Object.assign({id:"cmdset_"+Date.now(),createdAt:new Date().toISOString()},record,{updatedAt:new Date().toISOString()});
  if(idx>=0) items[idx]=item; else items.unshift(item);
  localStorage.setItem("electronPm3CommandSets.v1",JSON.stringify(items,null,2));
  return item;
}
function deleteCommandSetRecord(id){
  if(window.ElectronDatabase?.deleteCommandSet){ window.ElectronDatabase.deleteCommandSet(id); return; }
  localStorage.setItem("electronPm3CommandSets.v1",JSON.stringify(getCommandSets().filter(x=>x.id!==id),null,2));
}
function selectedCommandSet(){
  const id=document.getElementById("commandSetSelect")?.value || "";
  return getCommandSets().find(x=>x.id===id) || null;
}
function renderCommandSets(selectedId=""){
  const select=document.getElementById("commandSetSelect");
  if(!select) return;
  const sets=getCommandSets();
  select.innerHTML=`<option value="">Select command set</option>`+sets.map(s=>`<option value="${String(s.id).replaceAll('"',"&quot;")}">${String(s.name||"Untitled")}</option>`).join("");
  if(selectedId) select.value=selectedId;
  const status=document.getElementById("commandSetStatus");
  if(status) status.textContent=sets.length?`${sets.length} saved command set${sets.length===1?"":"s"}.`:"No command sets saved yet.";
}
function loadSelectedCommandSet(){
  const item=selectedCommandSet();
  const status=document.getElementById("commandSetStatus");
  document.getElementById("commandSetName").value=item?.name||"";
  document.getElementById("commandSetCommands").value=(item?.commands||[]).join("\n");
  document.getElementById("commandSetContinue").checked=!!item?.continueOnError;
  if(status) status.textContent=item?`Selected: ${item.name} (${(item.commands||[]).length} commands)`:"No command set selected.";
}
function saveCurrentCommandSet(){
  const existing=selectedCommandSet();
  const name=(document.getElementById("commandSetName")?.value||"").trim();
  const commands=parseCommandSetText(document.getElementById("commandSetCommands")?.value||"");
  const status=document.getElementById("commandSetStatus");
  if(!name){ if(status) status.textContent="Enter a command set name first."; return; }
  if(!commands.length){ if(status) status.textContent="Enter at least one command."; return; }
  const saved=saveCommandSetRecord({id:existing?.id,name,commands,continueOnError:!!document.getElementById("commandSetContinue")?.checked,createdAt:existing?.createdAt});
  renderCommandSets(saved.id);
  if(status) status.textContent=`Saved: ${saved.name} (${commands.length} commands)`;
}
function setCommandSetButtonsRunning(r){
  ["saveCommandSetBtn","runCommandSetBtn","deleteCommandSetBtn","commandSetSelect"].forEach(id=>{const el=document.getElementById(id); if(el) el.disabled=r;});
}
async function runSelectedCommandSet(){
  const item=selectedCommandSet();
  const status=document.getElementById("commandSetStatus");
  if(!item){ if(status) status.textContent="Select a command set first."; return; }
  const commands=parseCommandSetText((item.commands||[]).join("\n"));
  if(!commands.length){ if(status) status.textContent="Selected command set has no commands."; return; }
  const ready=window.DeviceGuard?.ensure ? await window.DeviceGuard.ensure({workflow:`Command set: ${item.name}`, capabilities:[...new Set(commands.flatMap(command=>window.DeviceGuard.commandCapabilities(command)))]}) : {ok:true};
  if(!ready?.ok){ if(status) status.textContent="Device unavailable."; return; }
  beginDeviceConsoleWorkflow({
    id:"device-console-command-set",
    title:item.name || "Command set",
    status:`Preparing ${commands.length} PM3 command${commands.length===1?"":"s"}...`
  });
  deviceConsoleManagedBatch=true;
  commandRunning=true; runStart=Date.now(); lastScanStart=consoleBuffer.length; currentCommand=item.name;
  setButtonsRunning(true); setCommandSetButtonsRunning(true); startPm3Spinner("Running command set...");
  appendConsole(`\n[${nowTime()}] Running command set: ${item.name}\n`);
  let failed=false;
  for(let i=0;i<commands.length;i++){
    const command=commands[i];
    const safety=validatePm3Command(command, "command-set");
    startDeviceConsoleWorkflowStep(`Command ${i+1} of ${commands.length}: ${command}`,command);
    if(!safety.allowed){
      failed=true;
      finishDeviceConsoleWorkflowStep(command,{ok:false,status:"failed"});
      appendConsole(`\n[${nowTime()}] Command set ${i+1}/${commands.length} > ${command}\n[App] Command blocked: ${safety.reason}\n`);
      if(status) status.textContent=`Blocked: ${command}`;
      break;
    }
    currentCommand=command;
    setStatus(`🟡 Running command set ${i+1}/${commands.length}`);
    setCommandStatus(`Status: Running ${item.name} — ${i+1}/${commands.length}: ${command}`);
    if(status) status.textContent=`Running ${i+1}/${commands.length}: ${command}`;
    appendConsole(`\n[${nowTime()}] Command set ${i+1}/${commands.length} > ${command}\n`);
    let result;
    try{
      result=window.DeviceGuard?.runLiveCommand
        ? await window.DeviceGuard.runLiveCommand(command, {workflow:`Command set: ${item.name}`, silent:true, allowWhileBusy:true})
        : await window.pm3api.runPm3LiveCommand(command);
    }
    catch(err){ result={ok:false,message:String(err),stdout:"",stderr:""}; }
    finishDeviceConsoleWorkflowStep(command,result);
    if(!result.ok){
      failed=true;
      appendConsole(`[App] Command failed: ${result.message||"Unknown error"}\n`);
      if(!item.continueOnError) break;
      appendConsole("[App] Continue on error is enabled; running next command.\n");
    }
  }
  stopPm3Spinner();
  deviceConsoleManagedBatch=false;
  commandRunning=false; scanResultComplete=true; setButtonsRunning(false); setCommandSetButtonsRunning(false);
  const secs=runStart?((Date.now()-runStart)/1000).toFixed(1):"?";
  setStatus(failed?"🔴 Command set stopped with error":"🟢 Command set complete");
  setCommandStatus(failed?`Status: Command set stopped (${secs}s)`: `Status: Command set complete (${secs}s)`);
  if(status) status.textContent=failed?"Command set stopped on error.":"Command set complete.";
  completeDeviceConsoleWorkflow(failed?"failed":"completed",failed
    ? `${item.name} stopped with an error.`
    : `${item.name} complete.`);
  scrollConsole(true);
}
function deleteSelectedCommandSet(){
  const item=selectedCommandSet();
  const status=document.getElementById("commandSetStatus");
  if(!item){ if(status) status.textContent="Select a command set to delete."; return; }
  deleteCommandSetRecord(item.id);
  document.getElementById("commandSetName").value="";
  document.getElementById("commandSetCommands").value="";
  document.getElementById("commandSetContinue").checked=false;
  renderCommandSets();
  if(status) status.textContent=`Deleted: ${item.name}`;
}
function initCommandSets(){
  renderCommandSets();
  const panel=document.querySelector("#tab-live .commandSetPanel");
  if(panel) panel.open=true;
  const select=document.getElementById("commandSetSelect"); if(select) select.onchange=loadSelectedCommandSet;
  const saveBtn=document.getElementById("saveCommandSetBtn"); if(saveBtn) saveBtn.onclick=saveCurrentCommandSet;
  const runBtn=document.getElementById("runCommandSetBtn"); if(runBtn) runBtn.onclick=runSelectedCommandSet;
  const delBtn=document.getElementById("deleteCommandSetBtn"); if(delBtn) delBtn.onclick=deleteSelectedCommandSet;
}
async function init(){applyAppBranding();db=normaliseDatabase(await window.pm3api.loadDb());ensurePhotoStorageSettings();buildEditForm();
const sendFeedbackBtn=document.getElementById("sendFeedbackBtn");
if(sendFeedbackBtn) sendFeedbackBtn.onclick=openPreviewFeedbackModal;
if(window.pm3api.onPreviewShowWelcome) window.pm3api.onPreviewShowWelcome(()=>showPreviewWelcomeModal());
if(window.pm3api.onPreviewShowTestingInstructions) window.pm3api.onPreviewShowTestingInstructions(showPreviewTestingInstructionsModal);
if(window.pm3api.onPreviewOpenFeedback) window.pm3api.onPreviewOpenFeedback(openPreviewFeedbackModal);
const inventoryHelpBtn=document.getElementById("inventoryHelpBtn");
if(inventoryHelpBtn) inventoryHelpBtn.onclick=openInventoryHelpModal;
const selectVisibleBtn=document.getElementById("selectVisibleBtn");
if(selectVisibleBtn) selectVisibleBtn.onclick=selectVisibleInventory;
const clearSelectionBtn=document.getElementById("clearSelectionBtn");
if(clearSelectionBtn) clearSelectionBtn.onclick=clearInventorySelection;
updateSelectionStatus();
restorePm3Terminal();
  await initDeviceConnect();
  renderCustomPm3ActionButtons();
  const consoleEl=document.getElementById("console");
  attachTerminalResizeHandle(document.getElementById("atlasRawDetailsResizeHandle"), document.getElementById("atlasRawDetails"), {min:140,max:700});
  consoleEl.addEventListener("scroll",()=>{
  const nearBottom=consoleEl.scrollTop+consoleEl.clientHeight>=consoleEl.scrollHeight-60;
  autoFollowConsole=nearBottom;
});
initCommandSets();
const standaloneOpenDeviceBtn=document.getElementById("openDeviceStudioFromStandaloneBtn");
if(standaloneOpenDeviceBtn) standaloneOpenDeviceBtn.onclick=()=>showTab("device-studio");
window.ElectronPortalManager?.init?.();
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));const savePhotoSettingsBtn=document.getElementById("savePhotoSettingsBtn");if(savePhotoSettingsBtn)savePhotoSettingsBtn.onclick=savePhotoSettings;const resetPhotoSettingsBtn=document.getElementById("resetPhotoSettingsBtn");if(resetPhotoSettingsBtn)resetPhotoSettingsBtn.onclick=resetPhotoSettings;renderPhotoSettingsPanel();document.getElementById("search").oninput=()=>{clearDashboardFilter();renderInventory();updateClearSearchButton();};const clearSearchBtn=document.getElementById("clearSearchBtn");if(clearSearchBtn)clearSearchBtn.onclick=clearInventorySearch;updateClearSearchButton();document.getElementById("openAssetDialogBtn").onclick=openRfidTagSelector;document.getElementById("newAssetEntryBtn").onclick=newAsset;document.getElementById("newAssetBtn").onclick=newAsset;document.getElementById("saveAssetBtn").onclick=saveAsset;document.getElementById("duplicateAssetBtn").onclick=duplicateAsset;document.getElementById("markUnusableBtn").onclick=markUnusable;document.getElementById("deleteAssetBtn").onclick=deleteAsset;document.getElementById("selectPhotoBtn").onclick=selectPhoto;document.getElementById("removePhotoBtn").onclick=removePhoto;document.getElementById("photoPreviewBox").onclick=showPhotoDetail;document.getElementById("parseNewBtn").onclick=parseAsNew;document.getElementById("updateFromScanBtn").onclick=updateFromScan;document.getElementById("clearScanBtn").onclick=()=>document.getElementById("scanInput").value="";document.getElementById("listPm3Btn").onclick=checkPm3;document.getElementById("startPm3Btn").onclick=startPm3;document.getElementById("stopPm3Btn").onclick=async()=>{updateDeviceConnectionStatus({connected:false,checking:true,port:"",sessionOwner:"none"});await window.pm3api.stopPm3();activePm3Port=null;setStatus("🟠 PM3 session closed — checking USB presence...");setCommandStatus("Status: Idle");setButtonsRunning(false);await checkPm3({silent:true});};document.getElementById("readRegisterBtn").onclick=readAndRegister;document.querySelectorAll("[data-cmd]").forEach(b=>b.onclick=()=>sendPm3(b.dataset.cmd,b.dataset.cmd.includes("search")));document.getElementById("sendCmdBtn").onclick=handleManualPm3Command;document.getElementById("manualCmd").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();handleManualPm3Command();}};document.getElementById("clearConsoleBtn").onclick=()=>{clearPm3Terminal();lastScanStart=0;commandRunning=false;if(outputIdleTimer) clearTimeout(outputIdleTimer);setButtonsRunning(false);document.getElementById("scanSummary").className="matchPanel";document.getElementById("scanSummary").innerHTML="No scan parsed yet.";setCommandStatus("Status: Console cleared");};document.getElementById("followConsoleBtn").onclick=()=>{autoFollowConsole=true;scrollConsole(true);setCommandStatus("Status: Following output");};document.getElementById("parseConsoleBtn").onclick=()=>{document.getElementById("scanInput").value=consoleBuffer;showTab("edit");parseAsNew()};document.getElementById("detectBackupBtn").onclick=detectBackup;document.getElementById("saveBackupBtn").onclick=saveBackupInfo;document.getElementById("backupAsset").onchange=()=>renderBackupFields();["backupDump","backupJson","backupKey"].forEach(id=>{const el=document.getElementById(id); if(el) el.oninput=()=>renderBackupStatus();});document.getElementById("browseBackupDumpBtn").onclick=()=>browseBackupReference("dump");document.getElementById("browseBackupJsonBtn").onclick=()=>browseBackupReference("json");document.getElementById("browseBackupKeyBtn").onclick=()=>browseBackupReference("key");document.getElementById("restoreAsset").onchange=renderRestore;document.getElementById("restoreTarget").onchange=renderRestore;document.getElementById("generateRestoreBtn").onclick=renderRestore;document.getElementById("copyRestoreBtn").onclick=()=>navigator.clipboard.writeText(document.getElementById("restoreCommands").textContent);if(document.getElementById("compareDumpsBtn"))document.getElementById("compareDumpsBtn").onclick=compareDumpFiles;
if(document.getElementById("storeManagedDumpBtn"))document.getElementById("storeManagedDumpBtn").onclick=storeManagedDump;
if(document.getElementById("compareManagedBtn"))document.getElementById("compareManagedBtn").onclick=compareManagedDumps;document.getElementById("labelAsset").onchange=renderLabel;document.getElementById("labelStyle").onchange=renderLabel;document.getElementById("refreshLabelBtn").onclick=renderLabel;document.getElementById("printLabelBtn").onclick=printLabel;document.getElementById("exportJsonBtn").onclick=confirmExportJson;
document.getElementById("restoreOpenAssetBtn").onclick=()=>openWorkspaceAssetSelector("restoreAsset","restoreAssetStatus",renderRestore);
document.getElementById("compareOpenAssetABtn").onclick=()=>openWorkspaceAssetSelector("compareAssetA","compareAssetAStatus",renderCompareSelects);
document.getElementById("compareOpenAssetBBtn").onclick=()=>openWorkspaceAssetSelector("compareAssetB","compareAssetBStatus",renderCompareSelects);
document.getElementById("compareStoreOpenAssetBtn").onclick=()=>openWorkspaceAssetSelector("compareStoreAsset","compareStoreAssetStatus",renderCompareSelects);
document.getElementById("labelOpenAssetBtn").onclick=()=>openWorkspaceAssetSelector("labelAsset","labelAssetStatus",renderLabel);
const updateLastExportBtn=document.getElementById("updateLastExportBtn");
if(updateLastExportBtn) updateLastExportBtn.onclick=updateLastExport;
const updateExistingExportBtn=document.getElementById("updateExistingExportBtn");
if(updateExistingExportBtn) updateExistingExportBtn.onclick=updateExistingExport;
if(window.pm3api.onPm3Status) window.pm3api.onPm3Status(()=>{activePm3Offline=false;});
			document.getElementById("importJsonBtn").onclick=importTags;document.getElementById("exportCsvBtn").onclick=confirmExportCsv;if(window.pm3api.onSettingsUpdated)window.pm3api.onSettingsUpdated(async payload=>{if(["database","photo-settings"].includes(payload?.type)){db=normaliseDatabase(await window.pm3api.loadDb());render();}if(payload?.type==="help-icons" && window.HelpEngine){window.HelpEngine.refresh();}});window.pm3api.onPm3Output(text=>{appendConsole(text);appendDeviceCommandModalOutput(text);handlePm3TransportLoss(text);});window.pm3api.onPm3Status(()=>{activePm3Port=null;updateDeviceConnectionStatus({connected:false,checking:true,port:"",sessionOwner:"none"});updateHeaderPm3Leds({leds:{a:false,b:false,c:false,d:false}});setStatus("🟠 PM3 session stopped — checking USB presence...");setCommandStatus("Status: Idle");setButtonsRunning(false);checkPm3({silent:true});});renderDeviceConnectionStatusCards();render();checkPm3({silent:true,background:true});startPm3PresenceMonitor();startHeaderPm3LedMonitor();showPreviewWelcomeIfNeeded();showPreviewExpiryFeedbackPromptIfNeeded();}
init();


/* PM3_ONESHOT_EXEC_MODE_V531 */
async function pm3OneShotRun(command, scan=true){
  command=(command||"").trim();
  if(!command) return;
  const state=await window.pm3api.pm3State?.();
  if(state?.running){
    await sendPm3(command, scan);
    return;
  }
  const ready=window.DeviceGuard?.ensure ? await window.DeviceGuard.ensure({workflow:scan ? "Device scan" : "Device command", command}) : {ok:true};
  if(!ready?.ok){
    commandRunning=false;
    scanResultComplete=false;
    setButtonsRunning(false);
    setStatus("🔴 Device unavailable");
    setCommandStatus("Status: Device check failed");
    return;
  }

  beginDeviceConsoleWorkflow({
    id:scan?"device-console-one-shot-scan":"device-console-one-shot-command",
    title:scan?"Device scan":"Device Console command",
    status:`Connecting before ${command}...`
  });
  startDeviceConsoleWorkflowStep(scan?`Running scan command: ${command}`:`Running device command: ${command}`,command);
  lastScanStart = consoleBuffer.length;
  lastParsedScan = null;
  scanResultComplete = false;
  commandRunning = true;
  currentCommand = command;
  runStart = Date.now();

  document.querySelectorAll("#tab-live button[data-cmd],#readRegisterBtn,#sendCmdBtn").forEach(b=>b.disabled=true);
  window.DeviceGuard?.setBusy?.(true);

  startPm3Spinner("Starting device client...");
  setCommandStatus("Status: Starting device client, connecting and executing command... This can take a few seconds.");

  const box=document.getElementById("scanSummary");
  if(scan){
    box.className="matchPanel";
    box.innerHTML="🟡 Scan running...";
  }

  const el=document.getElementById("console");
  updatePm3Spinner("Connecting to device...");
  const startText=`\n[${nowTime()}] Starting one-shot device command...\n[${nowTime()}] Command: ${command}\nPlease wait while the device client starts and connects.\n`;
  appendPm3Terminal(startText, {forceScroll:true});

  let result;
  try{
    result = await window.pm3api.runPm3LiveCommand(command);
  }catch(err){
    result = {ok:false,message:String(err),stdout:"",stderr:""};
  }
  window.DeviceGuard?.setBusy?.(false);

  updatePm3Spinner("Executing " + command + "...");
  const output = (result.stdout || "") + (result.stderr || "");
  appendPm3Terminal(output ? `${output}\n` : `[App] ${result.message || "No output returned."}\n`, {forceScroll:true});

  commandRunning = false;
  scanResultComplete = true;
  document.querySelectorAll("#tab-live button[data-cmd],#readRegisterBtn,#sendCmdBtn").forEach(b=>b.disabled=false);

  const secs = runStart ? ((Date.now()-runStart)/1000).toFixed(1) : "?";
  const parsed = parsePm3(output);

  stopPm3Spinner();
  finishDeviceConsoleWorkflowStep(command,result);
  if(!result.ok && pm3ResultHasNoTag(output, command)){
    setStatus("🟢 Scan complete — no tag detected");
    setCommandStatus(`Status: Complete (${secs}s)`);
    box.className="matchPanel";
    box.innerHTML=pm3NoTagMessage(command);
    completeDeviceConsoleWorkflow("warning","Scan complete — no tag was detected.");
    return;
  }

  if(!result.ok){
    setStatus("🔴 Device command failed");
    setCommandStatus("Status: Error");
    box.className="matchPanel";
    box.innerHTML="Device command failed. Check console output.";
    completeDeviceConsoleWorkflow("failed",`Device command failed — ${result.message || command}`);
    return;
  }

  if(scan){
    if(parsed.currentUid){
      lastParsedScan = parsed;
      setStatus("🟢 Scan complete: " + parsed.currentUid);
      setCommandStatus(`Status: Complete (${secs}s)`);
      renderUidMatchPanel(parsed);
      if(pm3ResultHasMultipleTags(output)){
        setStatus("🟠 Scan complete — multiple tags detected");
        setCommandStatus(`Status: Complete with warning (${secs}s)`);
        pm3DecorateMultipleTagWarning();
        completeDeviceConsoleWorkflow("warning","Scan complete — multiple tags were detected.");
      }else{
        completeDeviceConsoleWorkflow("completed",`Scan complete — UID ${parsed.currentUid}`);
      }
    }else{
      if(pm3ResultHasNoTag(output, command)){
        setStatus("🟢 Scan complete — no tag detected");
        setCommandStatus(`Status: Complete (${secs}s)`);
        box.className="matchPanel";
        box.innerHTML=pm3NoTagMessage(command);
        completeDeviceConsoleWorkflow("warning","Scan complete — no tag was detected.");
      }else{
        setStatus("🟢 Scan complete — no supported UID parsed");
        setCommandStatus(`Status: Complete (${secs}s)`);
        box.className="matchPanel";
        box.innerHTML="Scan complete. No supported UID was parsed from this output.";
        completeDeviceConsoleWorkflow("warning","Scan complete — no supported UID was parsed.");
      }
    }
  }else{
    completeDeviceConsoleWorkflow("completed",`Device command complete — ${command}`);
    await restorePm3ReadyStatusAfterCommand(secs);
  }
}

async function pm3ReadIdentifyHfLf(){
  setCommandStatus("Status: Read / Identify starts with HF, then tries LF if needed.");
  await pm3OneShotRun("hf search",true);
  if(lastParsedScan?.currentUid) return;
  setCommandStatus("Status: No HF UID parsed. Trying LF...");
  await pm3OneShotRun("lf search",true);
}

function installPm3OneShotHandlers(){
  const buttons=[...document.querySelectorAll("#tab-live button[data-cmd]")];
  const hfBtn=buttons.find(b=>b.dataset.cmd==="hf search");
  const lfBtn=buttons.find(b=>b.dataset.cmd==="lf search");
  const hwBtn=buttons.find(b=>b.dataset.cmd==="hw version");
  const mfInfoBtn=buttons.find(b=>b.dataset.cmd==="hf mf info");

  if(hfBtn) hfBtn.onclick=()=>pm3OneShotRun("hf search",true);
  if(lfBtn) lfBtn.onclick=()=>pm3OneShotRun("lf search",true);
  if(hwBtn) hwBtn.onclick=()=>pm3OneShotRun("hw version",false);
  if(mfInfoBtn) mfInfoBtn.onclick=()=>pm3OneShotRun("hf mf info",true);

  const readBtn=document.getElementById("readRegisterBtn");
  if(readBtn){
    readBtn.textContent="Read / Identify HF+LF";
    readBtn.onclick=pm3ReadIdentifyHfLf;
  }
}
setTimeout(installPm3OneShotHandlers, 700);
window.pm3OneShotRun=pm3OneShotRun;
window.pm3ReadIdentifyHfLf=pm3ReadIdentifyHfLf;
window.electronMirrorPm3Command=mirrorInlinePm3Command;
window.electronAppendPm3Terminal=appendPm3Terminal;
window.electronGetPm3Terminal=()=>consoleBuffer || document.getElementById("console")?.textContent || "";
window.electronRestorePm3Terminal=restorePm3Terminal;
window.electronRunPm3CommandWithSharedOutput=async(command, options={})=>{
  const cmd=String(command || "").trim();
  if(!cmd) return {ok:false, output:"No command provided.", message:"No command provided."};
  const startLength=consoleBuffer.length;
  let result;
  try{
    result=window.DeviceGuard?.runLiveCommand
      ? await window.DeviceGuard.runLiveCommand(cmd, {workflow:options.workflow || "Device command", silent:true})
      : await window.pm3api.runPm3LiveCommand(cmd);
  }catch(err){
    result={ok:false,message:String(err),stdout:"",stderr:""};
  }
  let output=(result?.stdout || "") + (result?.stderr || "");
  if(result?.sentToActiveSession && !meaningfulDeviceConsoleOutput(output, cmd)){
    output=await waitForDeviceConsoleOutput(startLength, {command:cmd, requireDeviceText:true});
  }
  const meaningful=meaningfulDeviceConsoleOutput(output, cmd);
  return {...result, output:meaningful || output || result?.message || "No output returned."};
};


/* PM3_PROGRESS_SPINNER_V531 */
let pm3SpinnerTimer = null;
let pm3SpinnerIndex = 0;
let pm3SpinnerBaseText = "";
const pm3SpinnerFrames = ["|","/","-","\\"];

function startPm3Spinner(text){
  stopPm3Spinner();
  pm3SpinnerBaseText = text || "Working...";
  pm3SpinnerIndex = 0;
  pm3SpinnerTimer = setInterval(()=>{
    const frame = pm3SpinnerFrames[pm3SpinnerIndex % pm3SpinnerFrames.length];
    setStatus("🟡 " + frame + "  " + pm3SpinnerBaseText);
    pm3SpinnerIndex++;
  }, 120);
}

function updatePm3Spinner(text){
  pm3SpinnerBaseText = text || pm3SpinnerBaseText;
}

function stopPm3Spinner(){
  if(pm3SpinnerTimer){
    clearInterval(pm3SpinnerTimer);
    pm3SpinnerTimer = null;
  }
}


/* PM3_LIVE_OUTPUT_LISTENER_V531 */
if(window.pm3api && window.pm3api.onPm3LiveOutput){
  window.pm3api.onPm3LiveOutput((text)=>{
    appendPm3Terminal(text);
    appendDeviceCommandModalOutput(text);

    if(commandRunning){
      if(/Using UART|Communicating with PM3/i.test(text)){
        updatePm3Spinner("Connecting to Proxmark3...");
      }else if(/execute command from commandline|pm3 -->/i.test(text)){
        updatePm3Spinner("Running " + currentCommand + "...");
      }else if(/Searching|ISO14443|UID:|Valid ISO/i.test(text)){
        updatePm3Spinner("Scanning card / reading tag...");
      }
    }
  });
}


/* PM3_RESULT_CLASSIFIER_V532 */
function pm3ResultHasNoTag(output, command){
  const txt = output || "";
  if(/No known\/supported\s+13\.56\s*MHz\s+tags\s+found/i.test(txt)) return true;
  if(/No known\/supported\s+125\s*kHz\s+tags\s+found/i.test(txt)) return true;
  if(/Couldn't identify a chipset/i.test(txt) && /lf search/i.test(command||"")) return true;
  return false;
}

function pm3ResultHasMultipleTags(output){
  return /Multiple tags detected|Collision after Bit|collision/i.test(output || "");
}

function pm3NoTagMessage(command){
  if(/hf search/i.test(command||"")){
    return `No supported 13.56 MHz (HF) tag was detected.<br><br>
<b>Please check:</b><br>
• Place the tag on the <b>HF antenna area</b> (lower part of the Proxmark3 board).<br>
• If you are scanning a <b>125 kHz (LF)</b> tag, use <b>Scan LF</b> instead.`;
  }

  if(/lf search/i.test(command||"")){
    return `No supported 125 kHz (LF) tag was detected.<br><br>
<b>Please check:</b><br>
• Place the tag on the <b>LF antenna area</b> (upper part of the Proxmark3 board).<br>
• If you are scanning a <b>13.56 MHz (HF)</b> card, use <b>Scan HF</b> instead.`;
  }

  return "No supported tag was detected.";
}

function pm3DecorateMultipleTagWarning(){
  const box=document.getElementById("scanSummary");
  if(!box) return;
  const existing=box.innerHTML || "";
  box.className="matchPanel warn";
  box.innerHTML =
    "<b>⚠️ Multiple tags detected</b><br>" +
    "Results may be unreliable. Please present only one tag for a clean scan." +
    "<hr>" + existing;
}


/* Compare functions moved to compareManager.js */
