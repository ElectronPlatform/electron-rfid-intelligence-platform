var db=null;

function tableEscape(v){
  return String(v ?? "").replace(/[&<>"']/g, c=>({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function normaliseDatabase(next){
  const clean={...(next || {})};
  clean.version=clean.version || 5;
  clean.settings=clean.settings || {lastAssignedNumber:0};
  if(!Array.isArray(clean.assets)) clean.assets=[];
  if(!Array.isArray(clean.log)) clean.log=[];
  return clean;
}

async function mutateCollection(operation,payload={},options={}){
  const result=await window.pm3api.mutateCollection(operation,payload);
  if(!result?.ok){
    const message=(result?.diagnostics || []).filter(item=>item?.severity==="error").map(item=>item.message).join(" ") || "The Collection change could not be saved.";
    if(options.showError!==false) window.UIEngine.alert({title:"Collection not changed",body:`<p>${tableEscape(message)}</p>`,variant:"danger",buttonText:"Close"});
    return null;
  }
  db=normaliseDatabase(result.database);
  window.pm3api.notifySettingsUpdated({type:"database"});
  return result;
}

async function updateCollectionSettings(changes){
  return mutateCollection("updateSettings",{changes});
}

async function refreshDb(){
  db=normaliseDatabase(await window.pm3api.loadDb());
  ensurePhotoStorageSettings();
}

async function renderBackupFolderSettings(){
  const current=document.getElementById("backupFolderPath");
  const def=document.getElementById("backupFolderDefault");
  if(!current || !window.pm3api?.getBackupFolder) return;
  const info=await window.pm3api.getBackupFolder();
  current.value=info.current || "";
  if(def) def.textContent=`Default: ${info.default || ""}`;
}

async function chooseBackupFolder(){
  if(!window.pm3api?.chooseBackupFolder) return;
  await window.pm3api.chooseBackupFolder();
  await renderBackupFolderSettings();
  const status=document.getElementById("backupFolderStatus");
  if(status) status.textContent="Backup folder updated.";
  window.pm3api.notifySettingsUpdated({type:"backup-folder"});
}

async function resetBackupFolder(){
  if(!window.pm3api?.resetBackupFolder) return;
  await window.pm3api.resetBackupFolder();
  await renderBackupFolderSettings();
  const status=document.getElementById("backupFolderStatus");
  if(status) status.textContent="Backup folder reset to default.";
  window.pm3api.notifySettingsUpdated({type:"backup-folder"});
}

function renderPm3SafetyRules(){
  const box=document.getElementById("pm3SafetyRules");
  if(!box || !window.Pm3CommandSafety?.listRules) return;
  const rules=window.Pm3CommandSafety.listRules();
  const custom=rules.custom || [];
  const builtIn=rules.builtIn || [];
  const row=(item, type)=>`<tr>
    <td>${tableEscape(type)}</td>
    <td><code>${tableEscape(item.patternText || item.id || "")}</code></td>
    <td>${tableEscape(item.reason || "")}</td>
    <td>${item.custom ? `<button type="button" class="bad smallBtn" data-delete-pm3-safety="${tableEscape(item.id)}">Delete</button>` : `<span class="small">Built-in</span>`}</td>
  </tr>`;
  box.innerHTML=`<div class="tablewrap pm3SafetyTableWrap"><table class="pm3SafetyTable">
    <tr><th>Type</th><th>Command / pattern</th><th>Reason</th><th>Action</th></tr>
    ${custom.map(item=>row(item,"Custom")).join("")}
    ${builtIn.map(item=>row(item,"Built-in")).join("")}
  </table></div>`;
  box.querySelectorAll("[data-delete-pm3-safety]").forEach(btn=>{
    btn.onclick=()=>{
      window.Pm3CommandSafety.deleteCustomBlock(btn.dataset.deletePm3Safety);
      const status=document.getElementById("pm3SafetyStatus");
      if(status) status.textContent="Blocked command removed.";
      renderPm3SafetyRules();
      window.pm3api.notifySettingsUpdated({type:"pm3-safety"});
    };
  });
}

function addPm3SafetyBlock(){
  const pattern=document.getElementById("pm3SafetyPattern");
  const reason=document.getElementById("pm3SafetyReason");
  const status=document.getElementById("pm3SafetyStatus");
  const result=window.Pm3CommandSafety?.saveCustomBlock({
    patternText:pattern?.value || "",
    reason:reason?.value || ""
  });
  if(!result?.ok){
    if(status) status.textContent=result?.message || "Could not save blocked command.";
    return;
  }
  if(pattern) pattern.value="";
  if(reason) reason.value="";
  if(status) status.textContent="Blocked command added.";
  renderPm3SafetyRules();
  window.pm3api.notifySettingsUpdated({type:"pm3-safety"});
}

async function backupFullDatabase(){
  const result=await window.pm3api.exportJson(db);
  const status=document.getElementById("databaseManagerStatus");
  if(result?.ok && status) status.textContent=`Database backup saved: ${result.filename || result.filePath || ""}`;
}

async function restoreDatabase(){
  const ok=await window.UIEngine.confirm({
    title:"Restore Database?",
    body:"<p>Restore Database will replace the entire current RFID database with the selected JSON backup.</p><p>This cannot be undone unless you have another backup.</p>",
    confirmText:"Restore",
    danger:true
  });
  if(!ok) return;
  const restored=await window.pm3api.restoreDatabase();
  if(!restored) return;
  if(!restored.ok){
    const message=(restored.diagnostics || []).filter(item=>item.severity==="error").map(item=>item.message).join(" ") || "The selected database could not be restored.";
    window.UIEngine.alert({title:"Database not restored",body:`<p>${tableEscape(message)}</p>`,variant:"danger",buttonText:"Close"});
    return;
  }
  db=normaliseDatabase(restored.database);
  renderPhotoSettingsPanel();
  window.pm3api.notifySettingsUpdated({type:"database"});
  window.UIEngine.alert({title:"Database restored", body:"<p>The RFID database was restored from the selected backup.</p>", variant:"success", buttonText:"Close"});
}

async function clearDatabase(){
  const assetCount=Array.isArray(db?.assets) ? db.assets.length : 0;
  const logCount=Array.isArray(db?.log) ? db.log.length : 0;
  const ok=await window.UIEngine.confirm({
    title:"Clear entire database?",
    body:`<p>This will remove all RFID tags and history from the active Electron database.</p><p>Current database: <b>${assetCount}</b> RFID tags and <b>${logCount}</b> log entries.</p><p>Electron will first create an automatic JSON backup in the backup folder.</p>`,
    confirmText:"Clear Database",
    cancelText:"Close",
    danger:true
  });
  if(!ok) return;
  const result=await window.pm3api.clearDatabase();
  if(!result?.ok){
    window.UIEngine.alert({title:"Database not cleared", body:`<p>${tableEscape(result?.message || "Electron could not clear the database.")}</p>`, variant:"danger", buttonText:"Close"});
    return;
  }
  db=normaliseDatabase(result.db);
  renderPhotoSettingsPanel();
  const status=document.getElementById("databaseManagerStatus");
  if(status) status.textContent=`Database cleared. Safety backup: ${result.backupName || ""}`;
  window.pm3api.notifySettingsUpdated({type:"database"});
  window.UIEngine.alert({title:"Database cleared", body:`<p>The active database is now empty.</p><p>Safety backup created: <b>${tableEscape(result.backupName || "")}</b></p>`, variant:"success", buttonText:"Close"});
}

function openDatabaseManager(){
  const assetCount=Array.isArray(db?.assets) ? db.assets.length : 0;
  const logCount=Array.isArray(db?.log) ? db.log.length : 0;
  const body=`<div class="databaseManagerModal">
    <p>Use this when you want to back up the whole Electron database, restore a complete database file, or start over with an empty database.</p>
    <div class="databaseManagerStats">
      <div><span>RFID tags</span><b>${assetCount}</b></div>
      <div><span>Log entries</span><b>${logCount}</b></div>
    </div>
    <section class="databaseManagerWarning">
      <b>Clear Database is destructive.</b>
      <p>Electron creates a safety backup first, but the active database will become empty after confirmation.</p>
    </section>
  </div>`;
  window.UIEngine.modal({
    id:"databaseManagerModal",
    title:"Database Manager",
    subtitle:"Backup, import or clear the complete database",
    body,
    size:"md",
    closeOnOverlay:false,
    buttons:[
      {text:"Backup Database", variant:"success", close:false, onClick:async()=>{await backupFullDatabase(); return false;}},
      {text:"Import / Restore Database", variant:"primary", close:false, onClick:async()=>{await restoreDatabase(); return false;}},
      {text:"Clear Database", variant:"danger", close:false, onClick:async()=>{await clearDatabase(); return false;}},
      {text:"Close", variant:"secondary"}
    ]
  });
}

function initHelpToggle(){
  const checkbox=document.getElementById("showHelpEngineIcons");
  if(!checkbox) return;
  checkbox.checked=localStorage.getItem("teamElectron.showHelpEngineIcons") !== "false";
  checkbox.onchange=()=>{
    localStorage.setItem("teamElectron.showHelpEngineIcons", checkbox.checked ? "true" : "false");
    if(window.HelpEngine?.setIconsEnabled) window.HelpEngine.setIconsEnabled(checkbox.checked);
    if(window.HelpEngine?.applyVisibility) window.HelpEngine.applyVisibility();
    window.pm3api.notifySettingsUpdated({type:"help-icons"});
  };
}

function applyMaintainerVisibility(){
  const enabled=window.pm3api?.maintainerCapability?.enabled === true;
  document.querySelectorAll('[data-maintainer-only="true"]').forEach(element=>{
    element.hidden=!enabled;
  });
  return enabled;
}

function renderEngineeringModeSettings(){
  const checkbox=document.getElementById("engineeringModeEnabled");
  const badge=document.getElementById("engineeringModeBadge");
  const status=document.getElementById("engineeringModeStatus");
  const state=window.EngineeringMode?.getState?.();
  const enabled=state?.enabled === true;
  if(checkbox) checkbox.checked=enabled;
  if(badge){
    badge.textContent=enabled ? "On" : "Off";
    badge.dataset.enabled=enabled ? "true" : "false";
  }
  if(status){
    status.textContent=enabled
      ? "Engineering Mode context is active. No component currently exposes additional information."
      : "Standard mode is active.";
  }
}

function notifyEngineeringModeUpdated(state){
  window.pm3api?.notifySettingsUpdated?.({
    type:"engineering-mode",
    enabled:state?.enabled === true,
    acknowledgementVersion:state?.acknowledgementVersion || null
  });
}

async function requestEngineeringModeEnable(){
  const checkbox=document.getElementById("engineeringModeEnabled");
  if(!window.EngineeringMode || !checkbox) return;
  checkbox.disabled=true;
  const acknowledged=await window.UIEngine.confirm({
    id:"engineeringModeAcknowledgement",
    title:"Enable Engineering Mode?",
    size:"md",
    showX:false,
    closeOnEscape:false,
    body:`<div class="engineeringModeAcknowledgement">
      <p>Engineering Mode is an optional local framework for advanced engineering, protocol analysis and research.</p>
      <ul>
        <li>This switch does not currently expose or store additional information.</li>
        <li>Future parsers, viewers and protocol modules may use this context to offer additional locally available technical detail.</li>
        <li>Each future integration will define its own behaviour; Engineering Mode is not blanket permission for a component to change what it does.</li>
        <li>You can return to Standard Mode at any time in Settings.</li>
      </ul>
      <p><b>Select “I understand — enable” to acknowledge this information.</b></p>
    </div>`,
    confirmText:"I understand — enable",
    cancelText:"Keep disabled",
    variant:"warning"
  });
  checkbox.disabled=false;
  if(!acknowledged){
    checkbox.checked=false;
    renderEngineeringModeSettings();
    return;
  }
  const result=window.EngineeringMode.setEnabled(true, {
    acknowledged:true,
    source:"settings"
  });
  renderEngineeringModeSettings();
  if(result?.ok) notifyEngineeringModeUpdated(result.state);
}

function initEngineeringModeSettings(){
  const checkbox=document.getElementById("engineeringModeEnabled");
  if(!checkbox || !window.EngineeringMode) return;
  renderEngineeringModeSettings();
  checkbox.onchange=async()=>{
    if(checkbox.checked){
      await requestEngineeringModeEnable();
      return;
    }
    const result=window.EngineeringMode.setEnabled(false, {source:"settings"});
    renderEngineeringModeSettings();
    if(result?.ok) notifyEngineeringModeUpdated(result.state);
  };
  window.EngineeringMode.subscribe(renderEngineeringModeSettings);
}

function focusSection(target){
  const id=String(target || "").replace(/^#/, "");
  const el=document.getElementById(id);
  if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
}

async function runPreviewChecklist(){
  const box=document.getElementById("previewChecklistResult");
  if(!box || !window.pm3api?.runPreviewChecklist) return;
  box.textContent="Running Preview Build checklist...";
  const result=await window.pm3api.runPreviewChecklist();
  const rows=(result?.checks || []).map(check=>`<li class="${check.ok ? "ok" : "fail"}"><b>${check.ok ? "✓" : "!"} ${tableEscape(check.label)}</b><span>${tableEscape(check.detail || "")}</span></li>`).join("");
  box.innerHTML=`<div class="previewChecklistSummary ${result?.ok ? "ok" : "fail"}">${result?.ok ? "Preview checklist passed." : "Preview checklist needs attention."}</div><ul>${rows}</ul>`;
}

function renderPreviewLicenseStatus(status){
  const box=document.getElementById("previewLicenseStatus");
  if(!box) return;
  const days=status?.daysRemaining === null || status?.daysRemaining === undefined ? "Unlimited" : `${status.daysRemaining} day${status.daysRemaining===1?"":"s"}`;
  const expiresAt=status?.expiresAt ? new Date(status.expiresAt).toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"}) : "No expiry";
  const startedAt=status?.firstStartedAt ? new Date(status.firstStartedAt).toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"}) : "Unknown";
  const extensionActive=!!status?.extension;
  const deviceBinding=status?.deviceBinding || {};
  const deviceLabel=deviceBinding.state==="blocked"
    ? "Verification required"
    : deviceBinding.state==="mismatch"
      ? "Needs attention"
      : deviceBinding.state==="unavailable"
        ? "Not available"
        : "Verified on this Mac";
  const accessLabel=status?.expired
    ? "Preview expired"
    : extensionActive
      ? (status.extension.type==="unlimited" ? "Internal access active" : "Extended Preview active")
      : status?.state || "Full Preview";
  const badge=document.getElementById("previewAccessBadge");
  if(badge){
    badge.textContent=accessLabel;
    badge.dataset.state=status?.expired ? "expired" : status?.state==="Preview Ending Soon" ? "ending" : "active";
  }
  const currentText=document.getElementById("previewCurrentAccessText");
  if(currentText){
    if(status?.expired){
      currentText.textContent="Your standard Preview period has ended. Your saved RFID Collection remains on this computer.";
    }else if(extensionActive){
      currentText.textContent=status.extension.type==="unlimited"
        ? "A valid signed internal access token is active for this installation."
        : `A valid signed extension is active. Your current access is available until ${expiresAt}.`;
    }else{
      currentText.textContent=`You have the standard 30-day Public Preview with ${days} remaining. It includes the complete current Preview feature set.`;
    }
  }
  const deviceText=document.getElementById("previewDeviceVerificationText");
  if(deviceText){
    if(deviceBinding.state==="blocked"){
      deviceText.textContent="Electron could not confirm this as the same Mac after three consecutive launches. Contact Electron Support for a signed recovery token.";
    }else if(deviceBinding.state==="mismatch"){
      const attempts=Math.max(0,Number(deviceBinding.attemptsRemaining || 0));
      deviceText.textContent=`Electron could not match the usual local device signals. ${attempts} confirmation attempt${attempts===1?"":"s"} remain before access is paused.`;
    }else if(deviceBinding.state==="unavailable"){
      deviceText.textContent="Local device signals are temporarily unavailable. Electron does not treat missing information as proof that this is a different Mac.";
    }else{
      deviceText.textContent="This installation matches the local device signals recorded when the Preview first ran. Only privacy-preserving hashes are stored.";
    }
  }
  box.innerHTML=`<div class="previewAccessSummary">
    <div><span>Current access</span><b>${tableEscape(accessLabel)}</b></div>
    <div><span>Time remaining</span><b>${tableEscape(days)}</b></div>
    <div><span>Access ends</span><b>${tableEscape(expiresAt)}</b></div>
    <div><span>Device verification</span><b>${tableEscape(deviceLabel)}</b></div>
  </div>`;
  const technical=document.getElementById("previewTechnicalStatus");
  if(!technical) return;
  technical.innerHTML=`
    <div><span>Version</span><b>${tableEscape(status?.buildVersion || "Unknown")}</b></div>
    <div><span>Build</span><b>${tableEscape(status?.buildLabel || "Preview Build")}</b></div>
    <div><span>Installation ID</span><b>${tableEscape(status?.installationId || "Unknown")}</b></div>
    <div><span>Preview started</span><b>${tableEscape(startedAt)}</b></div>
    <div><span>Access ends</span><b>${tableEscape(expiresAt)}</b></div>
    <div><span>Tester level</span><b>${tableEscape(status?.testerLevel || "Preview Tester")}</b></div>
    <div><span>Device verification</span><b>${tableEscape(deviceLabel)}</b></div>
  `;
}

async function refreshPreviewLicenseStatus(){
  if(!window.pm3api?.getPreviewLicenseStatus) return;
  renderPreviewLicenseStatus(await window.pm3api.getPreviewLicenseStatus());
}

async function applyPreviewExtensionKey(){
  const input=document.getElementById("previewExtensionKeyInput");
  const status=document.getElementById("previewExtensionKeyStatus");
  const result=await window.pm3api?.applyPreviewExtensionKey?.(input?.value || "");
  if(result?.ok){
    if(status) status.textContent=result?.message || (result?.action==="device-rebound" ? "Device verification restored." : "Preview Extension Key accepted.");
    if(input) input.value="";
    await refreshPreviewLicenseStatus();
  }else if(status){
    status.textContent=result?.message || "Preview Extension Key could not be applied.";
  }
}

async function requestPreviewAccess(reason){
  if(!window.pm3api?.requestPreviewExtension) return;
  await window.pm3api.requestPreviewExtension({reason});
}

async function updateFullScreenControl(){
  const button=document.getElementById("exitSettingsFullScreenBtn");
  if(!button) return;
  const state=await window.pm3api?.getCurrentWindowState?.();
  button.hidden=!state?.isFullScreen;
}

async function init(){
  const cfg=window.ElectronAppConfig || {};
  document.title=`${cfg.APP_NAME || "Electron"} Settings`;
  const maintainerMode=applyMaintainerVisibility();
  await refreshDb();
  renderPhotoSettingsPanel();
  await renderBackupFolderSettings();
  await refreshPreviewLicenseStatus();
  renderPm3SafetyRules();
  initHelpToggle();
  if(maintainerMode) initEngineeringModeSettings();

  document.getElementById("savePhotoSettingsBtn").onclick=()=>{savePhotoSettings(); window.pm3api.notifySettingsUpdated({type:"photo-settings"});};
  document.getElementById("resetPhotoSettingsBtn").onclick=()=>{resetPhotoSettings(); window.pm3api.notifySettingsUpdated({type:"photo-settings"});};
  document.getElementById("revertPhotoThumbMaxSide").onclick=()=>revertPhotoSettingField("photoThumbMaxSide");
  document.getElementById("revertPhotoThumbQuality").onclick=()=>revertPhotoSettingField("photoThumbQuality");
  document.getElementById("revertPhotoFullMaxSide").onclick=()=>revertPhotoSettingField("photoFullMaxSide");
  document.getElementById("revertPhotoFullQuality").onclick=()=>revertPhotoSettingField("photoFullQuality");
  document.getElementById("addPm3SafetyBlockBtn").onclick=addPm3SafetyBlock;
  document.getElementById("openDatabaseManagerBtn").onclick=openDatabaseManager;
  const runPreviewChecklistBtn=document.getElementById("runPreviewChecklistBtn");
  if(maintainerMode && runPreviewChecklistBtn) runPreviewChecklistBtn.onclick=runPreviewChecklist;
  document.getElementById("applyPreviewExtensionKeyBtn").onclick=applyPreviewExtensionKey;
  document.getElementById("requestPreviewExtensionBtn").onclick=()=>requestPreviewAccess("I would like to request additional Electron Preview testing time.");
  document.getElementById("askPreviewLicenceOptionsBtn").onclick=()=>window.pm3api.openElectronPortalContact?.();
  document.getElementById("browseBackupFolderBtn").onclick=chooseBackupFolder;
  document.getElementById("resetBackupFolderBtn").onclick=resetBackupFolder;
  const closeSettingsBtn=document.getElementById("closeSettingsBtn");
  if(closeSettingsBtn) closeSettingsBtn.onclick=()=>window.pm3api.closeCurrentWindow?.();
  const exitSettingsFullScreenBtn=document.getElementById("exitSettingsFullScreenBtn");
  if(exitSettingsFullScreenBtn) exitSettingsFullScreenBtn.onclick=()=>window.pm3api.exitFullScreen?.();
  window.pm3api.onFullScreenState?.(state=>{
    if(exitSettingsFullScreenBtn) exitSettingsFullScreenBtn.hidden=!state?.isFullScreen;
  });
  window.pm3api.onSettingsFocusSection(focusSection);
  window.pm3api.onSettingsUpdated(async payload=>{
    if(payload?.type === "database"){
      await refreshDb();
      renderPhotoSettingsPanel();
    }
    if(payload?.type === "help-icons" && window.HelpEngine?.applyVisibility){
      window.HelpEngine.applyVisibility();
    }
    if(maintainerMode && payload?.type === "engineering-mode"){
      window.EngineeringMode?.refreshFromStorage?.({source:"settings-sync"});
      renderEngineeringModeSettings();
    }
  });
  if(location.hash) focusSection(location.hash.slice(1));
  await updateFullScreenControl();
}

init();
